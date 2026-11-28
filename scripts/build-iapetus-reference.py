"""Fetch independent JPL Horizons state vectors for Iapetus (608 relative to 699)
and cross-check against the local SAT441 excerpt via jplephem 2.24.

Raw query/response stays in gitignored data/iapetus-audit/.
Compact reference fixture is written to solar-system/tests/iapetus-reference.json.
"""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from jplephem.spk import SPK

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'data' / 'iapetus-audit'
AUDIT.mkdir(parents=True, exist_ok=True)
EXCERPT = ROOT / 'data' / 'jpl' / 'saturn-1899-2101.bsp'
J2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)

# 16 epochs spanning 1900–2100, expressed as TDB calendar dates -> exact TDB JD.
TDB_EPOCHS = [
    '1900-01-01T00:00:00',
    '1900-07-01T12:34:56',
    '1925-03-15T06:00:00',
    '1950-06-15T18:00:00',
    '1975-09-20T03:15:00',
    '2000-01-01T12:00:00',  # J2000
    '2007-09-10T14:15:00',  # Cassini Iapetus close flyby
    '2017-05-10T12:00:00',
    '2026-09-15T00:00:00',
    '2033-01-01T00:00:00',
    '2040-01-01T00:00:00',
    '2060-11-11T11:11:11',
    '2085-06-01T00:00:00',
    '2099-07-04T16:30:00',
    '2100-06-15T00:00:00',
    '2100-12-31T23:59:59',
]


def tdb_seconds(stamp):
    dt = datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc)
    return (dt - J2000).total_seconds()


epochs = [{'tdbCalendar': s, 'tdbSeconds': tdb_seconds(s)} for s in TDB_EPOCHS]
query = {
    'format': 'json',
    'COMMAND': '608',
    'CENTER': '500@699',
    'MAKE_EPHEM': 'YES',
    'EPHEM_TYPE': 'VECTORS',
    'TIME_TYPE': 'TDB',
    'REF_PLANE': 'FRAME',
    'REF_SYSTEM': 'ICRF',
    'VEC_TABLE': '2',
    'VEC_CORR': 'NONE',
    'OUT_UNITS': 'KM-S',
    'CSV_FORMAT': 'YES',
    'TLIST': "'" + ' '.join(format(2451545.0 + e['tdbSeconds'] / 86400.0, '.12f') for e in epochs) + "'",
}

qpath = AUDIT / 'horizons-query.json'
hpath = AUDIT / 'horizons-response.json'
qpath.write_text(json.dumps(query, indent=2), encoding='utf-8')
if not hpath.exists():
    resp = requests.get('https://ssd.jpl.nasa.gov/api/horizons.api', params=query, timeout=90)
    resp.raise_for_status()
    payload = resp.json()
    if '$$SOE' not in payload.get('result', ''):
        raise ValueError(payload)
    hpath.write_text(json.dumps(payload, indent=2), encoding='utf-8')

text = json.loads(hpath.read_text(encoding='utf-8'))['result']
rows = list(csv.reader(io.StringIO(text.split('$$SOE')[1].split('$$EOE')[0].strip())))
if len(rows) != len(epochs):
    raise ValueError(f'Horizons returned {len(rows)} rows, expected {len(epochs)}')

kernel = SPK.open(EXCERPT)
seg608 = [s for s in kernel.segments if s.target == 608 and s.center == 6]
seg699 = [s for s in kernel.segments if s.target == 699 and s.center == 6]


def eval_body(segments, tdb_sec):
    jd = 2451545.0 + tdb_sec / 86400.0
    for seg in reversed(segments):
        init_jd, intlen, coeffs = seg.load_array()
        end_jd = init_jd + coeffs.shape[1] * intlen
        if init_jd <= jd <= end_jd:
            return seg.compute_and_differentiate(2451545.0, tdb_sec / 86400.0)
    raise ValueError(f'No segment covers JD {jd}')


def eval_rel(tdb_sec):
    p608, v608 = eval_body(seg608, tdb_sec)
    p699, v699 = eval_body(seg699, tdb_sec)
    return p608 - p699, (v608 - v699) / 86400.0


horizons = []
for ep, row in zip(epochs, rows):
    t = (float(row[0]) - 2451545.0) * 86400.0
    if abs(t - ep['tdbSeconds']) > 0.001:
        raise ValueError(f'Horizons epoch mismatch: {t} vs {ep["tdbSeconds"]}')
    pos = [float(x) for x in row[2:5]]
    vel = [float(x) for x in row[5:8]]
    jp_pos, jp_vel = eval_rel(t)
    diff_pos = float(np.linalg.norm(jp_pos - np.array(pos)))
    diff_vel = float(np.linalg.norm(jp_vel - np.array(vel)))
    horizons.append({
        'tdbCalendar': ep['tdbCalendar'],
        'tdbSeconds': t,
        'positionKm': pos,
        'velocityKmS': vel,
        'jplephemDifferenceKm': diff_pos,
        'jplephemVelocityDiffKmS': diff_vel,
    })

kernel.close()

out = {
    'source': 'SAT441 original SPK (sat441.bsp) via jplephem 2.24; JPL Horizons independent service (same orbital solution SAT441)',
    'query': query,
    'horizonsHeader': text.split('$$SOE')[0],
    'excerptSha256': hashlib.sha256(EXCERPT.read_bytes()).hexdigest(),
    'horizonsResponseSha256': hashlib.sha256(hpath.read_bytes()).hexdigest(),
    'horizons': horizons,
}
(ROOT / 'solar-system' / 'tests' / 'iapetus-reference.json').write_text(
    json.dumps(out, indent=2) + '\n', encoding='utf-8'
)
print(json.dumps({
    'horizonsSamples': len(horizons),
    'horizonsVsJplephemMaxKm': max(h['jplephemDifferenceKm'] for h in horizons),
    'horizonsVsJplephemMaxKmS': max(h['jplephemVelocityDiffKmS'] for h in horizons),
}, indent=2))
