"""Export NAIF PCK values and independent CSPICE reference matrices.

Requires numpy, requests and spiceypy==8.2.0 in the private build environment.
"""
from pathlib import Path
import hashlib
import json
import requests
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc'
source = ROOT / 'data' / 'jpl' / 'pck00011.tpc'
if not source.exists():
    source.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(URL, timeout=30)
    response.raise_for_status()
    source.write_bytes(response.content)
# CSPICE's C file loader cannot open all Windows Unicode paths; load text lines.
data_lines, active = [], False
for line in source.read_text(encoding='ascii').splitlines():
    if line.strip() == '\\begindata':
        active = True
    elif line.strip() == '\\begintext':
        active = False
    elif active:
        data_lines.append(line)
spice.lmpool(data_lines)
names = {'io':501, 'europa':502, 'ganymede':503, 'callisto':504, 'enceladus':602, 'titan':606, 'miranda':705, 'charon':901}
output = {
    'source': URL, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'epoch': 'J2000', 'timescale': 'TDB', 'angleUnit': 'degree',
    'polynomialTimeUnits': {'pole':'Julian century', 'primeMeridian':'day', 'periodicAngles':'Julian century'}, 'bodies': {},
}
fixtures = []


def values(key):
    # Query existence first; spiceypy reports missing pool values via NotFoundError.
    try:
        return spice.gdpool(key, 0, 100).tolist()
    except spice.utils.exceptions.NotFoundError:
        return []


for name, code in names.items():
    item = {'naifId': code}
    for prop in ['POLE_RA', 'POLE_DEC', 'PM', 'NUT_PREC_RA', 'NUT_PREC_DEC', 'NUT_PREC_PM']:
        item[prop] = values(f'BODY{code}_{prop}')
    angles = values(f'BODY{code // 100}_NUT_PREC_ANGLES')
    item['angles'] = [angles[i:i+2] for i in range(0, len(angles), 2)]
    output['bodies'][name] = item
    for t in [-3155716800, -896209200, 0, 842572800, 3187339200]:
        fixtures.append({'body':name, 'tdbSeconds':t, 'basis':spice.pxform('IAU_' + name.upper(), 'J2000', t).tolist()})

(ROOT / 'solar-system/src/physics/iau-coefficients.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
(ROOT / 'solar-system/tests/iau-reference.json').write_text(json.dumps({
    'generatedWith': f'CSPICE {spice.tkvrsn("TOOLKIT")} / spiceypy {spice.__version__}',
    'sourceSha256': output['sha256'], 'fixtures': fixtures,
}, indent=2), encoding='utf-8')
print(f'Generated {len(names)} IAU definitions and {len(fixtures)} independent CSPICE matrices')
