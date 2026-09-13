import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeEphemeris, evaluateEphemeris, EphemerisStore, MissingEphemerisError } from '../src/physics/ephemeris.js';

const root = new URL('../../public/ephemeris/', import.meta.url);
const arrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const readYear = async (system, year) => arrayBuffer(await readFile(new URL(`${system}/${year}.bin`, root)));
test('all 603 yearly bundles reproduce original JPL polynomial reference positions within one kilometre', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const references = JSON.parse(await readFile(new URL('ephemeris-reference.json', import.meta.url), 'utf8'));
  let checked = 0, maximum = 0;
  for (const [system, source] of Object.entries(manifest.sources)) {
    assert.equal(Object.keys(source.files).length, 201);
    for (const track of source.tracks) assert.ok(track.encodingBoundKm < .1);
    for (const [year, expected] of Object.entries(source.files)) {
      const buffer = await readYear(system, year);
      assert.equal(buffer.byteLength, expected.bytes);
      assert.equal(createHash('sha256').update(new Uint8Array(buffer)).digest('hex'), expected.sha256);
      const bundle = decodeEphemeris(buffer);
      assert.equal(bundle.system, system); assert.equal(bundle.year, Number(year));
      const samples = references.filter(r => r.system === system && r.year === Number(year));
      assert.ok(samples.length >= 6);
      for (const sample of samples) {
        const actual = evaluateEphemeris(bundle, sample.target, sample.center, sample.tdbSeconds);
        const error = Math.hypot(...actual.map((v, i) => v - sample.positionKm[i]));
        assert.ok(error < .1, `${system}/${year}/${sample.target}: ${error} km`);
        maximum = Math.max(maximum, error); checked++;
      }
    }
  }
  assert.ok(checked > 5000);
  console.log(`JPL encoding reference checks: ${checked}; maximum observed difference ${maximum.toFixed(6)} km`);
});

test('cache deduplicates requests, prefetches adjacent years and never fabricates missing data', async () => {
  const calls = [], completed = new Map();
  const store = new EphemerisStore({fetcher: async path => {
    calls.push(path);
    const [, , system, file] = path.split('/');
    const bytes = await readYear(system, parseInt(file)); completed.set(path, true);
    return {ok:true, arrayBuffer:async()=>bytes};
  }});
  const date = new Date('1971-08-01T17:00:00Z');
  assert.throws(()=>store.require('saturn', date), MissingEphemerisError);
  const first = store.load('saturn', 1971), second = store.load('saturn', 1971);
  assert.equal(first, second);
  await first;
  assert.equal(store.require('saturn', date).year, 1971);
  await store.ensure(date, ['saturn', 'saturn']);
  await Promise.all([...store.pending.values()].map(p=>p.promise));
  assert.equal(calls.length, 3);
  assert.deepEqual([...completed.keys()].sort(), ['/ephemeris/saturn/1970.bin','/ephemeris/saturn/1971.bin','/ephemeris/saturn/1972.bin']);
  assert.equal(store.require('saturn', new Date('1899-12-31')), null);
  assert.equal(store.require('saturn', new Date('2101-01-01')), null);
  store.dispose();
});

test('failed, truncated or wrong-year data is retryable and never poisons the cache', async () => {
  const bytes = await readYear('saturn', 1971);
  const responses = [
    {ok:false,status:503},
    {ok:true,arrayBuffer:async()=>bytes.slice(0,100)},
    {ok:true,arrayBuffer:async()=>await readYear('saturn',1972)},
    {ok:true,arrayBuffer:async()=>bytes},
  ];
  const store = new EphemerisStore({fetcher:async()=>responses.shift()});
  for(let i=0;i<3;i++) {
    await assert.rejects(store.load('saturn',1971), MissingEphemerisError);
    assert.equal(store.get('saturn',1971),undefined);
  }
  await store.load('saturn',1971);
  assert.equal(store.get('saturn',1971).year,1971);
  assert.equal(store.failures.size,0);
  store.dispose();
});

test('ephemeris timeout and disposal release pending fetches', async () => {
  const store = new EphemerisStore({timeoutMs:20,fetcher:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  await assert.rejects(store.load('saturn',1971),MissingEphemerisError);
  assert.equal(store.pending.size,0);
  const pending=store.load('saturn',1972);
  await Promise.resolve();store.dispose();
  await assert.rejects(pending,MissingEphemerisError);
  assert.equal(store.pending.size,0);
});
