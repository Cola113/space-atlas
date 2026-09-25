"""Shared image steps for landing panoramas. No network and no generation calls.

Both prepare-landing-textures.py (the original six plus Mars) and
prepare-landing-sites.py (the second-site batch) import from here, so the wrap
blend and the nadir treatment stay identical across every published panorama.
"""
import hashlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

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
    rgb = np.asarray(original).copy()
    rows = np.arange(height)[:, None]
    sky = rows < boundary[None, :]
    alpha = np.uint8(~sky) * 255
    rgb[sky] = 0
    return wrap(Image.fromarray(np.dstack([rgb, alpha])))


def panorama_from_frame(source, size=(3840, 1920)):
    """Reparameterize a generated landscape frame into a 360x180 ground panorama.

    The provider returns 16:9 for a requested 2:1, so the delivery is resampled
    rather than claimed as native; callers record both sizes.
    """
    original = Image.open(source).convert('RGB')
    return wrap(remove_black_sky(original.resize(size, Image.Resampling.LANCZOS)))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
