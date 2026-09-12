"""Prepare saved image-generation results for spherical WebGL use; no API calls."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--manifest', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/solar-system/textures/artistic')
parser.add_argument('--allow-partial', action='store_true')
parser.add_argument('--skip-existing', action='store_true')
args = parser.parse_args()
entries = json.loads(args.manifest.read_text(encoding='utf-8'))
args.output.mkdir(parents=True, exist_ok=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wrap_surface(image):
    pixels = np.asarray(image.convert('RGB'), dtype=np.float32).copy()
    height, width, _ = pixels.shape
    before = float(np.abs(pixels[:, 0] - pixels[:, -1]).mean())
    band = round(width * 0.035)
    # Blend corresponding edge terrain, rather than extending a per-row color
    # offset inward, which can create horizontal streaks on the wrapped sphere.
    left = pixels[:, :band].copy()
    right = pixels[:, -band:][:, ::-1].copy()
    for x in range(band):
        t = x / (band - 1)
        weight = (1 - t * t * (3 - 2 * t)) * 0.5
        pixels[:, x] = left[:, x] * (1 - weight) + right[:, x] * weight
        pixels[:, -1-x] = right[:, x] * (1 - weight) + left[:, x] * weight
    polar_band = round(height * 0.025)
    for y in range(polar_band):
        t = y / (polar_band - 1)
        weight = 1 - t * t * (3 - 2 * t)
        for row in (y, height - 1 - y):
            pixels[row] = pixels[row] * (1 - weight) + pixels[row].mean(axis=0) * weight
    result = Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8))
    return result, before


previous_path = args.output / 'provenance.json'
previous = {x['id']: x for x in json.loads(previous_path.read_text(encoding='utf-8'))['textures']} if previous_path.exists() else {}
records = []
for entry in entries:
    source = args.input / f'{entry["id"]}.png'
    if not source.exists():
        if args.allow_partial:
            continue
        raise FileNotFoundError(source)
    high = args.output / f'{entry["id"]}-3840.webp'
    base = args.output / f'{entry["id"]}-1920.webp'
    saved = previous.get(entry['id'])
    if args.skip_existing and saved and saved.get('processingVersion') == 2 and high.exists() and base.exists() and saved['generatedSha256'] == digest(source) and saved['baseSha256'] == digest(base) and saved['highSha256'] == digest(high):
        records.append(saved)
        continue
    with Image.open(source) as raw:
        if raw.size != (3840, 1920):
            raise ValueError(f'{source.name}: actual dimensions {raw.size}, expected native 3840x1920; inspect before adapting')
        prepared, edge_before = wrap_surface(raw)
    # Preserve every processed high-resolution pixel; the base version is for
    # the overview and thumbnails, and the existing loader swaps in the high map.
    prepared.save(high, lossless=True, method=6)
    prepared.resize((1920, 960), Image.Resampling.LANCZOS).save(base, quality=84, method=6)
    decoded = np.asarray(Image.open(high).convert('RGB'), dtype=np.int16)
    assert np.array_equal(decoded, np.asarray(prepared)), 'Lossless export changed pixels'
    assert np.max(np.abs(decoded[:, 0] - decoded[:, -1])) == 0, 'Longitude edge mismatch'
    assert np.max(np.ptp(decoded[0], axis=0)) == 0 and np.max(np.ptp(decoded[-1], axis=0)) == 0, 'Polar discontinuity'
    # Audit coverage in a coarse grid so tiny dark crater floors do not count
    # as holes, but a black hemisphere or a broad placeholder does.
    tile_means = [float(tile.mean()) for row in np.array_split(decoded, 12) for tile in np.array_split(row, 24, axis=1)]
    assert min(tile_means) > 18, f'{entry["id"]}: a region is nearly black'
    records.append({
        'id': entry['id'], 'processingVersion': 2, 'base': base.name, 'high': high.name,
        'generatedDimensions': [3840, 1920], 'baseDimensions': [1920, 960],
        'sourceReference': entry.get('reference'), 'generatedSha256': digest(source),
        'baseSha256': digest(base), 'highSha256': digest(high),
        'baseBytes': base.stat().st_size, 'highBytes': high.stat().st_size,
        'longitudeEdgeMeanDifferenceBefore': edge_before,
        'longitudeEdgeMaxDifferenceAfter': 0,
        'lowestCoverageTileMean': min(tile_means),
        'mode': 'whole-map artistic repaint' if entry.get('reference') else 'original artistic terrain',
    })
    print(f'{entry["id"]}: 3840x1920 lossless, {high.stat().st_size // 1024} KiB; complete coverage', flush=True)
manifest = {
    'version': 1, 'date': '2026-09-12', 'provider': 'Bafang API', 'model': 'gpt-image-2',
    'policy': 'Artistic completeness takes priority over measured geographic accuracy. Entire maps are synthetic/repainted; no original pixels are protected. Not observation data.',
    'processing': 'Native 3840x1920 output; no upscaling. Smooth mirrored terrain blending in the outer 3.5% longitude bands; polar convergence in the outer 2.5% latitude bands. Lossless high map and lossy overview.',
    'textures': records,
}
(args.output / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Prepared {len(records)}/{len(entries)} textures.', flush=True)
