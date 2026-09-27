"""Build the measured Titan north-polar liquid mask from Cassini PIA17655.

The input is the NASA/JPL polar mosaic, not a hand-drawn coastline. The output
is an 8-bit equirectangular mask used only as an additive shader lookup.
"""
from pathlib import Path
import hashlib
from urllib.request import urlretrieve

from PIL import Image, ImageFilter

SOURCE_URL = (
    "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/"
    "pia/pia17/pia17655/PIA17655.jpg?w=2000&h=1956&fit=clip&crop=faces%2Cfocalpoint"
)
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "test-results" / "titan-source" / "PIA17655.jpg"
OUTPUT = ROOT / "public" / "surface" / "titan-north-lakes-mask.png"


def main():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        urlretrieve(SOURCE_URL, SOURCE)
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if digest != '1349a2457c01afae3d223706ffd7ffe1896dec4d7e004dbd9da14c6b60e63b01':
        raise ValueError('PIA17655 source changed: recheck graticule and classification before use')
    source = Image.open(SOURCE).convert("RGB")
    if source.size != (2000, 1956):
        raise ValueError('PIA17655 calibration requires the recorded 2000x1956 image')
    width, height = source.size
    # Conservative interior only. White labels, missing data and brown terrain
    # remain zero. Erosion removes uncertain coast pixels rather than inventing
    # coastlines or filling the map's printed labels.
    classified = Image.new('L', source.size)
    classified.putdata([255 if ((b > r * 1.12 + 8 and b > g * 1.05 + 8 and b < 190)
                              or (b > 45 and r < 45 and g < 65)) else 0
                        for r, g, b in source.getdata()])
    pixels = classified.filter(ImageFilter.MinFilter(7)).load()
    mask = Image.new("L", (1024, 512), 0)
    out = mask.load()
    # PIA17655 graticule: 50 N circle at x=32/1968, y=10/1946
    # in the archived 2000x1956 source; north pole at (1000,978).
    radius = 968 * width / 2000
    center_x, center_y = width / 2, height / 2
    import math

    for y in range(512):
        # The output is a full 2:1 equirectangular map; only the measured
        # north-polar region (50 N to 90 N) is populated.
        latitude = 90 - 180 * ((y + .5) / 512)
        if latitude < 50:
            continue
        rho = math.tan(math.radians(90 - latitude) / 2) / math.tan(math.radians(20))
        for x in range(1024):
            # Conventional east-positive map; shader samples body-fixed
            # geography directly, independently of the haze texture's UVs.
            angle = math.pi - 2 * math.pi * ((x + .5) / 1024)
            sx = round(center_x + radius * rho * math.sin(angle))
            sy = round(center_y - radius * rho * math.cos(angle))
            if not (0 <= sx < width and 0 <= sy < height):
                continue
            if pixels[sx, sy]:
                out[x, y] = 255
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # Shrink one output texel as well: nearest lookup cannot bleed into land.
    mask = mask.filter(ImageFilter.MinFilter(3))
    mask.save(OUTPUT, optimize=True)
    print(f"source={SOURCE} size={source.size} output={OUTPUT} liquid_pixels={sum(value > 0 for value in mask.getdata())}")


if __name__ == "__main__":
    main()
