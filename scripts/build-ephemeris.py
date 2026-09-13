"""Build local J2000 geometric positions from NAIF kernels. Requires numpy, spiceypy.
Usage: python scripts/build-ephemeris.py --cache ../ephemeris-cache
Raw kernels stay outside the repository. No runtime JPL requests.
"""
import argparse, datetime as dt, hashlib, json, pathlib, time
import numpy as np
import spiceypy as spice

parser=argparse.ArgumentParser();parser.add_argument('--cache',required=True);parser.add_argument('--start',type=int,default=1900);parser.add_argument('--end',type=int,default=2100);parser.add_argument('--orientation-only',action='store_true')
args=parser.parse_args();cache=pathlib.Path(args.cache);out=pathlib.Path('public/solar-system/ephemeris');out.mkdir(parents=True,exist_ok=True)
epoch=dt.datetime(2000,1,1,12)
kernels=['sat441.bsp','ura184_part-3.bsp','plu060.bsp']

pck=cache/'pck00011.tpc';spice.furnsh(str(pck))
ids={'Io':501,'Europa':502,'Ganymede':503,'Callisto':504,'Enceladus':602,'Titan':606,'Miranda':705,'Charon':901,'Pluto':999}
orientations={}
def pool(name):
 try:return spice.gdpool(name,0,200).tolist()
 except spice.utils.exceptions.SpiceyError:return []
for name,body in ids.items():
 orientations[name]={key:pool(f'BODY{body}_{value}') for key,value in {'ra':'POLE_RA','dec':'POLE_DEC','w':'PM','raTerms':'NUT_PREC_RA','decTerms':'NUT_PREC_DEC','wTerms':'NUT_PREC_PM'}.items()}
 orientations[name]['angles']=pool(f'BODY{body//100}_NUT_PREC_ANGLES')
(out/'orientation.json').write_text(json.dumps({'source':'NAIF pck00011.tpc','timeScale':'TDB','models':orientations}),encoding='utf-8')
pathlib.Path('solar-system/src/ephemeris').mkdir(exist_ok=True)
pathlib.Path('solar-system/src/ephemeris/orientation-data.js').write_text('// Generated from NAIF pck00011.tpc by scripts/build-ephemeris.py\nexport default '+json.dumps(orientations)+';\n',encoding='utf-8')
if args.orientation_only:raise SystemExit(0)
for name in kernels:spice.furnsh(str(cache/name))
# Position centers are explicit: outer moons relative to primary CENTER, Pluto relative to Sun.
targets={'Enceladus':('602','699',1),'Titan':('606','699',8),'Miranda':('705','799',1),'Charon':('901','999',4),'Pluto':('999','10',8)}
degree=12;n=degree+1
nodes=np.cos(np.pi*(np.arange(n)+.5)/n)
transform=2/n*np.cos(np.outer(np.arange(n),np.arccos(nodes)));transform[0]*=.5
validation=np.linspace(-.987,.993,11)
max_error=0.;fixtures=[];all_years={}
def positions(target,observer,ts):return np.asarray(spice.spkpos(target,ts,'J2000','NONE',observer)[0])
def fit(target,observer,start,end):
 global max_error
 mid=(start+end)/2;half=(end-start)/2
 coeff=(transform@positions(target,observer,mid+nodes*half)).T
 truth=positions(target,observer,mid+validation*half)
 error=float(np.max(np.linalg.norm(np.polynomial.chebyshev.chebval(validation,coeff.T).T-truth,axis=1)))
 if error>.25:
  if end-start<300:raise RuntimeError(f'Cannot fit {target}: {error} km')
  return fit(target,observer,start,mid)+fit(target,observer,mid,end)
 max_error=max(max_error,error)
 return [[start,end,*coeff.reshape(-1).tolist()]]
for year in range(args.start,args.end):
 binary=[];sections={}
 # One-day padding makes UTC/TT year transitions and interpolation endpoints safe.
 begin=(dt.datetime(year,1,1)-epoch).total_seconds()-86400
 end=(dt.datetime(year+1,1,1)-epoch).total_seconds()+86400
 for name,(target,observer,days) in targets.items():
  first=len(binary);t=begin
  while t<end:
   stop=min(end,t+days*86400);binary.extend(fit(target,observer,t,stop));t=stop
  sections[name]={'offset':first,'count':len(binary)-first,'observer':observer}
 raw=np.asarray(binary,dtype='<f8').tobytes();filename=f'{year}.bin';(out/filename).write_bytes(raw)
 meta={'version':1,'degree':degree,'stride':41,'year':year,'bodies':sections,'sha256':hashlib.sha256(raw).hexdigest()}
 (out/f'{year}.json').write_text(json.dumps(meta,separators=(',',':')),encoding='utf-8');all_years[str(year)]={'bytes':len(raw),'sha256':meta['sha256']}
 # Holdout times are not fitting or validation nodes. Used by the JS runtime tests.
 if year in [1900,1971,2000,2026,2099]:
  for fraction in [.001234,.327156,.731825,.99912]:
   et=begin+86400+fraction*(end-begin-172800)
   sample={'tdbSeconds':et,'positions':{name:positions(a,b,et).tolist() for name,(a,b,_) in targets.items()},'orientations':{}}
   for name in ids:sample['orientations'][name]=spice.pxform('IAU_'+name.upper(),'J2000',et).tolist()
   fixtures.append(sample)
 if year%10==0:print(f'{year}: {len(raw)} bytes; max holdout error {max_error:.6f} km',flush=True)
manifest={'version':1,'frame':'J2000 equatorial','units':'km','timeScale':'TDB seconds past J2000','coverage':[args.start,args.end],'degree':degree,'maxValidationErrorKm':max_error,'sources':{name:hashlib.sha256((cache/name).read_bytes()).hexdigest() for name in kernels},'years':all_years,'orientationSource':hashlib.sha256(pck.read_bytes()).hexdigest()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
pathlib.Path('solar-system/tests/fixtures').mkdir(exist_ok=True)
pathlib.Path('solar-system/tests/fixtures/spice-reference.json').write_text(json.dumps({'generator':'CSPICE via spiceypy '+spice.__version__,'aberration':'NONE; geometric','samples':fixtures},indent=2),encoding='utf-8')
print(f'Complete; maximum interpolation check error {max_error:.6f} km',flush=True)
