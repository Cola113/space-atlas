import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { iauOrientation, bodyOrientation } from '../src/physics/orientation.js';
import { physicalTime } from '../src/physics/time.js';

test('34 small-body and satellite attitudes agree with independent CSPICE IAU matrices at historical and future epochs', async () => {
  const {fixtures} = JSON.parse(await readFile(new URL('iau-reference.json',import.meta.url),'utf8'));
  for (const {body,tdbSeconds,basis} of fixtures) {
    const actual = iauOrientation(body,tdbSeconds);
    for (const [col,key] of ['prime','east','north'].entries()) {
      const vector = actual[key].toArray();
      for (let row=0;row<3;row++) assert.ok(Math.abs(vector[row]-basis[row][col])<5e-10,`${body} ${tdbSeconds} ${key}[${row}]`);
    }
    assert.ok(Math.abs(actual.prime.dot(actual.north))<1e-12);
    assert.ok(Math.abs(actual.quaternion.length()-1)<1e-12);
  }
});
test('Astronomy Engine planet and lunar orientations remain available without requiring satellite files',()=>{
  for (const id of ['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune','pluto']) {
    const attitude=bodyOrientation(id,new Date('1971-08-01T17:00:00Z'));
    assert.ok(attitude.prime.toArray().every(Number.isFinite),id);
    assert.ok(Math.abs(attitude.east.dot(attitude.north))<1e-12,id);
  }
});
test('physical clock uses a shared TT/TDB epoch, preserves UTC dates and rejects invalid dates',()=>{
  for (const year of [1900,1971,2000,2026,2100]) {
    const date=new Date(`${year}-01-01T00:00:00Z`),time=physicalTime(date);
    assert.equal(time.date,date);
    assert.ok(Math.abs(time.ttSeconds-time.tdbSeconds)<.0017);
    assert.equal(time.ttSeconds,time.astronomy.tt*86400);
    assert.equal(time.tdbDays,time.tdbSeconds/86400);
  }
  assert.throws(()=>physicalTime(new Date(NaN)),RangeError);
});
test('post-1972 dynamics use published TT−UTC offsets instead of predicted Delta-T',()=>{
  for(const [iso,seconds] of [['1972-01-01T00:00:00Z',42.184],['2000-01-01T12:00:00Z',64.184],['2026-09-14T00:00:00Z',69.184]]) {
    const time=physicalTime(new Date(iso));
    assert.ok(Math.abs((time.astronomy.tt-time.astronomy.ut)*86400-seconds)<1e-6);
  }
});
