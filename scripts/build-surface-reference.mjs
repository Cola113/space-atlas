import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { landingSites } from '../solar-system/src/surface/geometry.js';
import { physicalTime } from '../solar-system/src/physics/time.js';

const requests=[];
for(const [id,period] of [['enceladus',1.370218],['titan',15.945421],['miranda',1.413479],['pluto',6.38723]]) {
  const site=landingSites[id];
  const dates=['1900-01-01T00:00:00Z','1900-12-31T23:59:59Z','1971-08-01T17:00:00Z','2000-01-01T12:00:00Z','2026-09-12T12:00:00Z','2100-12-31T23:59:59Z'];
  for(let i=0;i<=32;i++)dates.push(new Date(Date.parse('2026-09-12T12:00:00Z')+i*period/8*86400000).toISOString());
  for(const iso of dates)requests.push({id,date:iso,tdbSeconds:physicalTime(new Date(iso)).tdbSeconds,
    latitude:site.latitude,longitude:site.longitude,radiusKm:site.radiusKm,parentRadiusKm:site.parentRadiusKm});
}
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/surface-reference-input.json',import.meta.url),JSON.stringify(requests));
const root=fileURLToPath(new URL('../',import.meta.url));
const result=spawnSync(root+'data/ephemeris-tools/Scripts/python.exe',['scripts/build-surface-reference.py'],{cwd:root,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
