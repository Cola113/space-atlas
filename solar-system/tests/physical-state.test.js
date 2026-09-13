import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3,PerspectiveCamera } from 'three';
import { telescopeFieldOfView,SURFACE_FOV_DEGREES,TELESCOPE_MAGNIFICATIONS } from '../src/surface/lens.js';
import { physicalData } from '../src/physical-scale.js';
import { surfaceFrame,landingSites } from '../src/surface/geometry.js';
import { PhysicalState } from '../src/physics/state.js';
import { EphemerisStore,MissingEphemerisError } from '../src/physics/ephemeris.js';
import { ObservationGate } from '../src/physics/observation-gate.js';
import { SurfaceClock } from '../src/surface/SurfaceClock.js';
import { localPhysics,localFetcher } from './physical-fixture.js';
import { bodyOrientation } from '../src/physics/orientation.js';

test('telescope magnification changes camera projection and the reported angle, preserving physical directions',()=>{
  const camera=new PerspectiveCamera(SURFACE_FOV_DEGREES,1.5,10,3000);
  const direction=new Vector3(Math.sin(.01),0,-Math.cos(.01)).multiplyScalar(500);
  const baseline=direction.clone().project(camera).x;
  for(const zoom of TELESCOPE_MAGNIFICATIONS){
    camera.zoom=zoom;camera.updateProjectionMatrix();
    assert.ok(Math.abs(direction.clone().project(camera).x/baseline-zoom)<1e-12);
    assert.ok(Math.abs(camera.getEffectiveFOV()-telescopeFieldOfView(zoom))<1e-12);
    assert.ok(Math.abs(direction.length()-500)<1e-10);
  }
  assert.equal(telescopeFieldOfView(1),62);
  assert.ok(telescopeFieldOfView(8)>8&&telescopeFieldOfView(8)<9);
});

test('Mercury preserves the 3:2 resonance and the Sun spans about 1.14 to 1.73 degrees over multiple orbits',()=>{
  const provider=localPhysics(),start=Date.parse('2000-01-01T12:00:00Z'),period=87.9691*86400000;
  const rotation=bodyOrientation('mercury',new Date(start+2*period)).primeMeridian-bodyOrientation('mercury',new Date(start)).primeMeridian;
  assert.ok(Math.abs(rotation-3*360)<.03,`two orbits / three rotations: ${rotation} degrees`);
  const diameters=[];
  for(let day=0;day<=264;day++){
    const target=surfaceFrame(landingSites.mercury,new Date(start+day*86400000),provider).targets.Sun;
    diameters.push(target.angularDiameter*180/Math.PI);
  }
  const min=Math.min(...diameters),max=Math.max(...diameters);
  assert.ok(min>1.13&&min<1.15,`aphelion: ${min}`);
  assert.ok(max>1.72&&max<1.75,`perihelion: ${max}`);
  provider.dispose();
});

test('156 surface directions, distances and angular diameters agree with independent CSPICE over four orbits and both boundaries',async()=>{
  const provider=localPhysics();
  const {fixtures}=JSON.parse(await readFile(new URL('surface-reference.json',import.meta.url),'utf8'));
  const errors={relativeKm:0,distanceKm:0,directionRadians:0,angularDiameterRadians:0};
  for(const sample of fixtures){
    const date=new Date(sample.date),site=landingSites[sample.id];
    await provider.ensure(date,[sample.id],{prefetch:false});
    const frame=surfaceFrame(site,date,provider),target=frame.targets[site.parent];
    const relative=target.positionKm.clone().sub(frame.centerKm);
    const difference={relativeKm:relative.distanceTo(new Vector3().fromArray(sample.parentRelativeKm)),
      distanceKm:Math.abs(target.distanceKm-sample.distanceKm),
      directionRadians:target.direction.angleTo(new Vector3().fromArray(sample.parentDirection)),
      angularDiameterRadians:Math.abs(target.angularDiameter-sample.angularDiameter)};
    for(const key of Object.keys(errors))errors[key]=Math.max(errors[key],difference[key]);
    assert.ok(difference.relativeKm<1,`${sample.id} ${sample.date}: position ${difference.relativeKm} km`);
    assert.ok(difference.distanceKm<1,`${sample.id}: distance`);
    assert.ok(difference.directionRadians<1e-5,`${sample.id}: direction ${difference.directionRadians} rad`);
    assert.ok(difference.angularDiameterRadians<1e-6,`${sample.id}: angular scale`);
  }
  provider.dispose();
  console.log('Independent surface geometry maximum differences:',JSON.stringify(errors));
});

test('missing in-range ephemerides never substitute a circular orbit; loaded revisions replace the shared frame',async()=>{
  const provider=localPhysics(),date=new Date('1971-08-01T17:00:00Z');
  const before=provider.frame(date);
  assert.ok(before.bodies.has('moon'));assert.ok(before.bodies.has('europa'));
  for(const id of ['enceladus','titan','miranda','pluto','charon']){
    assert.equal(before.bodies.has(id),false);
    assert.throws(()=>provider.frame(date,{required:[id]}),MissingEphemerisError);
  }
  await provider.ensure(date,['enceladus'],{prefetch:false});
  const after=provider.frame(date,{required:['enceladus']});
  assert.notEqual(after,before);
  assert.equal(surfaceFrame(landingSites.enceladus,date,provider).physical,after);
  assert.equal(provider.frame(date),after,'same date uses the same evaluated frame');
  assert.deepEqual(after.bodies.get('earth').positionKm,before.bodies.get('earth').positionKm);
  for(const [id,body] of after.bodies)assert.equal(body.radiusKm,physicalData[id].radiusKm);
  provider.dispose();
});

test('outside-range two-body extrapolation is labelled and joins both JPL boundaries without position jumps',async()=>{
  const provider=localPhysics();
  for(const boundary of ['1900-01-01T00:00:00Z','2101-01-01T00:00:00Z']){
    const t=Date.parse(boundary),inside=new Date(t+(boundary.startsWith('1900')?0:-1)),outside=new Date(t+(boundary.startsWith('1900')?-1:0));
    await provider.ensure(inside,['enceladus','miranda','pluto'],{prefetch:false});
    const a=provider.frame(inside),b=provider.frame(outside);
    assert.match(b.accuracy,/范围外近似/);
    for(const id of ['enceladus','titan','miranda','pluto','charon']){
      assert.ok(a.bodies.get(id).positionKm.distanceTo(b.bodies.get(id).positionKm)<.2,`${boundary}/${id}: discontinuity`);
      assert.match(b.bodies.get(id).model,/二体轨道外推/);
    }
  }
  provider.dispose();
});

test('a year-loading failure suspends the observing clock until retry, preserving pause intent and preventing catch-up',async()=>{
  let fail=true,requests=0;
  const provider=new PhysicalState({ephemeris:new EphemerisStore({fetcher:async path=>{
    if(path==='/ephemeris/saturn/1972.bin'){requests++;if(fail)return {ok:false,status:503};}
    return localFetcher(path);
  }})});
  const start=Date.parse('1971-12-31T23:59:59Z');
  await provider.ensure(new Date(start),['titan'],{prefetch:false});
  const gate=new ObservationGate(provider,['titan']);
  const clock=new SurfaceClock(start,1000);clock.canAdvance=time=>gate.check(new Date(time));
  clock.tick(0);clock.tick(100);
  await assert.rejects(gate.pending,MissingEphemerisError);
  assert.equal(clock.time,start);assert.equal(clock.playing,true);
  for(let i=1;i<=20;i++)clock.tick(100+i*100);
  assert.equal(requests,1,'failed year is not fetched every animation frame');
  fail=false;clock.playing=false;await gate.retry();
  clock.tick(100000);assert.equal(clock.time,start);assert.equal(clock.playing,false);
  clock.playing=true;clock.suspend();clock.tick(200000);clock.tick(200100);
  assert.equal(clock.time,start+100000,'only elapsed time after resume is applied');
  gate.dispose();provider.dispose();
});

test('reverse year failure holds date; changing direction into cached data clears the gate without retrying the failed year',async()=>{
  let failures=0;
  const provider=new PhysicalState({ephemeris:new EphemerisStore({fetcher:async path=>{
    if(path==='/ephemeris/saturn/1970.bin'){failures++;return {ok:false,status:503};}
    return localFetcher(path);
  }})});
  const start=Date.parse('1971-01-01T00:00:01Z');await provider.ensure(new Date(start),['titan'],{prefetch:false});
  const gate=new ObservationGate(provider,['titan']);const clock=new SurfaceClock(start,1000);
  clock.setDirection(-1);clock.canAdvance=time=>gate.check(new Date(time));clock.tick(0);clock.tick(100);
  await assert.rejects(gate.pending,MissingEphemerisError);assert.equal(clock.time,start);assert.equal(failures,1);
  clock.setDirection(1);assert.equal(gate.check(new Date(clock.time)),true);assert.equal(gate.blocked,false);
  clock.tick(10000);clock.tick(10100);assert.equal(clock.time,start+100000);assert.equal(failures,1);
  gate.dispose();provider.dispose();
});
