import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResourceQueue, FrameWorkQueue } from '../src/resource-queue.js';

const turn = () => new Promise(resolve => setImmediate(resolve));

test('resource queue limits concurrency, shares requests, and prioritizes a newly selected system', async () => {
  const queue = new ResourceQueue(4), starts = [], releases = new Map();
  const request = key => queue.run(key, () => new Promise(resolve => {
    starts.push(key); releases.set(key, resolve);
  }));
  const tasks = Array.from({ length: 8 }, (_, i) => request(String(i)));
  await turn();
  assert.deepEqual(starts, ['0', '1', '2', '3']);
  assert.equal(request('6'), tasks[6], 'duplicate body request must share its original promise');
  queue.setConcurrency(2);
  queue.reprioritize('6', 90);
  queue.reprioritize('7', 60);
  releases.get('0')(); releases.get('1')(); releases.get('2')();
  await turn();
  assert.deepEqual(starts, ['0', '1', '2', '3', '6']);
  releases.get('6')(); await turn();
  assert.equal(starts.at(-1), '7');
  for (const key of ['3', '7', '4', '5']) { releases.get(key)(); await turn(); }
  await Promise.all(tasks);
  assert.equal(queue.snapshot().peak, 4);
  assert.equal(queue.snapshot().active, 0);
  assert.equal(queue.snapshot().complete, 8);
  queue.dispose();
});

test('timeout aborts a hanging fetch, frees a slot, and allows an explicit retry', async () => {
  const queue = new ResourceQueue(1);
  let aborted = false;
  const hung = queue.run('preview', signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
  }), { timeout: 20 });
  const other = queue.run('other', () => 42);
  await assert.rejects(hung, /timed out/);
  assert.equal(aborted, true);
  assert.equal(await other, 42);
  assert.equal(await queue.run('preview', () => 'recovered'), 'recovered');
  queue.dispose();
});

test('background admission pauses and disposal cancels queued and active work', async () => {
  const queue = new ResourceQueue(1);
  queue.setPaused(true);
  let started = false;
  const result = queue.run('waiting', signal => new Promise((resolve, reject) => {
    started = true;
    signal.addEventListener('abort', () => reject(signal.reason));
  }));
  await turn(); assert.equal(started, false);
  queue.setPaused(false); await turn(); assert.equal(started, true);
  const next = queue.run('next', () => { throw new Error('must never start'); });
  queue.dispose();
  await assert.rejects(result, /disposed/);
  await assert.rejects(next, /disposed/);
});

test('an explicit retry can yield a stuck background request without losing its subscribers', async () => {
  const queue = new ResourceQueue(1), attempts = [];
  let finish;
  const background = queue.run('background', signal => new Promise((resolve, reject) => {
    attempts.push('background'); finish = resolve;
    signal.addEventListener('abort', () => reject(signal.reason));
  }));
  await turn();
  const retry = queue.run('preview', () => { attempts.push('preview'); return 'visible'; }, { priority: 100, preempt: true });
  assert.equal(await retry, 'visible');
  await turn();
  assert.deepEqual(attempts, ['background', 'preview', 'background']);
  assert.equal(queue.run('background', () => 'must share'), background);
  finish('complete');
  assert.equal(await background, 'complete');
  assert.equal(queue.snapshot().peak, 1);
  queue.dispose();
});

test('uploads wait for visibility while allowing another body to prepare in the same frame', async () => {
  const queue = new FrameWorkQueue(), work = [];
  let visible = false;
  const hidden = queue.run('hidden', () => work.push('hidden'), { priority: 90, visible: () => visible });
  const normal = queue.run('mesh', () => work.push('mesh'));
  assert.equal(queue.drainOne(), true);
  assert.deepEqual(work, ['mesh']);
  assert.equal(queue.drainOne(), false);
  visible = true;
  assert.equal(queue.drainOne(), true);
  assert.deepEqual(work, ['mesh', 'hidden']);
  await Promise.all([hidden, normal]);
  queue.dispose();
});

test('thumbnail queue stays independent from a saturated heavy-texture queue and retries cleanly after failure', async () => {
  const heavy = new ResourceQueue(2);
  const thumbs = new ResourceQueue(4);
  const releaseHeavy = [];
  const h1 = heavy.run('8k_mars.jpg', () => new Promise(r => releaseHeavy.push(r)), { priority: 65 });
  const h2 = heavy.run('2k_mars.jpg', () => new Promise(r => releaseHeavy.push(r)), { priority: 90 });
  await turn();
  assert.equal(heavy.snapshot().active, 2);

  let thumbAttempts = 0;
  await assert.rejects(
    thumbs.run('phobos.webp', () => { thumbAttempts++; return Promise.reject(new Error('transient')); }),
    /transient/,
  );
  const recovered = await thumbs.run('phobos.webp', () => { thumbAttempts++; return 'blob:phobos'; });
  assert.equal(recovered, 'blob:phobos');
  assert.equal(thumbAttempts, 2);
  assert.equal(heavy.snapshot().active, 2, 'heavy queue remained busy while thumbnail loaded independently');

  for (const r of releaseHeavy) r('done');
  await Promise.all([h1, h2]);
  heavy.dispose();
  thumbs.dispose();
});
