import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoQuality } from '../orion-nebula/src/Quality.ts';

function device() {
  const control = new AutoQuality();
  let now = 0;
  return {
    control,
    run(fps: number, seconds: number) {
      const step = 1000 / fps;
      for (let frame = 0; frame < Math.ceil(fps * seconds); frame++) { now += step; control.sample(step, now); }
    },
    gap(ms: number) { now += ms; control.exclude(now); },
    mode(mode: Parameters<AutoQuality['setMode']>[0]) { control.setMode(mode, now); },
  };
}
test('one bad second is tolerated, two sustained slow seconds reduce quality', () => {
  const d = device();
  assert.equal(d.control.current, 'low');
  d.run(40, 1); assert.equal(d.control.current, 'low');
  d.run(60, 2); assert.equal(d.control.current, 'low');
  d.run(40, 2); assert.equal(d.control.current, 'smooth');
  d.run(40, 1); assert.equal(d.control.current, 'smooth', 'switch warmup must not lower quality');
});
test('severe sustained load steps down to the minimum and still reports measured FPS', () => {
  const d = device();
  d.run(20, 1); assert.equal(d.control.current, 'smooth');
  d.run(20, 2.3); assert.equal(d.control.current, 'minimal');
  d.run(10, 5); assert.equal(d.control.current, 'minimal'); assert.equal(d.control.fps, 10);
  assert.equal(d.control.changes, 2);
});
test('twenty fast seconds trial an upgrade; a failed trial rolls back for sixty seconds', () => {
  const d = device();
  d.run(60, 19); assert.equal(d.control.current, 'low');
  d.run(60, 1.5); assert.equal(d.control.current, 'high');
  d.run(50, 2.5); assert.equal(d.control.current, 'low');
  d.run(60, 59); assert.equal(d.control.current, 'low');
  d.run(60, 2); assert.equal(d.control.current, 'high');
  d.run(60, 6); assert.equal(d.control.current, 'high');
});
test('pause, background, loading and resizing discard stale timing windows', () => {
  const d = device();
  d.run(40, 1); d.gap(120000); d.run(40, 1); assert.equal(d.control.current, 'low');
  d.run(60, 19); assert.equal(d.control.current, 'low');
  d.gap(60000); d.run(60, 19); assert.equal(d.control.current, 'low');
  d.run(60, 4); assert.equal(d.control.current, 'high');
});
test('all manual choices remain fixed under load and auto restarts from energy saving', () => {
  for (const mode of ['minimal', 'smooth', 'low', 'high'] as const) {
    const d = device(); d.mode(mode); d.run(5, 10); d.run(60, 25);
    assert.equal(d.control.current, mode);
    d.mode('auto'); assert.equal(d.control.current, 'low');
    assert.equal(d.control.fps, 0);
  }
});
