"""Independent CSPICE SPK/PCK evaluation and a separate Horizons vector check.
Raw kernels and full API responses remain in ignored data/. No app position or
attitude routines are used here. UTC-to-TDB is an explicitly shared input.
"""
from pathlib import Path
import json, hashlib, math, csv, io, os
import numpy as np
import requests
import spiceypy as spice
from jplephem.spk import SPK
ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'data/phobos-audit/input.json').read_text())
cache=ROOT/'data/jpl'
urls={'pck00011.tpc':'pck/pck00011.tpc','gm_de440.tpc':'pck/gm_de440.tpc'}
for name,url in urls.items():
    p=cache/name
    if not p.exists():
        r=requests.get('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'+url,timeout=60); r.raise_for_status(); p.write_bytes(r.content)
os.chdir(cache)
# The excerpt writer assigns a broad requested descriptor span to both source
# segments. CSPICE must instead see each record's actual coverage at the 1989
# split. Rewrap unchanged original float64 coefficients, as in surface audit.
verified=Path('phobos-reference-valid-coverage.bsp')
if verified.exists(): verified.unlink()
handle=spice.spkopn(str(verified),'MAR099 original coefficients; actual segment coverage',0)
try:
    with SPK.open('phobos-1899-2101.bsp') as kernel:
        for segment in kernel.segments:
            if segment.data_type!=2: raise ValueError('Expected original type 2')
            initial,interval,c=segment.load_array(); records=np.moveaxis(c,0,1).copy()
            start=(initial-2451545)*86400; length=interval*86400; n,_,degree=records.shape
            spice.spkw02(handle,segment.target,segment.center,'J2000',start,start+n*length,
                         'MAR099 '+str(segment.target),length,n,degree-1,records.ravel(),start)
finally: spice.spkcls(handle)
spice.furnsh(str(verified))
# Avoid the known Windows text-kernel line-ending issue; load only data lines.
active=False; lines=[]
for line in Path('pck00011.tpc').read_text().splitlines():
    if line.strip().endswith('begindata'): active=True
    elif line.strip().endswith('begintext'): active=False
    elif active: lines.append(line)
spice.lmpool(lines)
fixtures=[]
for row in data['samples']:
    t=row['tdbSeconds']; state=spice.spkezr('401',t,'J2000','NONE','499')[0]
    f={**row,'relativeKm':state[:3].tolist(),'relativeVelocityKmS':state[3:].tolist()}
    if row['surfaces']:
        rotation=spice.pxform('J2000','IAU_PHOBOS',t); mars=rotation@(-state[:3]); f['sites']=[]
        for lat,lon in data['coordinates']:
            a,b=np.deg2rad([lat,lon]); up=np.array([math.cos(a)*math.cos(b),math.cos(a)*math.sin(b),math.sin(a)])
            east=np.array([-math.sin(b),math.cos(b),0]); north=np.cross(up,east)
            v=mars-up*(11.08+.00165); dist=np.linalg.norm(v); local=np.array([east@v,up@v,-north@v])/dist
            f['sites'].append({'latitude':lat,'longitude':lon,'direction':local.tolist(),'distanceKm':float(dist),'altitudeDegrees':float(np.degrees(np.arcsin(local[1]))),'diameterDegrees':float(np.degrees(2*np.arcsin(3389.5/dist)))})
    fixtures.append(f)
selected=[fixtures[i] for i in [0,3,200,203,400,403,504,507,600,603,800,803]]
query={'format':'json','COMMAND':'401','CENTER':'500@499','MAKE_EPHEM':'YES','EPHEM_TYPE':'VECTORS','TIME_TYPE':'TDB','REF_PLANE':'FRAME','REF_SYSTEM':'ICRF','VEC_TABLE':'2','VEC_CORR':'NONE','OUT_UNITS':'KM-S','CSV_FORMAT':'YES','TLIST':"'"+' '.join(format(2451545+s['tdbSeconds']/86400,'.12f') for s in selected)+"'"}
qpath=ROOT/'data/phobos-audit/horizons-query.json'; qpath.write_text(json.dumps(query,indent=2))
hpath=ROOT/'data/phobos-audit/horizons-response.json'
if not hpath.exists():
    r=requests.get('https://ssd.jpl.nasa.gov/api/horizons.api',params=query,timeout=90); r.raise_for_status()
    result=r.json()
    if '$$SOE' not in result.get('result',''): raise ValueError(result)
    hpath.write_text(json.dumps(result,indent=2))
text=json.loads(hpath.read_text())['result']; rows=list(csv.reader(io.StringIO(text.split('$$SOE')[1].split('$$EOE')[0].strip())))
if len(rows)!=len(selected): raise ValueError('Horizons truncated the requested samples')
horizons=[]
for sample,row in zip(selected,rows):
    t=(float(row[0])-2451545)*86400
    if abs(t-sample['tdbSeconds'])>.0001: raise ValueError('Horizons epoch mismatch')
    p=list(map(float,row[2:5])); c=spice.spkezr('401',t,'J2000','NONE','499')[0][:3]
    horizons.append({'tdbSeconds':t,'positionKm':p,'cspiceDifferenceKm':float(np.linalg.norm(c-p))})
sources={name:hashlib.sha256((cache/name).read_bytes()).hexdigest() for name in ['phobos-1899-2101.bsp','pck00011.tpc','gm_de440.tpc']}
out={'source':'MAR099 original SPK via CSPICE N0067 / spiceypy 8.2.0; PCK00011; Horizons independent service (same orbital solution)','query':query,'horizonsHeader':text.split('$$SOE')[0],'sha256':sources,'horizonsResponseSha256':hashlib.sha256(hpath.read_bytes()).hexdigest(),'fixtures':fixtures,'horizons':horizons}
(ROOT/'solar-system/tests/phobos-reference.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
print(json.dumps({'cspiceEpochs':len(fixtures),'surfaceSamples':sum(len(f.get('sites',[])) for f in fixtures),'horizonsSamples':len(horizons),'horizonsVsCspiceMaxKm':max(h['cspiceDifferenceKm'] for h in horizons)},indent=2))
