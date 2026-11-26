"""Shared image steps for landing panoramas. No network and no generation calls.

Both prepare-landing-textures.py (the original six plus Mars) and
prepare-landing-sites.py (the second-site batch) import from here, so the wrap
blend and the nadir treatment stay identical across every published panorama.
"""
import hashlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = 300_000_000


def wrap(image, band=70):
    """Blend the left and right edges and fade the last few degrees of ground.

    Bleeding the seam band toward the shared edge colour keeps the 360 wrap
    continuous; the nadir fade avoids a polar pinwheel below the observer.
    """
    a = np.asarray(image).astype(np.float32)
    edge = (a[:, 0] + a[:, -1]) * .5
    left, right = a[:, 0].copy(), a[:, -1].copy()
    for x in range(band):
        weight = (1 - x / band) ** 2
        a[:, x] += (edge - left) * weight
        a[:, -1 - x] += (edge - right) * weight
    for y in range(image.height - 60, image.height):
        t = ((y - image.height + 60) / 59) ** 2
        a[y, :, :3] = a[y, :, :3] * (1 - t) + a[y, :, :3].mean(axis=0) * t
    return Image.fromarray(np.uint8(np.clip(a, 0, 255)))


def remove_black_sky(image):
    """Flood the pure-black sky connected to the top edge into transparency."""
    a = np.asarray(image.convert('RGB')).copy()
    black = a.max(axis=2) < 26
    mask = Image.fromarray(np.uint8(black) * 255).copy()
    ImageDraw.floodfill(mask, (0, 0), 128)
    sky = np.asarray(mask) == 128
    alpha = np.uint8(~sky) * 255
    a[sky] = 0
    return Image.fromarray(np.dstack([a, alpha]))


def panorama_with_traced_skyline(source, size=(3840, 1920)):
    """Skyline-traced variant for skies that keep a thin atmospheric band.

    Some generated panoramas draw a haze band between the pure black sky and
    the bright cloud deck. A black flood fill alone would leave that band
    baked, glowing over the rendered night sky, so the transparent region is
    traced per column instead: from the top edge through black and hazy
    pixels, stopping at the first solid cloud or terrain pixel. "Solid" means
    the blue-minus-red gap closes or the pixel turns bright — near-horizon
    whitish haze stays sky. Distant bluish summit silhouettes inside the band
    go with the sky; white domes and bright cloud tops stop the trace.
    """
    original = Image.open(source).convert('RGB')
    if original.size != size:
        original = original.resize(size, Image.Resampling.LANCZOS)
    a = np.asarray(original).astype(np.int16)
    blue_gap = a[..., 2] - a[..., 0]
    # "Solid" needs all three channels: the blue sky keeps a high blue channel,
    # so brightness here is the channel minimum, not the maximum. Dark blue
    # summit silhouettes stay sky; white domes and bright cloud tops stop it.
    floor = a.min(axis=2)
    solid = ((blue_gap < 15) & (floor > 30)) | (floor >= 190)
    height, width = solid.shape
    # The cloud deck itself is puffs with bluish gaps between them, so a stop
    # is judged over a long window: from the deck top roughly a third of the
    # next rows are solid, while thin bright wisps in the haze band reach only
    # a fifth. Short windows tunnel through the gaps and leave hanging threads.
    window, share = 150, .35
    running = np.zeros((height + 1, width), dtype=np.int64)
    running[1:] = np.cumsum(solid, axis=0)
    boundary = np.full(width, height, dtype=np.int64)
    for x in range(width):
        ys = np.flatnonzero(solid[:, x])
        if not ys.size:
            continue
        ahead = np.minimum(window, height - ys)
        sums = running[ys + ahead, x] - running[ys, x]
        ok = sums / ahead >= share
        if ok.any():
            boundary[x] = ys[np.argmax(ok)]
    # A small median window removes single-pixel speckle at cone rims and domes.
    padded = np.pad(boundary, 4, mode='edge')
    boundary = np.median(np.lib.stride_tricks.sliding_window_view(padded, 9), axis=1).astype(np.int64)
    # The skyline is one continuous curve: a column that tunneled through a
    # bluish gap between cloud puffs must be pulled back to its neighbours, or
    # it leaves a thin opaque thread hanging over the deck. Iterated clamping
    # still lets genuine steep cone walls through, a dozen rows per column.
    limit = 12
    for _ in range(4):
        for x in range(1, width):
            boundary[x] = min(max(boundary[x], boundary[x - 1] - limit), boundary[x - 1] + limit)
        for x in range(width - 2, -1, -1):
            boundary[x] = min(max(boundary[x], boundary[x + 1] - limit), boundary[x + 1] + limit)
    # The Mauna Kea cloud inversion ends at a nearly level distant horizon in
    # this source. Blue gaps in that deck are clouds, not sky: cap the traced
    # boundary here rather than cutting rectangular notches through each gap.
    boundary = np.minimum(boundary, round(height * .49))
    rgb = np.asarray(original).copy()
    rows = np.arange(height)[:, None].astype(np.float32)
    # A hard 0/255 cut leaves stair steps at cones and observatory domes. Use a
    # narrow coverage ramp, then bleed the first solid pixel into the transparent
    # side so filtered texture samples do not carry a blue fringe into the sky.
    feather = 4.0
    coverage = np.clip((rows - (boundary[None, :] - feather)) / (feather * 2), 0, 1)
    coverage = coverage * coverage * (3 - 2 * coverage)
    alpha = np.asarray(Image.fromarray(np.uint8(np.round(coverage * 255))).filter(ImageFilter.GaussianBlur(.85)))
    solid_rows = np.minimum(boundary + 2, height - 1)
    for x, y in enumerate(solid_rows):
        rgb[:boundary[x], x] = rgb[y, x]
    return wrap(Image.fromarray(np.dstack([rgb, alpha])))


def dynamic_cloud_sea(source, size=(3840, 1920), ground=None):
    """Extract a soft, neutral cloud deck for a slow independent animation.

    This is an overlay rather than a claim that the generated panorama contains
    measured weather. It intentionally keeps only bright low-saturation pixels
    around the horizon, leaving volcanic ridges and the black sky transparent.
    """
    original = Image.open(source).convert('RGB')
    if original.size != size:
        original = original.resize(size, Image.Resampling.LANCZOS)
    a = np.asarray(original).astype(np.float32)
    minimum = a.min(axis=2)
    rows = np.arange(a.shape[0])[:, None] / a.shape[0]
    # This panorama's domes sit above .488; the white-blue cloud deck starts
    # below them. Warm volcanic ground is excluded by the blue-minus-red gate.
    band = np.clip((rows - .488) / .008, 0, 1) * np.clip((.575 - rows) / .025, 0, 1)
    bright = np.clip((minimum - 130) / 55, 0, 1)
    cool = np.clip((a[..., 2] - a[..., 0] - 8) / 12, 0, 1)
    alpha = np.uint8(np.round(band * bright * cool * 255))
    if ground is not None:
        alpha = np.uint8(alpha.astype(np.float32) * np.asarray(ground)[..., 3] / 255)
    # Only cloud colours travel. Fill the masked-out ridge columns from nearby
    # cloud samples so drifting UVs never drag a dome or mountain into a gap.
    rgb = np.zeros_like(a, dtype=np.uint8)
    width = a.shape[1]
    for y in range(a.shape[0]):
        samples = np.flatnonzero(alpha[y] > 20)
        if not samples.size:
            continue
        for channel in range(3):
            rgb[y, :, channel] = np.interp(np.arange(width), samples, a[y, samples, channel], period=width)
    return wrap(Image.fromarray(np.dstack([rgb, alpha])))


def panorama_from_frame(source, size=(3840, 1920)):
    """Reparameterize a generated landscape frame into a 360x180 ground panorama.

    The provider returns 16:9 for a requested 2:1, so the delivery is resampled
    rather than claimed as native; callers record both sizes.
    """
    original = Image.open(source).convert('RGB')
    return wrap(remove_black_sky(original.resize(size, Image.Resampling.LANCZOS)))


def panorama_with_vacuum_skyline(source, size=(3840, 1920)):
    """Trace a black vacuum sky without punching holes in dark crater walls.

    The Phobos inputs have a black sky but terrain shadows also connect to it.
    Only pixels above the first terrain boundary are sky; every lower pixel
    remains opaque, including black shadows. Work in source pixels before the
    existing resampling, wrap blend and nadir treatment.
    """
    original = Image.open(source).convert('RGB')
    rgb = np.asarray(original).copy()
    solid = rgb.max(axis=2) > 12
    if not solid.any(axis=0).all():
        raise ValueError('Vacuum skyline requires terrain in every source column')
    boundary = solid.argmax(axis=0)
    padded = np.pad(boundary, 4, mode='wrap')
    boundary = np.median(np.lib.stride_tricks.sliding_window_view(padded, 9), axis=1)
    rows = np.arange(original.height)[:, None]
    coverage = np.clip((rows - boundary[None, :] + 1) / 2, 0, 1)
    coverage = coverage * coverage * (3 - 2 * coverage)
    alpha = np.uint8(np.round(coverage * 255))
    ground = Image.fromarray(np.dstack([rgb, alpha]))
    return wrap(ground.resize(size, Image.Resampling.LANCZOS))


def panorama_with_dp_wrap(source, size=(3840, 1920), overlap=240):
    """Reparameterize a vacuum panorama using a minimum-cost wavy overlap seam.

    Rather than smearing edge columns across a fixed vertical seam, overlaps the
    right and left edges by `overlap` source columns, finds a minimum-energy
    wavy seam via dynamic programming, blends low frequencies across a wide band
    and high frequencies narrowly along the seam, removes the top-connected pure
    black vacuum sky, and fades the nadir smoothly.
    """
    original = Image.open(source).convert('RGB')
    arr = np.asarray(original, dtype=np.float32)
    height, width, _ = arr.shape
    overlap = min(overlap, width // 6)
    left_half = arr[:, -overlap:, :]
    right_half = arr[:, :overlap, :]
    diff = np.mean((left_half - right_half) ** 2, axis=2)
    cols = np.arange(overlap, dtype=np.float32)
    edge_pen = np.where((cols < 24) | (cols > overlap - 25), 5000.0, 0.0)
    cost = diff + edge_pen[None, :]

    dp = np.zeros_like(cost)
    back = np.zeros((height, overlap), dtype=np.int16)
    dp[0] = cost[0]
    for y in range(1, height):
        prev = dp[y - 1]
        l = np.concatenate(([1e12], prev[:-1]))
        r = np.concatenate((prev[1:], [1e12]))
        stacked = np.stack([l, prev, r], axis=0)
        choice = np.argmin(stacked, axis=0)
        dp[y] = cost[y] + stacked[choice, np.arange(overlap)]
        back[y] = choice - 1

    seam = np.zeros(height, dtype=np.int32)
    seam[-1] = int(np.argmin(dp[-1]))
    for y in range(height - 2, -1, -1):
        seam[y] = int(np.clip(seam[y + 1] + back[y + 1, seam[y + 1]], 0, overlap - 1))

    xs = np.arange(overlap, dtype=np.float32)[None, :]
    s = seam[:, None].astype(np.float32)
    m_hi = np.clip((xs - (s - 14.0)) / 28.0, 0.0, 1.0)
    m_hi = m_hi * m_hi * (3.0 - 2.0 * m_hi)
    m_lo = np.clip((xs - (s - 72.0)) / 144.0, 0.0, 1.0)
    m_lo = m_lo * m_lo * (3.0 - 2.0 * m_lo)

    a_lo = np.asarray(Image.fromarray(np.uint8(left_half)).filter(ImageFilter.GaussianBlur(18)), dtype=np.float32)
    b_lo = np.asarray(Image.fromarray(np.uint8(right_half)).filter(ImageFilter.GaussianBlur(18)), dtype=np.float32)
    blended = np.clip(
        a_lo * (1.0 - m_lo[..., None]) + b_lo * m_lo[..., None]
        + (left_half - a_lo) * (1.0 - m_hi[..., None]) + (right_half - b_lo) * m_hi[..., None],
        0, 255,
    )
    both_sky = (left_half.max(axis=2) < 16) & (right_half.max(axis=2) < 16)
    blended[both_sky] = 0.0

    seamless = np.concatenate([arr[:, overlap:width - overlap, :], blended], axis=1)
    seamless = np.roll(seamless, overlap // 2, axis=1)
    resized = Image.fromarray(np.uint8(np.clip(seamless, 0, 255))).resize(size, Image.Resampling.LANCZOS)
    rgba = remove_black_sky(resized)
    a = np.asarray(rgba, dtype=np.float32)
    for y in range(size[1] - 64, size[1]):
        t = ((y - (size[1] - 64)) / 63.0) ** 2
        a[y, :, :3] = a[y, :, :3] * (1.0 - t) + a[y, :, :3].mean(axis=0) * t
    return Image.fromarray(np.uint8(np.clip(a, 0, 255)))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
