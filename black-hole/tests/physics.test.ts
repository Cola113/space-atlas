import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimulationClock } from '../src/simulation/Clock.ts';
import { MODEL, timePhases } from '../src/simulation/model.ts';
import { presetPose } from '../src/camera/CameraRig.ts';
import { QualityController } from '../src/quality/Quality.ts';

test('Schwarzschild critical orbit and ISCO are expressed in consistent rs units', () => {
  const u=1/MODEL.photonSphere;
  assert.ok(Math.abs(1.5*u*u-u)<1e-14);
  assert.ok(Math.abs(1/(MODEL.criticalImpact**2)-u*u*(1-u))<1e-14);
  assert.equal(MODEL.diskInner,3*MODEL.horizon);
});

test('wall-clock gaps do not jump simulation on background restore', () => {
  const clock=new SimulationClock();
  clock.tick(0); clock.tick(20);
  clock.speed=4; clock.tick(40);
  assert.ok(Math.abs(clock.time-0.1)<1e-12);
  clock.paused=true; clock.tick(60); assert.ok(Math.abs(clock.time-0.1)<1e-12);
  clock.setSuspended(true); clock.tick(50000);
  clock.setSuspended(false); clock.paused=false; clock.tick(120000);
  assert.ok(Math.abs(clock.time-0.1)<1e-12);
  clock.tick(120025); assert.ok(Math.abs(clock.time-0.2)<1e-12);
  clock.tick(240000); assert.ok(Math.abs(clock.time-0.4)<1e-12);
});

test('large timestamps are reduced on CPU, while nearby timestamps still move', () => {
  const t=1e12;
  const a=timePhases(t), b=timePhases(t+0.025), equivalent=timePhases(t%240);
  assert.deepEqual(a,equivalent);
  assert.ok(Math.abs(b.flow-a.flow-0.025)<0.0001);
  assert.ok(a.flow>=0&&a.flow<48&&a.pulse>=0&&a.pulse<2*Math.PI);
  const clock=new SimulationClock();
  assert.throws(()=>clock.setTime(NaN),RangeError);
  assert.throws(()=>clock.setTime(-1),RangeError);
  assert.throws(()=>clock.setTime(1e13),RangeError);
});

test('all authored camera poses remain outside the outer disk with portrait framing', () => {
  for(const aspect of [16/9,1,9/16,390/844]) {
    for(const view of ['overview','edge','disk','top'] as const) {
      const pose=presetPose(view,aspect);
      assert.ok(pose.radius-Math.hypot(...pose.target)>MODEL.diskOuter+2);
      assert.ok(pose.polar>=0.08&&pose.polar<=Math.PI/2-0.045);
      assert.ok(pose.radius>=14.5&&pose.radius<=140);
    }
  }
});

test('adaptive quality uses sustained evidence and cooldown instead of oscillating', () => {
  let changes=0,now=20000;
  const quality=new QualityController({webgl2:true,floatBuffer:true,gpu:'test',mobile:false,maxTextureSize:8192},()=>changes++);
  for(let i=0;i<240;i++){now+=34;quality.sample(34,now);}
  assert.equal(quality.current,'medium');assert.equal(changes,1);
  for(let i=0;i<300;i++){const dt=i%2?17:34;now+=dt;quality.sample(dt,now);}
  assert.equal(changes,1);
  for(let i=0;i<2400;i++){now+=16.667;quality.sample(16.667,now);}
  assert.equal(quality.current,'high');assert.equal(changes,2);
  const history=quality.history;
  assert.ok(history[1].at-history[0].at>=15000);
});
