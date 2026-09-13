"""Independent topocentric parent geometry from original SPKs and CSPICE.

The request file supplies dates converted by the separately tested time layer;
all vector assembly, body rotation and ENU/observer geometry here use SPICE.
Run with npx tsx scripts/build-surface-reference.mjs (no downloads).
"""
from pathlib import Path
import os
import json
import hashlib
import numpy as np
import spiceypy as spice
from jplephem.spk import SPK

ROOT = Path(__file__).resolve().parents[1]
requests = json.loads((ROOT/'data/surface-reference-input.json').read_text())
os.chdir(ROOT/'data/jpl')
# jplephem's excerpt writer gives every split segment the requested broad
# descriptor interval. Rewrap unchanged float64 records with their actual time
# coverage so CSPICE can select valid segments before/after a source split.
verified=Path('surface-reference-valid-coverage.bsp')
if verified.exists(): verified.unlink()
handle=spice.spkopn(str(verified),'Original coefficients with actual record coverage',0)
try:
    for system in ['saturn','uranus','pluto']:
        with SPK.open(system+'-1899-2101.bsp') as kernel:
            for segment in kernel.segments:
                if segment.data_type!=2: raise ValueError('Expected original type 2')
                initial,interval,c=segment.load_array()
                records=np.moveaxis(c,0,1).copy()
                start=(initial-2451545)*86400
                length=interval*86400
                n,_,degree=records.shape
                spice.spkw02(handle,segment.target,segment.center,'J2000',start,start+n*length,
                             system+str(segment.target),length,n,degree-1,records.ravel(),start)
finally:
    spice.spkcls(handle)
spice.furnsh(str(verified))
active=False
lines=[]
source=Path('pck00011.tpc')
for line in source.read_text().splitlines():
    if line.strip()=='\\begindata': active=True
    elif line.strip()=='\\begintext': active=False
    elif active: lines.append(line)
spice.lmpool(lines)
ids={'enceladus':(602,699),'titan':(606,699),'miranda':(705,799),'pluto':(999,901)}
fixtures=[]
for item in requests:
    body,parent=ids[item['id']]
    try:
        state,_=spice.spkgeo(parent,item['tdbSeconds'],'J2000',body)
    except Exception:
        print(item['id'], item['date'], flush=True)
        raise
    r=np.array(state[:3])
    fixed=spice.mxv(spice.pxform('J2000','IAU_'+item['id'].upper(),item['tdbSeconds']),r)
    lat,lon=np.radians([item['latitude'],item['longitude']])
    observer=spice.latrec(item['radiusKm']+.00165,lon,lat)
    topocentric=fixed-observer
    up=spice.latrec(1,lon,lat)
    east=np.array([-np.sin(lon),np.cos(lon),0])
    north=np.cross(up,east)
    distance=float(np.linalg.norm(topocentric))
    local=np.array([np.dot(east,topocentric),np.dot(up,topocentric),-np.dot(north,topocentric)])/distance
    fixtures.append({**item,'parentRelativeKm':r.tolist(),'parentDirection':local.tolist(),
                     'distanceKm':distance,'angularDiameter':float(2*np.arcsin(item['parentRadiusKm']/distance))})
output={'generatedWith':f'CSPICE {spice.tkvrsn("TOOLKIT")} / spiceypy {spice.__version__}',
        'sourceSha256':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in ['saturn-1899-2101.bsp','uranus-1899-2101.bsp','pluto-1899-2101.bsp','pck00011.tpc']},
        'scope':'Original float64 SPK records rewrapped with actual segment coverage + CSPICE geometric relative positions, IAU and topocentric ENU calculation; dates from separately tested time conversion.',
        'fixtures':fixtures}
(ROOT/'solar-system/tests/surface-reference.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
print(f'Wrote {len(fixtures)} independent surface parent checks across four cycles and both range boundaries.')
