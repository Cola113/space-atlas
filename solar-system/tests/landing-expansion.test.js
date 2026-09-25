import test, {before} from 'node:test';
import {prepareSurfaceTests} from './physical-fixture.js';
before(prepareSurfaceTests);
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MathUtils, Vector3 } from 'three';
import { landingSites,sitesForBody,defaultSiteId,surfaceFrame,angularDiameter,horizonAngles,bodyBasis,nextDaylight,sunHiddenByParent } from '../src/surface/geometry.js';
import { landableBodyIds } from '../src/surface/sites.js';
import { solarVisibility,surfaceLight } from '../src/surface/SurfaceSky.js';

const altitudeOf=(site,target,offsetMs=0)=>
  horizonAngles(surfaceFrame(site,new Date(Date.parse(site.date)+offsetMs)).targets[target].direction).altitude;

test('every landing site has a decodable local image and never draws the observer body in the sky',async()=>{
  assert.equal(landableBodyIds.length,13);
  assert.equal(Object.keys(landingSites).length,19);
  for(const [siteId,site] of Object.entries(landingSites)){
    assert.equal(site.siteId,siteId,'a site id must match its key');
    const frame=surfaceFrame(site);
    const file=await readFile(new URL(`../../public${site.texture}`,import.meta.url));
    assert.equal(file.toString('ascii',8,12),'WEBP',siteId);
    assert.ok(frame.targets[site.parent],siteId);
    if(site.body)assert.equal(frame.targets[site.body],undefined,siteId);
    for(const target of Object.values(frame.targets))assert.ok(Number.isFinite(target.distanceKm)&&target.distanceKm>0,siteId);
    assert.ok(Number.isFinite(surfaceLight(frame,site,25).brightness),siteId);
  }
});

test('a body may carry several sites and keeps its own-keyed one as the default',()=>{
  assert.deepEqual(sitesForBody('moon').map(s=>s.siteId),['moon','moon-farside']);
  assert.deepEqual(sitesForBody('europa').map(s=>s.siteId),['europa','europa-subjovian']);
  for(const bodyId of landableBodyIds){
    const sites=sitesForBody(bodyId);
    assert.ok(sites.length>=1,bodyId);
    for(const site of sites)assert.equal(site.id,bodyId);
    assert.equal(defaultSiteId(bodyId),bodyId,`${bodyId} keeps its original site as the default`);
  }
  const coords=new Set(Object.values(landingSites).map(site=>`${site.id}:${site.latitude},${site.longitude}`));
  assert.equal(coords.size,Object.keys(landingSites).length,'two sites on one body must not share coordinates');
});

test('second sites on one body show a different sky from the first',()=>{
  // Earth is the Moon's parent, so a far-side site is decided by libration alone.
  assert.ok(altitudeOf(landingSites['moon-farside'],'Earth')<-30);
  assert.ok(altitudeOf(landingSites.moon,'Earth')>40);
  // Mutually locked Pluto and Charon: each other's sites sit on opposite hemispheres.
  assert.ok(altitudeOf(landingSites['pluto-charonface'],'Charon')>60);
  assert.ok(altitudeOf(landingSites.pluto,'Charon')<-60);
  // The sub-Jovian point is the highest ground for Jupiter; the first sites sat 55 to 62 degrees from it.
  assert.ok(altitudeOf(landingSites['io-subjovian'],'Jupiter')>80);
  assert.ok(altitudeOf(landingSites.io,'Jupiter')<40);
  assert.ok(altitudeOf(landingSites['europa-subjovian'],'Jupiter')>80);
  assert.ok(altitudeOf(landingSites.europa,'Jupiter')<40);
  assert.ok(altitudeOf(landingSites.charon,'Pluto')>80);
});

test('synchronous rotation keeps the parent in place at a sub-parent site',()=>{
  for(const id of ['charon','pluto-charonface','io-subjovian','europa-subjovian']){
    const site=landingSites[id], half=site.solarDay*86400000/2;
    const drift=Math.abs(altitudeOf(site,site.parent)-altitudeOf(site,site.parent,half));
    assert.ok(drift<6,`${id}: parent altitude drifts ${drift.toFixed(2)} degrees over half a rotation`);
  }
});

test('Mercury has a slowly moving solar direction and the physically larger Sun',()=>{
  const site=landingSites.mercury,date=new Date(site.date),a=surfaceFrame(site,date),b=surfaceFrame(site,new Date(+date+86400000));
  const diameter=MathUtils.radToDeg(angularDiameter(695700,a.targets.Sun.distanceKm));
  assert.ok(diameter>1.1&&diameter<1.8);
  assert.ok(a.targets.Sun.direction.angleTo(b.targets.Sun.direction)<.12);
  assert.equal(solarVisibility(a,695700,'Sun'),1,'Sun must never eclipse itself');
  assert.equal(a.targets.Mercury,undefined);
});

test('the polar Sun at Mercury stays within a couple of degrees of the horizon',()=>{
  const site=landingSites['mercury-pole'],start=Date.parse(site.date),cycle=site.solarDay*86400000;
  const altitudes=[];
  for(let n=0;n<=96;n++)altitudes.push(horizonAngles(surfaceFrame(site,new Date(start+n*cycle/96)).targets.Sun.direction).altitude);
  assert.ok(Math.max(...altitudes)<4&&Math.min(...altitudes)>-4,`polar Sun reached ${Math.max(...altitudes).toFixed(1)} degrees`);
  // A whole Mercurian year goes by without the Sun climbing; it circles instead.
  assert.ok(Math.max(...altitudes)-Math.min(...altitudes)>2,'the Sun must still travel around the horizon');
});

test('Sputnik Planitia stays on the hemisphere facing away from Charon',()=>{
  for(const date of ['1971-08-01','2000-01-01','2026-09-12','2040-05-20']){
    const f=surfaceFrame(landingSites.pluto,new Date(date));
    assert.ok(horizonAngles(f.targets.Charon.direction).altitude < -65);
    assert.ok(Math.abs(f.targets.Charon.distanceKm-20700)<400);
  }
});

test('outer moon parent sizes retain physical scale with independently changing IAU attitudes',()=>{
  for(const [id,min,max] of [['titan',5,6],['enceladus',27,30],['miranda',21,24]]){
    const site=landingSites[id],a=surfaceFrame(site),b=surfaceFrame(site,new Date(Date.parse(site.date)+86400000));
    const size=MathUtils.radToDeg(angularDiameter(site.parentRadiusKm,a.targets[site.parent].distanceKm));
    assert.ok(size>min&&size<max,`${id}: ${size}`);
    assert.notDeepEqual(a.targets[site.parent].direction.toArray(),b.targets[site.parent].direction.toArray(),'geometric libration remains; precise amplitude is checked against CSPICE');
    assert.ok(a.targets.Sun.direction.angleTo(b.targets.Sun.direction)>.01,id);
    const basis=bodyBasis(site.body,new Date(site.date));
    assert.ok(Math.abs(basis.prime.dot(basis.north))<1e-12);
  }
});

test('the Phoenix site is in polar day at its own landing date',()=>{
  const site=landingSites['mars-phoenix'],start=Date.parse(site.date),sol=site.solarDay*86400000;
  const altitudes=[];
  for(let n=0;n<48;n++)altitudes.push(horizonAngles(surfaceFrame(site,new Date(start+n*sol/48)).targets.Sun.direction).altitude);
  assert.ok(Math.min(...altitudes)>0,`the Sun sets at the polar site: ${Math.min(...altitudes).toFixed(1)} degrees`);
  assert.ok(Math.max(...altitudes)<60,'the polar Sun must stay low');
});

test('the moon-viewer site on Earth lands at night with a half-degree Moon already up',()=>{
  const site=landingSites.earth,frame=surfaceFrame(site);
  const moon=frame.targets.Moon;
  assert.ok(moon,'the Moon must be a computed neighbour from the ground');
  const diameter=MathUtils.radToDeg(moon.angularDiameter);
  assert.ok(diameter>.45&&diameter<.62,`the Moon spans ${diameter.toFixed(3)} degrees`);
  assert.ok(horizonAngles(moon.direction).altitude>8,'the default instant has the Moon above the cloud sea');
  assert.ok(horizonAngles(frame.targets.Sun.direction).altitude<-8,'the default instant is night');
  // 满月窗口：月亮几乎正对太阳的反方向，亮度比例接近 1。
  const elongation=moon.direction.angleTo(frame.targets.Sun.direction);
  assert.ok(elongation>2.9&&elongation<3.4,'the default instant is near full moon');
});

test('moonlight lifts the ground only where the site opts in',()=>{
  // Pure geometry fixture: the Sun sits 30 degrees below the horizon; the full
  // Moon is its exact opposite (30 degrees up, azimuth 180 away), the new Moon
  // sits at the Sun's position where a night side puts it anyway.
  const direction=(azimuth,altitude)=>new Vector3(Math.sin(azimuth)*Math.cos(altitude),Math.sin(altitude),-Math.cos(azimuth)*Math.cos(altitude));
  const frame=(moonAzimuth,moonAltitude)=>({targets:{
    Sun:{direction:direction(0,-30*Math.PI/180),distanceKm:1.496e8},
    Moon:{direction:direction(moonAzimuth,moonAltitude),distanceKm:3.844e8}}});
  const viewer={nightFloor:.025,moonlight:.15,parent:'Sun',parentRadiusKm:695700};
  const plain={nightFloor:.025,parent:'Sun',parentRadiusKm:695700};
  const full=surfaceLight(frame(Math.PI,30*Math.PI/180),viewer,25).brightness;
  const dark=surfaceLight(frame(0,-30*Math.PI/180),viewer,25).brightness;
  assert.ok(full>.09,`a full moon high in the sky lifts the ground, got ${full.toFixed(3)}`);
  assert.ok(Math.abs(dark-.025)<1e-9,`a new moon leaves the night floor, got ${dark.toFixed(4)}`);
  assert.ok(Math.abs(surfaceLight(frame(Math.PI,30*Math.PI/180),plain,25).brightness-.025)<1e-9,'sites without the opt-in stay at the floor');
  assert.ok(surfaceLight(frame(Math.PI,30*Math.PI/180),viewer,25).stars<1.2,'the full moon also dims the star field');
});

test('daylight jump advances a night landing to an actually illuminated time',()=>{
  for(const id of ['mars','mercury','io']){
    const site=landingSites[id],start=Date.parse(site.date),time=nextDaylight(site,start);
    assert.ok(time>start,id);
    assert.ok(horizonAngles(surfaceFrame(site,new Date(time)).targets.Sun.direction).altitude>8,id);
  }
});

test('the daylight jump never lands inside the parent\'s shadow',()=>{
  // At a sub-parent site the Sun passes behind the parent once per orbit; jumping to
  // the highest Sun would land in that eclipse, which is dark ground, not daylight.
  for(const id of ['io-subjovian','europa-subjovian','io','europa','enceladus']){
    const site=landingSites[id],start=Date.parse(site.date),time=nextDaylight(site,start);
    if(time===null)continue;
    const frame=surfaceFrame(site,new Date(time));
    assert.equal(sunHiddenByParent(frame,site),false,`${id}: daylight jump landed behind ${site.parent}`);
  }
  // The occultation itself is real and must not be optimised away: the sub-Jovian
  // point really does lose the Sun once an orbit.
  const site=landingSites['europa-subjovian'],start=Date.parse(site.date),cycle=site.solarDay*86400000;
  let hidden=0;
  for(let n=0;n<=240;n++){
    const time=start+n*cycle/240;
    if(sunHiddenByParent(surfaceFrame(site,new Date(time)),site))hidden++;
  }
  assert.ok(hidden>0,'the parent must still be able to occult the Sun');
});
