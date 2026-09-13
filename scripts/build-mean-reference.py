"""Independent CSPICE conic references for the adopted mean elements.

These validate propagation/coordinate conversion, not ephemeris accuracy.
Run with the same private spiceypy build environment as build-iau.py.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
registry = ROOT / 'solar-system/src/physics/body-definitions.json'
data = json.loads(registry.read_text(encoding='utf-8'))
active, lines = False, []
for line in (ROOT / 'data/jpl/pck00011.tpc').read_text(encoding='ascii').splitlines():
    if line.strip() == '\\begindata':
        active = True
    elif line.strip() == '\\begintext':
        active = False
    elif active:
        lines.append(line)
spice.lmpool(lines)
fixtures = []
for name, body in data['bodies'].items():
    orbit = body['orbit']
    if orbit['provider'] != 'mean-kepler':
        continue
    frame = orbit['referencePlane']
    epoch = (orbit['epochTdbJd']-2451545)*86400
    a = orbit['a']['value'] * (data['constants']['auKm'] if orbit['a']['unit'] == 'au' else 1)
    if frame == 'ecliptic':
        rotation = spice.pxform('ECLIPJ2000', 'J2000', epoch)
    elif frame == 'J2000-equatorial':
        rotation = np.eye(3)
    else:
        if frame == 'Laplace':
            pole = orbit['referencePole']
            normal = spice.radrec(1, math.radians(pole['raDegrees']), math.radians(pole['decDegrees']))
        elif frame == 'equatorial':
            normal = spice.pxform('IAU_'+body['parent'].upper(), 'J2000', epoch)[:, 2]
        else:
            raise ValueError(frame)
        node = np.cross([0, 0, 1], normal)
        rotation = spice.twovec(normal.tolist(), 3, node.tolist(), 1).T
    period = orbit['periodDays']*86400
    # Effective mu reproduces the adopted a/P pair; it is not a new estimate of
    # the parent mass, and is never published as a measured gravitational value.
    mu = (2*math.pi/period)**2 * a**3
    elements = [a*(1-orbit['e']), orbit['e'], *[math.radians(orbit[k]) for k in
        ['inclinationDegrees', 'ascendingNodeDegrees', 'argumentPeriapsisDegrees', 'meanAnomalyDegrees']], epoch, mu]
    dates = [-3155716800, 3187339200] + [epoch+phase*period for phase in [-.37, 0, .23, .5, 1, 1.7, 4]]
    for t in dates:
        state = spice.conics(elements, t)
        fixtures.append({'id':name, 'tdbSeconds':t,
            'positionKm':(rotation @ state[:3]).tolist(), 'velocityKmS':(rotation @ state[3:]).tolist()})

output = {'generatedWith':f'CSPICE {spice.tkvrsn("TOOLKIT")} / spiceypy {spice.__version__}',
    'definitionSha256':hashlib.sha256(registry.read_bytes()).hexdigest(),
    'scope':'Conic propagation of adopted elements and ICRF reference-plane conversion; not comparison to true satellite ephemerides.',
    'fixtures':fixtures}
(ROOT / 'solar-system/tests/mean-reference.json').write_text(json.dumps(output, indent=2)+'\n', encoding='utf-8')
print(f'Generated {len(fixtures)} independent conic states')
