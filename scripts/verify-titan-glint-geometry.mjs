// npx tsx scripts/verify-titan-glint-geometry.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Vector3, MathUtils } from 'three';
import { PNG } from 'pngjs';
import { physicalState } from '../solar-system/src/physics/state.js';
import { skyRotation } from '../solar-system/src/sky-coordinates.js';
import { analyticMirrorNormal, numericMirrorNormal, normalToLatLon, mirrorStrength } from '../solar-system/src/titan-glint.js';
const output='outputs/titan-glint-20260926'; await mkdir(output,{recursive:true});
physicalState.ephemeris.fetcher=async path=>{const b=await readFile('public'+path);return {ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
await physicalState.ensure(new Date('2014-08-01'),['titan'],{prefetch:false});
const mask=PNG.sync.read(await readFile('public/surface/titan-north-lakes-mask.png'));
const seas=[];
for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++) if(mask.data[(y*mask.width+x)*4]>127) seas.push({latitude:90-(y+.5)*180/mask.height,longitude:(x+.5)*360/mask.width});
// Choose a broad conservative Kraken interior rather than a marginal coast pixel.
const site=seas.reduce((best,p)=>Math.hypot(p.latitude-63.1,(p.longitude-42)*.45)<Math.hypot(best.latitude-63.1,(best.longitude-42)*.45)?p:best);
function geometry(ms){const f=physicalState.frame(new Date(ms));const t=f.bodies.get('titan');const rotation=skyRotation(f.time.astronomy);const sun=t.positionKm.clone().negate().normalize().applyMatrix3(rotation); const normal=p=>{const a=p.latitude*Math.PI/180,b=p.longitude*Math.PI/180;return t.orientation.prime.clone().multiplyScalar(Math.cos(a)*Math.cos(b)).addScaledVector(t.orientation.east,Math.cos(a)*Math.sin(b)).addScaledVector(t.orientation.north,Math.sin(a)).applyMatrix3(rotation).normalize();};return {sun,normal};}
const start=Date.parse('2014-08-01T00:00:00Z'); let best=null;
for(let h=0;h<31*24;h++){const ms=start+h*3600000,g=geometry(ms),n=g.normal(site),alt=MathUtils.radToDeg(Math.asin(n.dot(g.sun)));if(!best||alt>best.solarAltitudeDegrees)best={date:new Date(ms).toISOString(),solarAltitudeDegrees:alt,...site,sun:g.sun.toArray(),normal:n.toArray()};}
const sun=new Vector3(...best.sun),n=new Vector3(...best.normal),view=sun.clone().negate().reflect(n),offset=n.clone().addScaledVector(view,4.2);
const analytic=analyticMirrorNormal(sun,view),numeric=numericMirrorNormal(sun,view); const diff=MathUtils.radToDeg(analytic.angleTo(numeric));
let absent=null;
for(let h=1;h<=24*16;h++){const ms=Date.parse(best.date)+h*3600000;if(new Date(ms).getUTCFullYear()!==2014)break;const g=geometry(ms); let maximum=0,minAngle=180;for(const p of seas){const normal=g.normal(p),v=offset.clone().sub(normal).normalize(); maximum=Math.max(maximum,mirrorStrength(g.sun,normal,v));if(normal.dot(g.sun)>0&&normal.dot(v)>0)minAngle=Math.min(minAngle,MathUtils.radToDeg(g.sun.clone().negate().reflect(normal).angleTo(v)));}if(maximum===0&&minAngle>4){absent={date:new Date(ms).toISOString(),maximumSeaIntensity:maximum,minimumReflectionMismatchDegrees:minAngle,solarAltitudeDegrees:MathUtils.radToDeg(Math.asin(g.normal(site).dot(g.sun)))};break;}}
if(!absent)throw Error('No zero-glint epoch found');
const report={scan:'2014-08-01..2014-08-31 UTC, hourly at the conservative Kraken interior nearest 63.1N/42E (broad surviving mask core); maximize Sun altitude. Camera aimed along reflected ray at 4.2 displayed radii from that surface point; then hold its center-relative display offset fixed and advance hourly.',seaTexels:seas.length,on:{...best,viewDirection:view.toArray(),cameraOffsetRadii:offset.toArray(),expectedIntensity:mirrorStrength(sun,n,view)},off:absent,independent:{analyticNormal:analytic.toArray(),numericNormal:numeric.toArray(),differenceDegrees:diff,coordinateConvention:'display axes for reference normals; site latitude north/east longitude'},limits:'The camera is a freely placed observer, not Cassini reconstruction. 2 degree reflection support and radiance 12 are visual enhancement. PIA17655 mask intentionally omits uncertain coastline and label pixels.'};
await writeFile(output+'/geometry.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
