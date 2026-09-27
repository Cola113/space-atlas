import { mkdir,writeFile } from 'node:fs/promises';
import { physicalTime } from '../solar-system/src/physics/time.js';
import { rotationPeriodDays } from '../solar-system/src/physics/definitions.js';
const samples=[];
const add=(date,surfaces=false)=>samples.push({date:new Date(date).toISOString(),tdbSeconds:physicalTime(new Date(date)).tdbSeconds,surfaces});
for(let year=1900;year<=2100;year++) {
  const t=Date.UTC(year,0,1);
  for(const offset of [0,21600.001,123456.789,180*86400]) add(t+offset*1000);
}
for(const date of ['2026-09-15','2026-09-26']) for(let i=0;i<=24;i++)
  add(Date.parse(date+'T00:00:00Z')+i/24*rotationPeriodDays('phobos')*86400000,true);
await mkdir('data/phobos-audit',{recursive:true});
await writeFile('data/phobos-audit/input.json',JSON.stringify({samples,coordinates:[[1,60],[1,150],[1,311]]}));
console.log(samples.length+' independent reference input epochs.');
