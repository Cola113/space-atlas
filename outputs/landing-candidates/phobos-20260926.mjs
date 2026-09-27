// Read-only candidate analysis: no landing registration, image or camera changes.
// npx tsx outputs/landing-candidates/phobos-20260926.mjs
import { writeFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { PhysicalState } from '../../solar-system/src/physics/state.js';
import { EphemerisStore } from '../../solar-system/src/physics/ephemeris.js';
import { physicalDefinitions,rotationPeriodDays } from '../../solar-system/src/physics/definitions.js';
import { physicalTime } from '../../solar-system/src/physics/time.js';
import { orbitalBasis } from '../../solar-system/src/physics/reference-planes.js';
import { physicalData } from '../../solar-system/src/physical-scale.js';
import { surfaceFrame,horizonAngles } from '../../solar-system/src/surface/geometry.js';
import { localFetcher } from '../../scripts/verify-phobos-reference.mjs';
const provider=new PhysicalState({ephemeris:new EphemerisStore({fetcher:localFetcher,maxEntries:16})});
const D=180/Math.PI,iso=t=>new Date(t).toISOString(),cycleMs=rotationPeriodDays('phobos')*86400000;
const sites=[60,150,311].map(longitude=>({id:'phobos',parent:'Mars',latitude:1,longitude}));
const orbit=physicalDefinitions.bodies.phobos.orbit,oldBasis=orbitalBasis(orbit);
function oldMean(t) {
  const days=physicalTime(new Date(t)).tdbDays-(orbit.epochTdbJd-2451545);
  const M=(orbit.meanAnomalyDegrees/D+days/orbit.periodDays*2*Math.PI)%(2*Math.PI),e=orbit.e; let E=M;
  for(let n=0;n<24;n++){const d=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));E-=d;if(Math.abs(d)<1e-13)break;}
  return oldBasis.p.clone().multiplyScalar(orbit.a.value*(Math.cos(E)-e)).addScaledVector(oldBasis.q,orbit.a.value*Math.sqrt(1-e*e)*Math.sin(E));
}
function state(site,t) {
  const f=surfaceFrame(site,new Date(t),provider),m=f.targets.Mars,s=f.targets.Sun;
  const marsAltitude=horizonAngles(m.direction).altitude,sunAltitude=horizonAngles(s.direction).altitude;
  const marsDiameter=m.angularDiameter*D,sunRadius=s.angularDiameter*D/2;
  const sep=m.direction.angleTo(s.direction)*D;
  const occulted=sep<marsDiameter/2+sunRadius;
  const phase=(1+m.positionKm.clone().negate().normalize().dot(f.observerKm.clone().sub(m.positionKm).normalize()))/2;
  const daylight=sunAltitude>8&&!occulted;
  return {date:iso(t),marsAltitude,marsDiameter,marsDistanceKm:m.distanceKm,sunAltitude,illuminatedFraction:phase,
    visible:marsAltitude+marsDiameter/2>0,fullDisc:marsAltitude-marsDiameter/2>0,
    daylight,daylightAndMars:daylight&&marsAltitude+marsDiameter/2>0,occulted,
    visibleSolarEclipse:occulted&&sunAltitude+sunRadius>0,
    score:daylight&&marsAltitude-marsDiameter/2>0 ? phase*marsDiameter*marsDiameter : null};
}
const flags=['visible','fullDisc','daylight','daylightAndMars','occulted','visibleSolarEclipse'];
function bisect(site,lo,hi,key,before){while(hi-lo>1000){const mid=(lo+hi)/2;if(state(site,mid)[key]===before)lo=mid;else hi=mid;}return (lo+hi)/2;}
function cycle(site,start) {
  const end=start+cycleMs,steps=Math.ceil(cycleMs/10000),rows=[];
  for(let i=0;i<=steps;i++)rows.push({t:start+(end-start)*i/steps,...state(site,start+(end-start)*i/steps)});
  const result={start:iso(start),end:iso(end),sampleCount:rows.length,stepSeconds:cycleMs/steps/1000,ranges:{},windows:{}};
  for(const key of ['marsAltitude','marsDiameter','marsDistanceKm','sunAltitude','illuminatedFraction'])result.ranges[key]=[Math.min(...rows.map(r=>r[key])),Math.max(...rows.map(r=>r[key]))];
  for(const key of flags) {
    const intervals=[];let entry=rows[0][key]?start:null;
    for(let i=1;i<rows.length;i++)if(rows[i][key]!==rows[i-1][key]) {
      const edge=bisect(site,rows[i-1].t,rows[i].t,key,rows[i-1][key]);
      if(rows[i][key])entry=edge;else {intervals.push([iso(entry),iso(edge)]);entry=null;}
    }
    if(entry!==null)intervals.push([iso(entry),iso(end)]);
    result.windows[key]={intervals,totalSeconds:intervals.reduce((sum,[a,b])=>sum+(Date.parse(b)-Date.parse(a))/1000,0)};
  }
  return result;
}
const meanComparison=[];
for(const date of ['1900-01-01','1950-06-15','1971-08-01','2000-01-01','2026-09-15','2026-09-26','2050-01-01','2100-12-31']) {
  const t=Date.parse(date+'T00:00:00Z');await provider.ensure(new Date(t),['phobos'],{prefetch:false});
  const old=oldMean(t),real=provider.frame(new Date(t)).bodies.get('phobos').relativeKm;
  meanComparison.push({date:iso(t),positionDifferenceKm:old.distanceTo(real),marsCentricDirectionArcmin:old.angleTo(real)*D*60,
    candidateMarsDirectionArcmin:sites.map(site=>{
      const f=surfaceFrame(site,new Date(t),provider),observerOffset=f.observerKm.clone().sub(f.centerKm);
      const a=real.clone().negate().sub(observerOffset),b=old.clone().negate().sub(observerOffset);
      return {longitude:site.longitude,arcmin:a.angleTo(b)*D*60};
    })});
}
await provider.ensure(new Date('2026-09-26'),['phobos'],{prefetch:false});
const routes=sites.map(site=>({site,originalDateCycle:cycle(site,Date.parse('2026-09-15T00:00:00Z')),taskDateCycle:cycle(site,Date.parse('2026-09-26T00:00:00Z'))}));
console.log('One-cycle true-state results:',JSON.stringify(routes.map(r=>({longitude:r.site.longitude,oldDate:r.originalDateCycle.ranges,taskDate:r.taskDateCycle.ranges}))));
const yearStart=Date.parse('2026-01-01T00:00:00Z'),yearEnd=Date.parse('2027-01-01T00:00:00Z'),step=10*60000;
const scan=sites.map(()=>({range:{marsAltitude:[Infinity,-Infinity],marsDiameter:[Infinity,-Infinity]},eclipseDates:new Set(),allShadowDates:new Set(),best:null,visibleSamples:0,daylightSamples:0}));
let count=0;
for(let t=yearStart;t<yearEnd;t+=step) {
  for(let i=0;i<sites.length;i++) {
    const row=state(sites[i],t),a=scan[i];
    for(const k of Object.keys(a.range))a.range[k]=[Math.min(a.range[k][0],row[k]),Math.max(a.range[k][1],row[k])];
    if(row.visibleSolarEclipse)a.eclipseDates.add(row.date.slice(0,10));
    if(row.occulted)a.allShadowDates.add(row.date.slice(0,10));
    if(row.visible)a.visibleSamples++;if(row.daylight)a.daylightSamples++;
    if(row.score!==null&&(!a.best||row.score>a.best.score))a.best=row;
  }
  count++;
}
const groupDates=values=>{const sorted=[...values].sort(),groups=[];for(const d of sorted){const last=groups.at(-1);if(last&&Date.parse(d)-Date.parse(last[1])===86400000)last[1]=d;else groups.push([d,d]);}return groups;};
// Refine dates around the two seasonal edges detected by the broad scan. Keep
// scan evidence distinct from a proof that every arbitrarily short event exists.
const eclipseEdgeWindows=[['2026-02-27','2026-03-06'],['2026-06-04','2026-06-12']];
for(const [a,b] of eclipseEdgeWindows) for(let t=Date.parse(a);t<Date.parse(b);t+=60000) {
  for(let i=0;i<sites.length;i++) {
    const row=state(sites[i],t);
    if(row.visibleSolarEclipse)scan[i].eclipseDates.add(row.date.slice(0,10));
    if(row.occulted)scan[i].allShadowDates.add(row.date.slice(0,10));
  }
}
for(let i=0;i<sites.length;i++) {
  const a=scan[i];
  if(a.best) {
    const center=Date.parse(a.best.date);
    for(let t=center-step;t<=center+step;t+=1000){const row=state(sites[i],t);if(row.score!==null&&row.score>a.best.score)a.best=row;}
  }
  routes[i].yearScan={sampleCount:count,stepSeconds:step/1000,ranges:a.range,
    observableSolarEclipseDates:groupDates(a.eclipseDates),solarOccultationDatesIgnoringHorizon:groupDates(a.allShadowDates),
    visibleSamples:a.visibleSamples,daylightSamples:a.daylightSamples,bestViewingCandidate:a.best};
}
const result={taskDate:'2026-09-26',provider:'MAR099 original coefficients, 401/4 minus 499/4; Mars heliocentric translation from unchanged Astronomy Engine 2.1.19',
  attitude:'unchanged PCK00011 IAU_PHOBOS',coordinates:'planetocentric 1 deg north, east-positive longitude; mean-radius sphere plus 1.65 m eye; no DEM',
  cycleSeconds:cycleMs/1000,windowDefinition:'visible=any Mars limb above horizon; fullDisc=lower limb above horizon; daylight=Sun center > 8 deg and no solar-disc overlap with Mars using asin spherical angular radii. Hypothetical viewing condition, NOT spacecraft landing feasibility or an enabled landing entry.',
  bestDefinition:'2026-01-01 inclusive to 2027-01-01 exclusive, 10 minute scan then one second refinement within +/-10 minutes of the best sample; maximize illuminatedFraction*angularDiameter^2 while the entire Mars disc is above horizon, Sun >8 deg and not eclipsed. A reproducible candidate, not a global optimum proof or a user route choice.',
  eclipseEdgeRefinement:{windows:eclipseEdgeWindows,stepSeconds:60,limitation:'Sub-minute grazing events and exact seasonal contacts are not guaranteed by this scan.'},
  meanComparison,legacyMeanElements:{...orbit,provider:'mean-kepler',stateSource:undefined,validity:'Historical mean-element inputs preserved from origin/main 5c2efea, evaluated only for this comparison.'},routes};
await writeFile(new URL('phobos-results-20260926.json',import.meta.url),JSON.stringify(result,null,2));
console.log('Annual scan:',JSON.stringify(routes.map(r=>({longitude:r.site.longitude,...r.yearScan}))));
provider.dispose();
