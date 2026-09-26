import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Vector3 } from 'three';
import { PhysicalState } from '../solar-system/src/physics/state.js';
import { EphemerisStore,evaluateEphemeris } from '../solar-system/src/physics/ephemeris.js';
import { surfaceFrame,angularDiameter } from '../solar-system/src/surface/geometry.js';
import { physicalData } from '../solar-system/src/physical-scale.js';
export const localFetcher=async path=>{const b=await readFile(new URL('../public'+path,import.meta.url));return {ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
export async function verifyPhobosReference() {
  const ref=JSON.parse(await readFile(new URL('../solar-system/tests/phobos-reference.json',import.meta.url),'utf8'));
  const provider=new PhysicalState({ephemeris:new EphemerisStore({fetcher:localFetcher})});
  const stats={cspiceEpochs:ref.fixtures.length,surfaceSamples:0,horizonsSamples:ref.horizons.length,
    relativeKm:0,velocityKmS:0,surfaceDirectionArcmin:0,surfaceDistanceKm:0,surfaceDiameterArcsec:0,horizonsKm:0,horizonsVsCspiceKm:0};
  for(const s of ref.fixtures) {
    const date=new Date(s.date); await provider.ensure(date,['phobos'],{prefetch:false});
    const b=provider.frame(date,{required:['phobos']}).bodies.get('phobos');
    stats.relativeKm=Math.max(stats.relativeKm,b.relativeKm.distanceTo(new Vector3().fromArray(s.relativeKm)));
    stats.velocityKmS=Math.max(stats.velocityKmS,b.relativeVelocityKmS.distanceTo(new Vector3().fromArray(s.relativeVelocityKmS)));
    for(const site of s.sites||[]) {
      const f=surfaceFrame({id:'phobos',parent:'Mars',...site},date,provider),m=f.targets.Mars;
      const actual=m.direction,expected=new Vector3().fromArray(site.direction);
      const angle=Math.atan2(actual.clone().cross(expected).length(),actual.dot(expected));
      stats.surfaceDirectionArcmin=Math.max(stats.surfaceDirectionArcmin,angle*10800/Math.PI);
      stats.surfaceDistanceKm=Math.max(stats.surfaceDistanceKm,Math.abs(m.distanceKm-site.distanceKm));
      stats.surfaceDiameterArcsec=Math.max(stats.surfaceDiameterArcsec,Math.abs(angularDiameter(physicalData.mars.radiusKm,m.distanceKm)*180/Math.PI-site.diameterDegrees)*3600);
      stats.surfaceSamples++;
    }
  }
  for(const h of ref.horizons) {
    const year=Math.max(1900,Math.min(2100,new Date(Date.UTC(2000,0,1,12)+h.tdbSeconds*1000).getUTCFullYear()));
    const bundle=await provider.ephemeris.load('phobos',year);
    const v=new Vector3().fromArray(evaluateEphemeris(bundle,401,4,h.tdbSeconds)).sub(new Vector3().fromArray(evaluateEphemeris(bundle,499,4,h.tdbSeconds)));
    stats.horizonsKm=Math.max(stats.horizonsKm,v.distanceTo(new Vector3().fromArray(h.positionKm)));
    stats.horizonsVsCspiceKm=Math.max(stats.horizonsVsCspiceKm,h.cspiceDifferenceKm);
  }
  provider.dispose(); return stats;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const result=await verifyPhobosReference();
  await writeFile('outputs/landing-candidates/phobos-verification-20260926.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
