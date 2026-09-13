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
names = {
    'phobos':401, 'deimos':402,
    'io':501, 'europa':502, 'ganymede':503, 'callisto':504,
    'amalthea':505, 'thebe':514, 'adrastea':515, 'metis':516,
    'mimas':601, 'enceladus':602, 'tethys':603, 'dione':604, 'rhea':605,
    'titan':606, 'iapetus':608, 'phoebe':609, 'janus':610, 'epimetheus':611,
    'atlas':615, 'prometheus':616, 'pandora':617, 'pan':618,
    'ariel':701, 'umbriel':702, 'titania':703, 'oberon':704, 'miranda':705,
    'triton':801, 'proteus':808, 'charon':901, 'ceres':2000001, 'vesta':2000004,
}
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
    system = code // 100
    angles = values(f'BODY{system}_NUT_PREC_ANGLES')
    # Mars satellite phases include a quadratic term (MAX_PHASE_DEGREE=2).
    # Respect the kernel's stride instead of assuming every phase is linear.
    degree = values(f'BODY{system}_MAX_PHASE_DEGREE')
    stride = int(degree[0]) + 1 if degree else 2
    assert len(angles) % stride == 0
    item['angles'] = [angles[i:i+stride] for i in range(0, len(angles), stride)]
    assert all(item[prop] for prop in ['POLE_RA', 'POLE_DEC', 'PM']), name
    assert all(len(item[prop]) <= len(item['angles']) for prop in ['NUT_PREC_RA', 'NUT_PREC_DEC', 'NUT_PREC_PM']), name
    output['bodies'][name] = item
    for t in [-3155716800, -896209200, 0, 842572800, 3187339200]:
        fixtures.append({'body':name, 'tdbSeconds':t, 'basis':spice.pxform('IAU_' + name.upper(), 'J2000', t).tolist()})

(ROOT / 'solar-system/src/physics/iau-coefficients.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
(ROOT / 'solar-system/tests/iau-reference.json').write_text(json.dumps({
    'generatedWith': f'CSPICE {spice.tkvrsn("TOOLKIT")} / spiceypy {spice.__version__}',
    'sourceSha256': output['sha256'], 'fixtures': fixtures,
}, indent=2), encoding='utf-8')
print(f'Generated {len(names)} IAU definitions and {len(fixtures)} independent CSPICE matrices')
