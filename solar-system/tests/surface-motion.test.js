import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,PerspectiveCamera} from 'three';
import {SurfaceClock} from '../src/surface/SurfaceClock.js';
import {simulationElapsed, simulationRates, defaultSimulationRate, restoreSimulationRate,
  defaultSimulationDate, restoreSimulationDate, formatSimulationRate, simulationRateEquivalent} from '../src/simulation-time.js';
import {SurfaceJourney} from '../src/surface/SurfaceJourney.js';
import {SurfaceExposure} from '../src/surface/SurfaceExposure.js';
import {solarVisibility,surfaceLight,surfaceCameraRange,surfaceWindCycle} from '../src/surface/SurfaceSky.js';
import {landingSites,surfaceFrame,bodyBasis} from '../src/surface/geometry.js';

test('surface clock advances at the selected rate, freezes and resets without catch-up',()=>{
  const clock=new SurfaceClock(landingSites.europa.date),epoch=clock.time;
  clock.tick(100);clock.tick(600);assert.equal(clock.time-epoch,500_000);
  clock.setRate(20_000);clock.tick(1100);assert.equal(clock.time-epoch,10_500_000);
  clock.playing=false;clock.tick(1600);clock.tick(2100);assert.equal(clock.time-epoch,10_500_000);
  clock.tick(30000,false);clock.playing=true;clock.tick(60000);assert.equal(clock.time-epoch,10_500_000);
  clock.tick(60100);assert.equal(clock.time-epoch,12_500_000);
  clock.tick(90000);assert.equal(clock.time-epoch,12_500_000);
  clock.reset();clock.tick(200000);assert.equal(clock.time,epoch);
  assert.equal(clock.rate,20_000,'rewinding the date keeps the selected rate');
  for(const value of [-1,0,1,499,600,3000,30_000,100_001,NaN,Infinity])assert.throws(()=>clock.setRate(value),RangeError);
});

test('both clocks use five real-time presets, default to 1k and carry the rate across landings',()=>{
  const epoch=Date.parse(landingSites.moon.date),clock=new SurfaceClock(epoch);
  assert.deepEqual(simulationRates,[500,1000,5000,20000,100000]);
  assert.equal(clock.rate,1_000);
  assert.equal(defaultSimulationRate,1_000);
  clock.tick(0);clock.tick(1000);
  assert.equal(clock.time-epoch,1_000_000,'default is 16 minutes 40 seconds per real second');
  clock.setRate(500);clock.tick(2000);
  assert.equal(clock.time-epoch,1_500_000);
  clock.setRate(100_000);clock.tick(3000);
  assert.equal(clock.time-epoch,101_500_000);
  assert.equal(simulationElapsed(1000,1),1000,'the unit remains a multiple of real time');
  for(const rate of simulationRates){
    const landing=new SurfaceClock(epoch,rate);landing.tick(0);landing.tick(1000);
    assert.equal(landing.time-epoch,simulationElapsed(1000,rate),'orbit and surface use identical units');
  }
  const nextLanding=new SurfaceClock(clock.time,clock.rate);
  assert.equal(nextLanding.rate,100_000);
  assert.equal(nextLanding.time,clock.time,'the date carries across landings');
});

test('saved obsolete multipliers reset to 1k while supported presets survive reload',()=>{
  for(const saved of [undefined,{}, {speed:.01}, {speed:1}, {speed:64},
    {speed:1_000_000,speedUnit:'realtime'}, {speed:3000,speedUnit:'realtime'}, {speed:2592,speedUnit:'realtime'}]){
    assert.equal(restoreSimulationRate(saved),1_000);
  }
  for(const speed of simulationRates)assert.equal(restoreSimulationRate({speed,speedUnit:'realtime'}),speed);
});

test('the historical timeline starts in 1971 and restores progress after migration',()=>{
  assert.equal(new Date(defaultSimulationDate).toISOString(),'1971-08-01T17:00:00.000Z');
  for(const saved of [undefined,{}, {date:Date.now()}, {timelineEpoch:defaultSimulationDate,date:NaN}]){
    assert.equal(restoreSimulationDate(saved),defaultSimulationDate);
  }
  const saved={timelineEpoch:defaultSimulationDate,date:defaultSimulationDate+5*86400000};
  assert.equal(restoreSimulationDate(saved),saved.date);
});

test('surface time advances and rewinds the orbit timeline immediately, including while paused',()=>{
  const orbit={date:defaultSimulationDate},clock=new SurfaceClock(orbit.date,1000,time=>{orbit.date=time;});
  clock.tick(0);clock.tick(1000);
  assert.equal(orbit.date,defaultSimulationDate+1_000_000);
  clock.playing=false;clock.tick(2000);
  assert.equal(orbit.date,clock.time);
  clock.reset();
  assert.equal(orbit.date,defaultSimulationDate);
  clock.playing=true;clock.tick(3000);clock.tick(3500);
  assert.equal(orbit.date,defaultSimulationDate+500_000);
});

test('time controls abbreviate large multiples and explain real-time conversion',()=>{
  assert.equal(formatSimulationRate(1),'1×');
  assert.equal(formatSimulationRate(500),'500×');
  assert.equal(formatSimulationRate(1_000),'1k×');
  assert.equal(formatSimulationRate(20_000),'20k×');
  assert.equal(formatSimulationRate(100_000),'100k×');
  assert.equal(formatSimulationRate(1_000_000),'1m×');
  assert.equal(formatSimulationRate(1_000_000_000),'1b×');
  assert.equal(simulationRateEquivalent(1),'现实 1 秒 = 模拟 1 秒');
  assert.equal(simulationRateEquivalent(1_000),'现实 1 秒 = 模拟 16.67 分钟');
  assert.equal(simulationRateEquivalent(1_000_000),'现实 1 秒 = 模拟 11.57 天');
});

test('the thin Earth cloud shell stays separated in a 24-bit surface depth buffer',()=>{
  const camera=new PerspectiveCamera(62,1,surfaceCameraRange.near,surfaceCameraRange.far);
  const depthSteps=distance=>Math.round((new Vector3(0,0,-distance).project(camera).z*.5+.5)*(2**24-1));
  // Lunar distance changes Earth's display radius; test the small, close layers
  // which used to fall into the same depth-buffer values and flicker.
  for(const radius of [4.5,5,5.5]){
    assert.ok(depthSteps(301-radius)-depthSteps(301-radius*1.003)>8);
  }
});

test('cloud flow stays bounded over decades and fades continuously through phase wraps',()=>{
  for(const hours of [-600000,-1,0,36,72,483127,574471,1e9]){
    const [a,b,blend]=surfaceWindCycle(hours);
    assert.ok(a>=0&&a<72&&b>=0&&b<72);
    assert.ok(blend>=0&&blend<=1);
  }
  // An arbitrary texture sample must not jump when either flow phase resets.
  const sample=hours=>{const [a,b,blend]=surfaceWindCycle(hours);return Math.sin(a/7)*(1-blend)+Math.sin(b/7)*blend;};
  for(const wrap of [-72,-36,0,36,72,483120]){
    assert.ok(Math.abs(sample(wrap-1e-5)-sample(wrap+1e-5))<1e-5);
  }
  assert.notEqual(sample(483127),sample(483128),'clouds still move');
});

test('arrival stays in orbit until assets are ready and reveals the ground under cover',()=>{
  const journey=new SurfaceJourney();
  journey.tick(10000);assert.equal(journey.phase,'preparing');assert.equal(journey.sample().orbit,0);
  journey.ready();journey.tick(2099);assert.equal(journey.sample().surface,false);assert.ok(journey.sample().cover>.999);
  journey.tick(1);assert.equal(journey.phase,'settling');assert.equal(journey.sample().cover,1);
  journey.tick(1300);assert.equal(journey.phase,'landed');assert.equal(journey.sample().settle,1);
  journey.exit();journey.tick(850);assert.equal(journey.phase,'retreating');assert.equal(journey.sample().cover,1);
  journey.tick(1500);assert.equal(journey.phase,'closed');assert.equal(journey.sample().orbit,0);
});

test('skip, early cancellation, asset failure and reduced motion cannot leave the app locked',()=>{
  const skipped=new SurfaceJourney();skipped.skip();assert.equal(skipped.phase,'preparing');
  skipped.ready();assert.equal(skipped.phase,'landed');skipped.exit();skipped.skip();assert.equal(skipped.phase,'closed');
  const cancelled=new SurfaceJourney();cancelled.ready();cancelled.tick(700);
  const progress=cancelled.sample().orbit;cancelled.exit();assert.equal(cancelled.sample().orbit,progress);
  cancelled.tick(2000);cancelled.ready();assert.equal(cancelled.phase,'closed');
  const pending=new SurfaceJourney();pending.exit();pending.ready();assert.equal(pending.phase,'closed');
  const failed=new SurfaceJourney();failed.fail();failed.exit();assert.equal(failed.phase,'closed');
  const reduced=new SurfaceJourney(true);reduced.ready();assert.equal(reduced.phase,'landed');reduced.exit();assert.equal(reduced.phase,'closed');
});

test('fast-forward changes local stars, satellite positions and planetary rotation',()=>{
  const site=landingSites.europa,start=new Date(site.date),later=new Date(+start+2*3600000);
  const a=surfaceFrame(site,start),b=surfaceFrame(site,later);
  const star=new Vector3(.2,.3,.4).normalize();
  assert.ok(a.local(star).angleTo(b.local(star))>.02);
  assert.ok(a.targets.Io.direction.angleTo(b.targets.Io.direction)>.01);
  assert.ok(a.targets.Sun.direction.angleTo(b.targets.Sun.direction)>.05);
  assert.ok(a.targets.Jupiter.direction.angleTo(b.targets.Jupiter.direction)<.01,'tidal lock keeps Jupiter nearly fixed');
  assert.ok(bodyBasis('Jupiter',start).prime.angleTo(bodyBasis('Jupiter',later).prime)>.5);
  assert.ok(bodyBasis('Earth',start).prime.angleTo(bodyBasis('Earth',later).prime)>.2);
});

test('daylight dims after sunset and during an occultation, with finite partial coverage',()=>{
  const frame={targets:{Sun:{direction:new Vector3(0,1,0),distanceKm:149597870.7},Jupiter:{direction:new Vector3(0,1,0),distanceKm:670000}}};
  assert.equal(solarVisibility(frame,69911,'Jupiter'),0);
  frame.targets.Jupiter.direction.set(1,0,0);
  assert.equal(solarVisibility(frame,69911,'Jupiter'),1);
  const daylight=surfaceLight(frame,landingSites.europa,12);
  frame.targets.Sun.direction.set(0,-1,0);
  assert.ok(surfaceLight(frame,landingSites.europa,12).brightness<daylight.brightness*.01);
  const angle=.104;
  frame.targets.Sun.direction.set(0,1,0);frame.targets.Jupiter.direction.set(Math.sin(angle),Math.cos(angle),0);
  const partial=solarVisibility(frame,69911,'Jupiter');assert.ok(partial>0&&partial<1);
});

test('Europa eclipse before sunset dims smoothly at 20k real-time speed',()=>{
  const site=landingSites.europa,start=Date.parse('2026-09-15T17:25:00Z');
  const exposure=new SurfaceExposure();
  let previous=null,sawEclipse=false,sawNight=false;
  for(let step=0;step<=120;step++){
    const time=start+simulationElapsed(step*50,20_000);
    const physical=surfaceLight(surfaceFrame(site,new Date(time)),site,12);
    const display=exposure.update(physical,.05);
    if(previous!==null)assert.ok(Math.abs(display.brightness-previous)<.2,'no abrupt black or bright frame');
    if(physical.eclipse===0){
      sawEclipse=true;
      assert.ok(display.brightness>.3,'brief eclipse remains visible without jumping to black');
    }
    if(physical.altitude<0&&display.brightness<.02)sawNight=true;
    previous=display.brightness;
  }
  assert.ok(sawEclipse&&sawNight,'keeps the eclipse and the following sunset');
});

test('display exposure freezes when paused, resets on rewind, and is independent of frame rate',()=>{
  const day={brightness:1.508,stars:.35},night={brightness:.008,stars:1.25};
  const sample=fps=>{
    const exposure=new SurfaceExposure();exposure.reset(day);
    for(let frame=0;frame<fps;frame++)exposure.update(night,1/fps);
    return exposure;
  };
  const thirty=sample(30),sixty=sample(60);
  assert.ok(Math.abs(thirty.value.brightness-sixty.value.brightness)<1e-10);
  assert.ok(Math.abs(thirty.value.stars-sixty.value.stars)<1e-10);
  const paused={...thirty.value};
  assert.deepEqual(thirty.update(night,0),paused);
  assert.deepEqual(thirty.reset(day),day);
});
