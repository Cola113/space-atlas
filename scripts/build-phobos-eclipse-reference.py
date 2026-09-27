"""Independent Horizons vectors and CSPICE PCK observer geometry.

Run with data/ephemeris-tools/Scripts/python.exe; --download fetches missing
responses. No application geometry, time conversion or Hermes files are read.
Full request/response records stay in ignored data/phobos-eclipse-audit/.
"""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import argparse
import csv
import hashlib
import io
import json
import math

import numpy as np
import requests
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/phobos-eclipse-audit'
CACHE.mkdir(parents=True, exist_ok=True)
PARSER = argparse.ArgumentParser()
PARSER.add_argument('--download', action='store_true')
OPTIONS = PARSER.parse_args()
SOURCE = 'https://ssd.jpl.nasa.gov/api/horizons.api'
PCK_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc'
LSK_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls'

def load_text_kernel(path):
    # Load data lines to avoid Windows text-kernel line-ending differences.
    active, lines = False, []
    for line in path.read_text().splitlines():
        if line.strip().endswith('begindata'):
            active = True
        elif line.strip().endswith('begintext'):
            active = False
        elif active:
            lines.append(line)
    spice.lmpool(lines)

for name in ['pck00011.tpc', 'naif0012.tls']:
    load_text_kernel(ROOT / 'data/jpl' / name)

MARS_EQUATORIAL_KM = float(spice.bodvrd('499', 'RADII', 3)[1][0])
SUN_KM = float(spice.bodvrd('10', 'RADII', 3)[1][0])
# Match the unchanged application observer sphere and mean Mars radius for a
# separate comparison. The PCK equatorial sphere is also evaluated throughout.
MARS_MEAN_KM = 3389.5
OBSERVER_RADIUS_KM = 11.08 + 0.00165
SITES = {'phobos-60e': (1, 60), 'phobos-311e': (1, 311)}
SEARCH_MARGIN_MINUTES = 12  # The acceptance floor is 10; retain two spare minutes.
provenance = []

def vectors(command, center, start, stop, step, label, time_type='UT'):
    query = {'format': 'json', 'COMMAND': str(command), 'CENTER': center,
             'MAKE_EPHEM': 'YES', 'EPHEM_TYPE': 'VECTORS', 'TIME_TYPE': 'UT',
             'REF_PLANE': 'FRAME', 'REF_SYSTEM': 'ICRF', 'VEC_CORR': 'NONE',
             'VEC_TABLE': '2', 'OUT_UNITS': 'KM-S', 'CSV_FORMAT': 'YES',
             'TIME_DIGITS': 'FRACSEC', 'START_TIME': start, 'STOP_TIME': stop,
             'STEP_SIZE': step}
    if time_type is None:
        del query['TIME_TYPE']
    else:
        query['TIME_TYPE'] = time_type
    encoded = {k: v if k == 'format' else "'" + v + "'" for k, v in query.items()}
    path = CACHE / (label + '.json')
    if not path.exists():
        if not OPTIONS.download:
            raise RuntimeError(f'Missing {path}; use --download')
        response = requests.get(SOURCE, params=encoded, timeout=90)
        response.raise_for_status()
        payload = response.json()
        if '$$SOE' not in payload.get('result', ''):
            raise RuntimeError(payload)
        path.write_text(json.dumps({'endpoint': SOURCE, 'query': query,
                                    'requestUrl': response.url, 'response': payload}, indent=2))
    record = json.loads(path.read_text())
    if record['query'] != query:
        raise RuntimeError('Cached query mismatch')
    result = record['response']['result']
    provenance.append({'query': query, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                       'header': result.split('$$SOE')[0]})
    rows = csv.reader(io.StringIO(result.split('$$SOE')[1].split('$$EOE')[0].strip()))
    values = {}
    for row in rows:
        stamp = datetime.strptime(row[1].strip().removeprefix('A.D. '),
                                  '%Y-%b-%d %H:%M:%S.%f')
        if time_type == 'UT':
            stamp = stamp.replace(tzinfo=timezone.utc)
        values[stamp] = np.array([float(x) for x in row[2:5]])
    return values

def geometry(mars, sun, up=None, mars_radius=MARS_MEAN_KM):
    distance, sun_distance = float(np.linalg.norm(mars)), float(np.linalg.norm(sun))
    separation = math.degrees(math.atan2(float(np.linalg.norm(np.cross(mars, sun))),
                                        float(np.dot(mars, sun))))
    mars_radius_deg = math.degrees(math.asin(mars_radius / distance))
    sun_radius_deg = math.degrees(math.asin(SUN_KM / sun_distance))
    old_threshold = math.degrees(math.atan(mars_radius / distance) + math.atan(SUN_KM / sun_distance))
    threshold = mars_radius_deg + sun_radius_deg
    return {'marsDistanceKm': distance, 'sunDistanceKm': sun_distance,
            'marsDirection': (mars / distance).tolist(), 'sunDirection': (sun / sun_distance).tolist(),
            'separationDeg': separation, 'marsRadiusDeg': mars_radius_deg,
            'sunRadiusDeg': sun_radius_deg, 'thresholdDeg': threshold,
            'oldThresholdDeg': old_threshold, 'clearanceDeg': separation - threshold,
            'eclipsed': separation < threshold,
            'totalEclipse': separation < mars_radius_deg - sun_radius_deg,
            'oldEclipsed': separation < old_threshold,
            **({'sunAltitudeDeg': math.degrees(math.asin(float(up @ sun) / sun_distance))}
               if up is not None else {})}

def sample(date, phobos_from_mars, sun_from_phobos):
    # Horizons vectors run from CENTER to COMMAND. Negate Mars->Phobos to get
    # Phobos->Mars; COMMAND=10 CENTER=500@401 already gives Phobos->Sun.
    mars = -phobos_from_mars
    stamp = date.isoformat(timespec='seconds').replace('+00:00', 'Z')
    rotation = spice.pxform('IAU_PHOBOS', 'J2000', spice.str2et(stamp))
    sites = {}
    for site_id, (lat, lon) in SITES.items():
        a, b = np.radians([lat, lon])
        up = rotation @ np.array([math.cos(a)*math.cos(b), math.cos(a)*math.sin(b), math.sin(a)])
        offset = up * OBSERVER_RADIUS_KM
        sites[site_id] = {'meanSphere': geometry(mars-offset, sun_from_phobos-offset, up),
                          'equatorialSphere': geometry(mars-offset, sun_from_phobos-offset, up, MARS_EQUATORIAL_KM)}
    return {'date': stamp, 'center': geometry(mars, sun_from_phobos, mars_radius=MARS_EQUATORIAL_KM),
            'sites': sites}

def series(start, stop, step, label):
    phobos = vectors(401, '500@499', start, stop, step, label+'-phobos')
    sun = vectors(10, '500@401', start, stop, step, label+'-sun')
    if phobos.keys() != sun.keys():
        raise RuntimeError('Mismatched Horizons epochs')
    return [sample(date, vector, sun[date]) for date, vector in phobos.items()]

minute_samples = series('2026-09-27 00:00:00', '2026-09-27 06:00:00', '1 m', 'minute')
# A unitless Horizons step specifies equal subdivisions, so 180 intervals
# across this three-minute span yield one-second contact brackets.
contacts = series('2026-09-27 00:38:00', '2026-09-27 00:41:00', '180', 'utc-contacts')

def exit_bracket(samples, select):
    for before, after in zip(samples, samples[1:]):
        if select(before)['eclipsed'] and not select(after)['eclipsed']:
            return [before['date'], after['date']]
    raise RuntimeError('No eclipse egress in contact span')

egress = {'centerEquatorialSphere': exit_bracket(contacts, lambda s: s['center']), 'sites': {}}
candidates = []
for site_id in SITES:
    brackets = {model: exit_bracket(contacts, lambda s: s['sites'][site_id][model])
                for model in ['meanSphere', 'equatorialSphere']}
    egress['sites'][site_id] = brackets
    last_possible_exit = max(datetime.fromisoformat(b[1]) for b in brackets.values())
    eligible = [s for s in minute_samples
                if datetime.fromisoformat(s['date']) >= last_possible_exit + timedelta(minutes=SEARCH_MARGIN_MINUTES)
                and all(not s['sites'][site_id][model]['eclipsed']
                        and s['sites'][site_id][model]['sunAltitudeDeg'] > 8
                        for model in brackets)]
    if not eligible:
        raise RuntimeError(f'No safe candidate for {site_id}')
    selected = eligible[0]
    # Confirm that the chosen epoch does not belong to a later eclipse.
    assert all(not s['sites'][site_id]['equatorialSphere']['eclipsed']
               for s in minute_samples if last_possible_exit <= datetime.fromisoformat(s['date'])
               <= datetime.fromisoformat(selected['date']))
    candidates.append({'siteId': site_id, 'date': selected['date'],
                       'minimumMinutesAfterEgress': (datetime.fromisoformat(selected['date'])-last_possible_exit).total_seconds()/60,
                       **selected['sites'][site_id]})

retained_dates = {f'2026-09-27T00:{minute:02d}:00Z' for minute in [30,35,39,40,41,42,45,51,52]}
for candidate in candidates:
    date = datetime.fromisoformat(candidate['date'])
    retained_dates.update((date-timedelta(minutes=i)).isoformat(timespec='seconds').replace('+00:00','Z') for i in range(11))
selected_samples = [s for s in minute_samples if s['date'] in retained_dates]
# Reproduce the missing-TIME_TYPE interpretation separately. These calendar
# labels are TDB, not UTC, and never feed the surface candidate search.
tdb_phobos = vectors(401, '500@499', '2026-09-27 00:39:00', '2026-09-27 00:39:01',
                    '1', 'omitted-time-type-phobos', None)
tdb_sun = vectors(10, '500@401', '2026-09-27 00:39:00', '2026-09-27 00:39:01',
                 '1', 'omitted-time-type-sun', None)
omitted_time_type = {'inputCalendar': '2026-09-27 00:39:00', 'interpretedTimeScale': 'TDB',
                    'correspondingUtc': spice.et2utc(spice.str2et('2026 SEP 27 00:39:00 TDB'), 'ISOC', 3)+'Z',
                    **geometry(-next(iter(tdb_phobos.values())), next(iter(tdb_sun.values())), mars_radius=MARS_EQUATORIAL_KM)}
report = {'source': 'Independent Horizons geometric vectors (MAR099/DE441) plus CSPICE PCK00011 and NAIF0012',
          'sources': [SOURCE, PCK_URL, LSK_URL], 'timeScale': 'UTC input; explicit Horizons TIME_TYPE=UT; CSPICE str2et for PCK',
          'frame': 'ICRF/J2000 equatorial, no light-time or aberration correction',
          'radiiKm': {'marsPckEquatorial': MARS_EQUATORIAL_KM, 'marsProjectMean': MARS_MEAN_KM,
                       'sunPck': SUN_KM, 'observerSphereIncludingEye': OBSERVER_RADIUS_KM},
          'limitations': 'Sphere overlap, not an oblate limb or terrain profile; equatorial sphere is a conservative Mars bound. Fixed observer on a mean Phobos sphere.',
          'kernelsSha256': {name: hashlib.sha256((ROOT/'data/jpl'/name).read_bytes()).hexdigest()
                            for name in ['pck00011.tpc','naif0012.tls']},
          'queries': provenance, 'search': {'start': minute_samples[0]['date'], 'end': minute_samples[-1]['date'],
                                         'stepSeconds': 60, 'contactStepSeconds': 1, 'minimumSunAltitudeDeg': 8,
                                         'minimumMinutesAfterEgress': 10,
                                         'selectionMarginMinutes': SEARCH_MARGIN_MINUTES},
          'omittedTimeTypeComparison': omitted_time_type,
          'egress': egress, 'candidates': candidates, 'samples': selected_samples}
(CACHE/'full-series.json').write_text(json.dumps({'minutes':minute_samples,'contacts':contacts}, indent=2)+'\n')
(ROOT/'solar-system/tests/phobos-eclipse-reference.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'egress':egress,'candidates':candidates,'oldMoment':next(s for s in selected_samples if '00:39:00' in s['date'])}, indent=2))
