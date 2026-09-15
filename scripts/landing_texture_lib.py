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


def panorama_from_frame(source, size=(3840, 1920)):
    """Reparameterize a generated landscape frame into a 360x180 ground panorama.

    The provider returns 16:9 for a requested 2:1, so the delivery is resampled
    rather than claimed as native; callers record both sizes.
    """
    original = Image.open(source).convert('RGB')
    return wrap(remove_black_sky(original.resize(size, Image.Resampling.LANCZOS)))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
