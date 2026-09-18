"""Publish yearly Chebyshev bundles for small bodies from Horizons-generated SPK files.

Setup: python -m venv --system-site-packages data/ephemeris-tools
       data/ephemeris-tools/Scripts/python -m pip install spiceypy numpy requests
Run:   data/ephemeris-tools/Scripts/python scripts/build-small-body-ephemeris.py [--refresh]

Why this is not build-ephemeris.py: JPL Horizons can emit a binary SPK for a small
body, but it writes MDA records (SPK data types 1 and 21) that neither jplephem nor
the project's JavaScript evaluator can read. There is also no current NAIF asteroid
kernel with original type 2 Chebyshev records covering all of 1900 to 2100 for these
bodies -- the archived ceres_1900_2100.bsp stops at 2100-01-01 and predates the Dawn
solution. So the source is evaluated with CSPICE on a dense uniform grid and
re-expressed on the same 32-day windows the NAIF asteroid kernels use.

That is a change of representation, not a re-fit of the orbit: the worst-case
difference between the published polynomials and the source over a dense check grid
inside every window is measured and recorded per track as `sourceResidualKm`, and the
float32/float64 choice uses the same conservative coefficient bound as
build-ephemeris.py. The published file reproduces JPL's interpolated trajectory; it
is not the original record and it does not inherit JPL's solution accuracy, which is
documented separately in public/ephemeris/README.md.
"""
import argparse
import base64
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
import struct
import sys

import numpy as np
import requests
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data' / 'jpl'
DEST = ROOT / 'public' / 'ephemeris'
REFERENCE = ROOT / 'solar-system' / 'tests' / 'ephemeris-reference.json'
MANIFEST = DEST / 'manifest.json'
J2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)

# Window geometry follows the NAIF asteroid kernels (32 days, degree 18); one more
# coefficient costs nothing and the measured residual is at the micrometre level.
WINDOW_DAYS = 32
DEGREE = 19
FIT_SAMPLES = 128
CHECK_SAMPLES = 513

# One row per published system. `command` is the Horizons target selection, `target`
# the SPK ID Horizons writes, `center` the SPK center (10 = Sun) and `parent` the
# body the app treats as the orbit center.
SOURCES = {
    'ceres': {
        'command': "'1;'",
        'target': 20000001,
        'center': 10,
        'parent': 'sun',
        'id': '2000001',
        'start': '1899-11-20',
        'stop': '2101-02-10',
        'step': '30 d',
        'note': 'Horizons SPK for 1 Ceres; for 2012-2067 Horizons answers with the '
                'Dawn flight-project trajectory solution rather than a fresh '
                'numerical integration of osculating elements.',
    },
}


def epoch(year):
    # Calendar label interpreted as TDB, exactly as build-ephemeris.py does; the one
    # day of padding each side absorbs the UTC-to-TDB offset of the label.
    return (datetime(year, 1, 1, tzinfo=timezone.utc) - J2000).total_seconds()


def fetch_spk(name, source, refresh=False):
    """Ask Horizons for a binary SPK and cache the full response beside its digest."""
    leapseconds = CACHE / 'naif0012.tls'
    if not leapseconds.exists():
        if not refresh:
            raise FileNotFoundError(f'{leapseconds.name}: rerun with --refresh to fetch it')
        response = requests.get('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls',
                                timeout=120)
        response.raise_for_status()
        leapseconds.write_bytes(response.content)
    query = {'format': 'json', 'COMMAND': source['command'], 'EPHEM_TYPE': 'SPK',
             'START_TIME': f"'{source['start']}'", 'STOP_TIME': f"'{source['stop']}'",
             'STEP_SIZE': f"'{source['step']}'", 'SPK_FORMAT': 'B'}
    query_id = hashlib.sha256(json.dumps(query, sort_keys=True).encode()).hexdigest()[:16]
    response_path = CACHE / f'horizons-{name}-spk-{query_id}.json'
    if not response_path.exists():
        if not refresh:
            raise FileNotFoundError(f'{response_path.name}: rerun with --refresh to fetch it')
        response = requests.post('https://ssd.jpl.nasa.gov/api/horizons.api', data=query, timeout=300)
        response.raise_for_status()
        payload = response.json()
        if 'spk' not in payload:
            raise ValueError(payload.get('error', 'No SPK in Horizons response'))
        response_path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    raw = response_path.read_bytes()
    payload = json.loads(raw)
    blob = base64.b64decode(payload['spk'])
    spk_path = CACHE / f'{name}-horizons.spk'
    if not spk_path.exists() or spk_path.read_bytes() != blob:
        spk_path.write_bytes(blob)
    return {'query': query, 'querySha256': hashlib.sha256(raw).hexdigest(),
            'response': response_path.name, 'spkSha256': hashlib.sha256(blob).hexdigest(),
            'spkBytes': len(blob), 'spkFile': spk_path.name}


def build(name, source, info, first, last):
    spice.kclear()
    # A leap-second kernel is needed for calendar labels and for timout() in the
    # coverage report; the input epochs themselves stay TDB seconds.
    leapseconds = CACHE / 'naif0012.tls'
    if not leapseconds.exists():
        raise FileNotFoundError(f'{leapseconds.name}: run with --refresh to fetch it')
    spice.furnsh(leapseconds.name)
    spice.furnsh(info['spkFile'])
    coverage = spice.spkcov(info['spkFile'], source['target'])
    interval = WINDOW_DAYS * 86400
    required_start, required_end = epoch(first) - 86400, epoch(last + 1) + 86400
    # Horizons returns exactly the span it was asked for, which is not a whole number
    # of windows. Align the grid to the END of the source coverage so no trailing days
    # are lost, and require it to still cover the published years at both ends.
    windows = math.ceil((coverage[1] - required_start) / interval)
    initial = coverage[1] - windows * interval
    if windows < 1 or initial > required_start or coverage[1] < required_end:
        raise ValueError(f'{name}: source coverage {spice.timout(coverage[0], "ISOC")} .. '
                         f'{spice.timout(coverage[1], "ISOC")} cannot be tiled into '
                         f'{WINDOW_DAYS}-day windows covering {first}-01-01 through {last}-12-31; '
                         f'widen START/STOP_TIME in SOURCES')
    if coverage[0] > initial:
        raise ValueError(f'{name}: first window starts before the source coverage')
    print(f'{name}: source covers {spice.timout(coverage[0], "ISOC")} .. '
          f'{spice.timout(coverage[1], "ISOC")}', flush=True)

    coefficients = np.empty((windows, 3, DEGREE + 1), dtype=np.float64)
    worst_residual = 0.0
    for index in range(windows):
        t0 = initial + index * interval
        t1 = t0 + interval
        ts = np.linspace(t0, t1, FIT_SAMPLES)
        positions = np.array([spice.spkpos(str(source['target']), t, 'J2000', 'NONE',
                                           str(source['center']))[0] for t in ts])
        x = 2 * (ts - t0) / (t1 - t0) - 1
        fitted, *_ = np.linalg.lstsq(np.polynomial.chebyshev.chebvander(x, DEGREE),
                                     positions, rcond=None)
        coefficients[index] = fitted.T
        # Check on a grid that is not the fit sample set, so a fit that merely
        # interpolates its inputs cannot look accurate.
        check = np.linspace(t0, t1, CHECK_SAMPLES)
        truth = np.array([spice.spkpos(str(source['target']), t, 'J2000', 'NONE',
                                       str(source['center']))[0] for t in check])
        approx = np.polynomial.chebyshev.chebvander(
            2 * (check - t0) / (t1 - t0) - 1, DEGREE) @ fitted
        worst_residual = max(worst_residual, float(np.max(np.abs(approx - truth))))
    if worst_residual > .05:
        raise ValueError(f'{name}: window fit residual {worst_residual} km is too large')

    quantized = coefficients.astype('<f4')
    bound = float(np.max(np.linalg.norm(np.sum(np.abs(coefficients - quantized), axis=2), axis=1)))
    precision = 4 if bound < .1 else 8
    print(f'{name}: {windows} windows, worst fit residual {worst_residual:.6f} km, '
          f'float32 coefficient bound {bound:.6f} km -> {"float32" if precision == 4 else "float64"}',
          flush=True)

    directory = DEST / name
    directory.mkdir(parents=True, exist_ok=True)
    data = coefficients.astype('<f4' if precision == 4 else '<f8')
    files, fixtures = {}, []
    for year in range(first, last + 1):
        start, end = epoch(year) - 86400, epoch(year + 1) + 86400
        i = max(0, math.floor((start - initial) / interval))
        j = min(windows, math.floor((end - initial) / interval) + 1)
        if j <= i:
            raise ValueError(f'{name}/{year}: window grid does not cover the year')
        track = {'target': source['target'], 'center': source['center'],
                 'initial': initial + i * interval, 'interval': interval,
                 'degree': DEGREE, 'precision': precision, 'offset': 0,
                 'encodingBoundKm': bound if precision == 4 else 0,
                 'sourceResidualKm': worst_residual, 'count': j - i}
        payload = data[i:j].tobytes()
        header = json.dumps({'version': 1, 'system': name, 'year': year, 'frame': 'J2000',
                             'timescale': 'TDB', 'units': 'km', 'tracks': [track]},
                            separators=(',', ':')).encode()
        header += b' ' * ((-len(header)) % 8)
        content = b'ATLEPH01' + struct.pack('<II', len(header), len(payload)) + header + payload
        (directory / f'{year}.bin').write_bytes(content)
        files[str(year)] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
        # The JavaScript evaluator must reproduce the source (CSPICE) at the year
        # boundaries and at interior epochs, not merely the bundle it read back.
        year_start, year_end = epoch(year), epoch(year + 1)
        samples = [year_start + k * (year_end - year_start) / 7 for k in range(8)]
        samples.append(year_start + 123456.789)
        for t in samples:
            if not (initial + i * interval <= t <= initial + j * interval):
                raise ValueError(f'{name}/{year}: sample {t} falls outside the published window')
            fixtures.append({'system': name, 'year': year, 'target': source['target'],
                             'center': source['center'], 'tdbSeconds': t,
                             'positionKm': list(spice.spkpos(
                                 str(source['target']), t, 'J2000', 'NONE',
                                 str(source['center']))[0])})
    result = {'source': 'https://ssd.jpl.nasa.gov/api/horizons.api (Horizons-generated SPK)',
              'sourceSha256': info['spkSha256'], 'horizonsQuery': info['query'],
              'horizonsResponse': info['response'], 'horizonsQuerySha256': info['querySha256'],
              'spkBytes': info['spkBytes'], 'note': source['note'],
              'representation': f'CSPICE sampling of the source SPK re-expressed as Chebyshev '
                                f'polynomials on {WINDOW_DAYS}-day windows, degree {DEGREE}; '
                                f'not the original MDA record. The published bundle reproduces '
                                f'the source as CSPICE evaluates it, worst measured residual '
                                f'{worst_residual:.6f} km inside a window.',
              'tracks': [{'target': source['target'], 'center': source['center'],
                          'initial': initial, 'count': windows, 'interval': interval,
                          'degree': DEGREE, 'precision': precision,
                          'encodingBoundKm': bound if precision == 4 else 0,
                          'sourceResidualKm': worst_residual}],
              'files': files}
    print(f'{name}: {sum(f["bytes"] for f in files.values()) / 1048576:.2f} MiB published '
          f'in {len(files)} yearly bundles', flush=True)
    return result, fixtures


def merge_manifest(entries):
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    for name, entry in entries.items():
        manifest['sources'][name] = entry
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'manifest.json now carries {len(manifest["sources"])} systems: '
          f'{", ".join(manifest["sources"])}', flush=True)


def merge_reference(systems, fixtures):
    reference = json.loads(REFERENCE.read_text(encoding='utf-8'))
    kept = [r for r in reference if r['system'] not in systems]
    REFERENCE.write_text(json.dumps(kept + fixtures, separators=(',', ':')), encoding='utf-8')
    print(f'ephemeris-reference.json: {len(fixtures)} new samples for '
          f'{", ".join(sorted(systems))}; {len(kept) + len(fixtures)} total', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--system', choices=list(SOURCES))
    parser.add_argument('--first', type=int, default=1900)
    parser.add_argument('--last', type=int, default=2100)
    parser.add_argument('--refresh', action='store_true',
                        help='fetch a missing Horizons response; without it a cold cache is an error')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    # CSPICE on Windows cannot open non-ASCII paths, and the project lives under one.
    os.chdir(CACHE)
    entries, fixtures = {}, []
    for name, source in SOURCES.items():
        if args.system and args.system != name:
            continue
        info = fetch_spk(name, source, args.refresh)
        entry, samples = build(name, source, info, args.first, args.last)
        entries[name] = entry
        fixtures.extend(samples)
    if not entries:
        raise SystemExit('Nothing selected')
    merge_manifest(entries)
    merge_reference(set(entries), fixtures)


if __name__ == '__main__':
    main()
