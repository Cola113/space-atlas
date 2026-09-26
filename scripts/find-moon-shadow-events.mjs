import { mkdir,writeFile } from 'node:fs/promises';
import { localPhysics } from '../solar-system/tests/physical-fixture.js';
import { physicalDefinitions } from '../solar-system/src/physics/definitions.js';
import { physicalData } from '../solar-system/src/physical-scale.js';
import { referenceShadow } from './moon-shadow-reference.mjs';
export function referenceInputs(frame,parentId,id){
 const p=frame.bodies.get(parentId),m=frame.bodies.get(id),[a,b,c]=physicalDefinitions.bodies[parentId].radius.semiAxesKm;
 return {sun:frame.bodies.get('sun').positionKm.toArray(),parent:p.positionKm.toArray(),moon:m.positionKm.toArray(),
  axes:[a,c,b],orientation:p.orientation,moonRadius:physicalData[id].radiusKm,sunRadius:physicalData.sun.radiusKm};
}
export async function findEvents(){
 const provider=localPhysics(),events=[];
 for(const [parent,id,start,end,step] of [['jupiter','io','2026-01-01','2026-01-08',600000],['saturn','titan','2025-01-01','2025-06-01',1800000]]){
  await provider.ensure(new Date(start),[id],{prefetch:false});let checked=0,chosen=null;
  for(let t=Date.parse(start);t<Date.parse(end);t+=step){
   const frame=provider.frame(new Date(t)),prediction=referenceShadow(referenceInputs(frame,parent,id));checked++;
   if(prediction?.incidence>.90){chosen={parent,id,date:new Date(t).toISOString(),prediction,search:{start,end,stepMs:step,checked,criterion:'first central-axis intersection with incidence > 0.90'}};break;}
  }
  if(!chosen)throw Error('No event found for '+id);events.push(chosen);
 }
 provider.dispose();return events;
}
if(process.argv.includes('--write')){await mkdir('test-results/moon-shadow-transits',{recursive:true});const events=await findEvents();await writeFile('test-results/moon-shadow-transits/events.json',JSON.stringify(events,null,2));console.log(JSON.stringify(events,null,2));}
