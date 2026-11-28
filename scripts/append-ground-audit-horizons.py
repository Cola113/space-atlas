"""Append independent JPL Horizons + CSPICE ground-audit samples for Triton and Iapetus.

Preserves all existing 827 fixtures in solar-system/tests/ground-audit-reference.json,
fetches heliocentric ICRF vectors (CENTER=500@10) for 801/899 and 608/699 from
JPL Horizons, evaluates IAU_TRITON / IAU_IAPETUS frames and local ENU geometry via
CSPICE (pck00011.tpc), and updates solar-system/tests/ground-audit-reference.json.
"""
import csv
import hashlib
import io
import json
import os
import sys
from pathlib import Path

import numpy as np
import requests
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/science-audit'
REF_PATH = ROOT / 'solar-system/tests/ground-audit-reference.json'
TARGET_IDS = {'triton', 'iapetus'}
HORIZONS_CODES = {
    'triton': 801,
    'neptune': 899,
    'iapetus': 608,
    'saturn': 699,
}

inputs = [
    item for item in json.loads((CACHE / 'ground-input.json').read_text(encoding='utf-8'))
    if item['siteId'] in TARGET_IDS
]
if not inputs:
    raise RuntimeError('No triton/iapetus inputs found in data/science-audit/ground-input.json')

os.chdir(ROOT / 'data/jpl')  # CSPICE on Windows cannot open non-ASCII paths.
active, lines = False, []
for line in Path('pck00011.tpc').read_text(encoding='ascii').splitlines():
    if line.strip() == '\\begindata':
        active = True
    elif line.strip() == '\\begintext':
        active = False
    elif active:
        lines.append(line)
spice.lmpool(lines)

CHUNK = 60
vectors, sources = {}, {}
for site_body, needed in [('triton', ['triton', 'neptune']), ('iapetus', ['iapetus', 'saturn'])]:
    dates = sorted({i['tdbSeconds'] for i in inputs if i['id'] == site_body})
    for name in needed:
        code = HORIZONS_CODES[name]
        vectors[name], chunks = {}, []
        for start in range(0, len(dates), CHUNK):
            epochs = dates[start:start + CHUNK]
            query = {
                'format': 'json', 'COMMAND': str(code), 'CENTER': '500@10', 'MAKE_EPHEM': 'YES',
                'EPHEM_TYPE': 'VECTORS', 'TIME_TYPE': 'TDB', 'REF_PLANE': 'FRAME', 'REF_SYSTEM': 'ICRF',
                'VEC_TABLE': '2', 'VEC_CORR': 'NONE', 'OUT_UNITS': 'KM-S', 'CSV_FORMAT': 'YES',
                'TLIST': "'" + ' '.join(f'{2451545 + t / 86400:.12f}' for t in epochs) + "'",
            }
            query_id = hashlib.sha256(json.dumps(query, sort_keys=True).encode()).hexdigest()[:16]
            path = CACHE / f'horizons-{name}-{query_id}.json'
            if not path.exists():
                if '--download' not in sys.argv:
                    raise FileNotFoundError(f'{path.name}: rerun with --download')
                response = requests.post('https://ssd.jpl.nasa.gov/api/horizons.api', data=query, timeout=90)
                response.raise_for_status()
                payload = response.json()
                result = payload.get('result', '')
                if '$$SOE' not in result:
                    raise ValueError(payload.get('error', result or 'Invalid Horizons response'))
                if len(result.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()) != len(epochs):
                    raise ValueError(f'{name}: Horizons truncated epochs')
                path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
            raw = path.read_bytes()
            result = json.loads(raw)['result']
            if f'({code})' not in result.split('$$SOE')[0]:
                raise ValueError(f'Wrong target in {path.name}')
            rows = list(csv.reader(io.StringIO(result.split('$$SOE')[1].split('$$EOE')[0].strip())))
            if len(rows) != len(epochs):
                raise ValueError(f'Missing epochs: {name}, {len(rows)} / {len(epochs)}')
            for t, row in zip(epochs, rows):
                if abs((float(row[0]) - 2451545) * 86400 - t) > .0001:
                    raise ValueError(f'Wrong TDB epoch {name}')
                vectors[name][t] = np.array(list(map(float, row[2:5])))
            chunks.append({
                'url': 'https://ssd.jpl.nasa.gov/api/horizons.api',
                'query': query,
                'sha256': hashlib.sha256(raw).hexdigest(),
                'header': result.split('$$SOE')[0],
            })
        sources[name] = {'requests': chunks}
        print(f'{name}: {len(vectors[name])} independent Horizons epochs in {len(chunks)} request(s)', flush=True)


def position(name, t):
    if name == 'sun':
        return np.zeros(3)
    return vectors[name][t]


def solar_visibility(sun, parent):
    r, R = sun['angularDiameter'] / 2, parent['angularDiameter'] / 2
    center = np.array(sun['direction'])
    occluder = np.array(parent['direction'])
    separation = spice.vsep(center, occluder)
    if separation > r + R:
        return 1.
    if separation + r < R:
        return 0.
    count = 131072
    index = np.arange(count) + .5
    rho = np.sqrt(index / count) * np.tan(r)
    theta = index * (np.pi * (3 - np.sqrt(5)))
    east = np.cross(center, [1, 0, 0] if abs(center[0]) < .9 else [0, 1, 0])
    east /= np.linalg.norm(east)
    north = np.cross(center, east)
    rays = center + np.outer(rho * np.cos(theta), east) + np.outer(rho * np.sin(theta), north)
    rays /= np.linalg.norm(rays, axis=1)[:, None]
    return float(np.mean(rays @ occluder < np.cos(R)))


new_fixtures = []
for item in inputs:
    t = item['tdbSeconds']
    body = position(item['id'], t)
    rotation = spice.pxform('J2000', 'IAU_' + item['id'].upper(), t)
    lat, lon = np.radians([item['latitude'], item['longitude']])
    up = spice.latrec(1, lon, lat)
    east = np.array([-np.sin(lon), np.cos(lon), 0])
    north = np.cross(up, east)
    local = np.array([east, up, -north]) @ rotation
    observer = body + rotation.T @ (up * (item['radiusKm'] + .00165))
    targets = {}
    for name in dict.fromkeys(('sun', item['parent'], *(item.get('extraTargets') or []))):
        target = position(name, t)
        relative = target - observer
        distance = np.linalg.norm(relative)
        direction = local @ relative / distance
        radius = 695700 if name == 'sun' else (item.get('targetRadiiKm') or {}).get(name, item['parentRadiusKm'])
        lit_fraction = 1 if name == 'sun' else (1 + spice.vdot(
            spice.vhat(-target), spice.vhat(observer - target))) / 2
        targets[name] = {
            'direction': direction.tolist(),
            'distanceKm': float(distance),
            'angularDiameter': float(2 * np.arcsin(radius / distance)),
            'illuminatedFraction': float(lit_fraction),
            'sunDirection': (local @ spice.vhat(-target)).tolist() if name != 'sun' else None,
        }
    fixture = {**item, 'targets': targets}
    if item['parent'] != 'sun':
        fixture['visibleSolarFraction'] = solar_visibility(targets['sun'], targets[item['parent']])
    new_fixtures.append(fixture)

ref = json.loads(REF_PATH.read_text(encoding='utf-8'))
kept = [f for f in ref['fixtures'] if f['siteId'] not in TARGET_IDS]
ref['fixtures'] = kept + new_fixtures
ref.setdefault('horizons', {}).update(sources)
REF_PATH.write_text(json.dumps(ref, indent=2) + '\n', encoding='utf-8')
sites = sorted({f['siteId'] for f in ref['fixtures']})
print(f'Updated ground-audit-reference.json: {len(ref["fixtures"])} fixtures across {len(sites)} landing sites')
