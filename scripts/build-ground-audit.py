"""Reference sky independent of browser positions, rotations and ENU code.

Requires local DE440s, original satellite records with corrected coverage, PCK,
and cached Horizons geometric ICRF vectors. --download refreshes only missing
Horizons queries. Never ships large SPKs or requires network access in tests.
"""
from pathlib import Path
import csv
import hashlib
import io
import json
import math
import os
import sys
from datetime import datetime, timedelta
import numpy as np
import requests
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/science-audit'
inputs = json.loads((CACHE / 'ground-input.json').read_text())
os.chdir(ROOT / 'data/jpl')  # CSPICE on Windows cannot open non-ASCII paths.
spice.furnsh('de440s.bsp')
spice.furnsh('surface-reference-valid-coverage.bsp')
# Ceres is not in DE440s and has no NAIF kernel covering all of 1900-2100, so the
# independent side reads the same Horizons-generated SPK the site is built from --
# but at target 20000001 through CSPICE, not through the project's bundled
# Chebyshev re-expression. That still separates the published bundle from the
# reference: a decoder or windowing mistake would show up as a sky-sized error.
spice.furnsh('ceres-horizons.spk')
active, lines = False, []
for line in Path('pck00011.tpc').read_text(encoding='ascii').splitlines():
    if line.strip() == '\\begindata':
        active = True
    elif line.strip() == '\\begintext':
        active = False
    elif active:
        lines.append(line)
spice.lmpool(lines)

jovian_dates = sorted({i['tdbSeconds'] for i in inputs if i['id'] in ('io', 'europa')})
# Horizons returns at most 80 discrete epochs per request, and truncates the rest silently:
# a 136-epoch TLIST comes back as 80 rows. The list is therefore fetched in chunks and joined,
# and each chunk keeps its own query and response digest as provenance.
CHUNK = 60
vectors, sources = {}, {}
for name, code in [('io', 501), ('europa', 502), ('jupiter', 599)]:
    vectors[name], chunks = {}, []
    for start in range(0, len(jovian_dates), CHUNK):
        epochs = jovian_dates[start:start + CHUNK]
        query = {'format':'json', 'COMMAND':str(code), 'CENTER':'500@10', 'MAKE_EPHEM':'YES',
                 'EPHEM_TYPE':'VECTORS', 'TIME_TYPE':'TDB', 'REF_PLANE':'FRAME', 'REF_SYSTEM':'ICRF',
                 'VEC_TABLE':'2', 'VEC_CORR':'NONE', 'OUT_UNITS':'KM-S', 'CSV_FORMAT':'YES',
                 'TLIST':"'" + ' '.join(f'{2451545 + t / 86400:.12f}' for t in epochs) + "'"}
        query_id = hashlib.sha256(json.dumps(query, sort_keys=True).encode()).hexdigest()[:16]
        path = CACHE / f'horizons-{name}-{query_id}.json'
        if not path.exists():
            if '--download' not in sys.argv:
                raise FileNotFoundError(f'{path.name}: rerun with --download')
            # A 60-epoch TLIST is already ~1.5 KB; the front end answers 502 for the long
            # query string it produces, while the same fields POSTed as a form return the table.
            # The cache key is the query itself, so responses fetched either way stay interchangeable.
            response = requests.post('https://ssd.jpl.nasa.gov/api/horizons.api', data=query, timeout=90)
            response.raise_for_status()
            payload = response.json()
            result = payload.get('result', '')
            if '$$SOE' not in result:
                raise ValueError(payload.get('error', result or 'Invalid Horizons response'))
            # Truncation is silent, so the row count is checked before the response is cached:
            # a response that fails here must not be left on disk to be read back as if valid.
            if len(result.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()) != len(epochs):
                raise ValueError(f'{name}: Horizons returned '
                                 f'{len(result.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines())} '
                                 f'of {len(epochs)} epochs; response not cached')
            path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
        raw = path.read_bytes()
        result = json.loads(raw)['result']
        if f'({code})' not in result.split('$$SOE')[0]:
            raise ValueError(f'Wrong target in {path.name}')
        rows = list(csv.reader(io.StringIO(result.split('$$SOE')[1].split('$$EOE')[0].strip())))
        if len(rows) != len(epochs):
            raise ValueError(f'Missing epochs: {name}, {len(rows)} / {len(epochs)}')
        for t, row in zip(epochs, rows):
            if abs((float(row[0]) - 2451545)*86400 - t) > .0001:
                raise ValueError(f'Wrong TDB epoch {name}')
            vectors[name][t] = np.array(list(map(float, row[2:5])))
        chunks.append({'url':'https://ssd.jpl.nasa.gov/api/horizons.api', 'query':query,
                       'sha256':hashlib.sha256(raw).hexdigest(), 'header':result.split('$$SOE')[0]})
    sources[name] = {'requests':chunks}
    print(f'{name}: {len(vectors[name])} independent Horizons epochs in {len(chunks)} request(s)', flush=True)

# The Mars system barycenter substitutes for its center: displacement from its
# tiny satellites is below 0.2 m, far below the separately stated angular gate.
ids = {'sun':10, 'mercury':199, 'venus':299, 'moon':301, 'earth':399, 'mars':4,
       'enceladus':602, 'titan':606, 'saturn':699, 'miranda':705,
       'uranus':799, 'pluto':999, 'charon':901, 'ceres':20000001}


def position(name, t):
    if name in vectors:
        return vectors[name][t]
    return spice.spkgeo(ids[name], t, 'J2000', 10)[0][:3]


# Select an egress by independent SPICE geometry, then sample across its limb.
# UTC offsets are relative to a nearby already converted input epoch. TDB-TT
# varies by well below a millisecond across this three-hour window.
egress = next(i for i in inputs if i['id'] == 'enceladus' and i['date'] == '2026-09-13T12:39:50.126Z')


def contact_margin(t):
    lat, lon = np.radians([egress['latitude'], egress['longitude']])
    observer = position('enceladus', t) + spice.pxform('IAU_ENCELADUS', 'J2000', t) @ spice.latrec(egress['radiusKm']+.00165, lon, lat)
    planet = position('saturn', t) - observer
    return spice.vsep(-observer, planet) - np.arcsin(egress['parentRadiusKm']/np.linalg.norm(planet))


lo, hi = egress['tdbSeconds'], egress['tdbSeconds']+10800
if not contact_margin(lo) < 0 < contact_margin(hi):
    raise ValueError('Independent eclipse bracket no longer contains egress')
for _ in range(45):
    middle = (lo+hi)/2
    if contact_margin(middle) < 0:
        lo = middle
    else:
        hi = middle
for offset in [-40, -20, -10, -5, 0, 5, 10, 20, 40]:
    milliseconds = round(((lo+hi)/2-egress['tdbSeconds']+offset)*1000)
    date = datetime.fromisoformat(egress['date'].replace('Z', '+00:00')) + timedelta(milliseconds=milliseconds)
    inputs.append({**egress, 'date':date.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                   'tdbSeconds':egress['tdbSeconds']+milliseconds/1000, 'case':'independent SPICE eclipse egress'})


def solar_visibility(sun, parent):
    r, R = sun['angularDiameter']/2, parent['angularDiameter']/2
    center = np.array(sun['direction'])
    occluder = np.array(parent['direction'])
    separation = spice.vsep(center, occluder)
    if separation > r+R:
        return 1.
    if separation+r < R:
        return 0.
    # Independent ray/sphere silhouette sampling on the projected solar disk;
    # does not reuse the runtime's circle-intersection formula.
    count = 131072
    index = np.arange(count)+.5
    rho = np.sqrt(index/count)*np.tan(r)
    theta = index*(np.pi*(3-np.sqrt(5)))
    east = np.cross(center, [1,0,0] if abs(center[0])<.9 else [0,1,0])
    east /= np.linalg.norm(east)
    north = np.cross(center, east)
    rays = center + np.outer(rho*np.cos(theta), east) + np.outer(rho*np.sin(theta), north)
    rays /= np.linalg.norm(rays, axis=1)[:, None]
    return float(np.mean(rays @ occluder < np.cos(R)))


fixtures = []
for item in inputs:
    t = item['tdbSeconds']
    body = position(item['id'], t)
    parent = position(item['parent'], t)
    rotation = spice.pxform('J2000', 'IAU_' + item['id'].upper(), t)
    lat, lon = np.radians([item['latitude'], item['longitude']])
    up = spice.latrec(1, lon, lat)
    east = np.array([-np.sin(lon), np.cos(lon), 0])
    north = np.cross(up, east)
    local = np.array([east, up, -north]) @ rotation
    observer = body + rotation.T @ (up * (item['radiusKm'] + .00165))
    targets = {}
    # Ordered and de-duplicated: iterating a set here made the key order of every written
    # fixture depend on the process hash seed, so two runs on identical input produced
    # different bytes for equal numbers.
    for name in dict.fromkeys(('sun', item['parent'], *(item.get('extraTargets') or []))):
        target = position(name, t)
        relative = target - observer
        distance = np.linalg.norm(relative)
        direction = local @ relative / distance
        radius = 695700 if name == 'sun' else (item.get('targetRadiiKm') or {}).get(name, item['parentRadiusKm'])
        # The phase angle is defined at the illuminated body, not the observer.
        lit_fraction = 1 if name == 'sun' else (1 + spice.vdot(
            spice.vhat(-target), spice.vhat(observer - target))) / 2
        targets[name] = {'direction':direction.tolist(), 'distanceKm':float(distance),
                         'angularDiameter':float(2*np.arcsin(radius/distance)),
                         'illuminatedFraction':float(lit_fraction),
                         'sunDirection':(local @ spice.vhat(-target)).tolist() if name != 'sun' else None}
    fixture = {**item, 'targets':targets}
    if item['parent'] != 'sun':
        fixture['visibleSolarFraction'] = solar_visibility(targets['sun'], targets[item['parent']])
    fixtures.append(fixture)

output = {'generatedWith':f'{spice.tkvrsn("TOOLKIT")} / spiceypy {spice.__version__}',
          'scope':'Independent geometric ICRF vectors (no light-time or aberration), CSPICE IAU frames, spherical observer, phase and angular scale. Mars barycenter approximates its center within 0.2 m. TT/TDB inputs use the separately tested time layer. Samples are keyed by siteId; one body may carry several.',
          'kernelSha256':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in
                          ['de440s.bsp', 'surface-reference-valid-coverage.bsp', 'pck00011.tpc',
                           'ceres-horizons.spk']},
          'horizons':sources, 'fixtures':fixtures}
(ROOT / 'solar-system/tests/ground-audit-reference.json').write_text(
    json.dumps(output, indent=2) + '\n', encoding='utf-8')
sites = sorted({f['siteId'] for f in fixtures})
print(f'Wrote {len(fixtures)} independent ground checks for {len(sites)} landing sites: ' + ', '.join(sites))
