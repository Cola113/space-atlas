import {loadYear} from './load-ephemeris.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MathUtils } from 'three';
import { landingSites,surfaceFrame,angularDiameter,horizonAngles,bodyBasis,nextDaylight } from '../src/surface/geometry.js';
import { landableBodyIds } from '../src/surface/sites.js';
import { solarVisibility,surfaceLight } from '../src/surface/SurfaceSky.js';

test('nine landing sites have decodable local images and never draw the observer body in the sky',async()=>{
  assert.equal(landableBodyIds.length,9);
  for(const id of landableBodyIds){
    const site=landingSites[id],frame=surfaceFrame(site);
    const file=await readFile(new URL(`../../public${site.texture}`,import.meta.url));
    assert.equal(file.toString('ascii',8,12),'WEBP');
    assert.ok(frame.targets[site.parent],id);
    if(site.body)assert.equal(frame.targets[site.body],undefined,id);
    for(const target of Object.values(frame.targets))assert.ok(Number.isFinite(target.distanceKm)&&target.distanceKm>0,id);
    assert.ok(Number.isFinite(surfaceLight(frame,site,25).brightness));
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

test('Sputnik Planitia stays on the hemisphere facing away from Charon',()=>{
  for(const date of ['1971-08-01','2000-01-01','2026-09-12','2040-05-20']){
    loadYear(new Date(date).getUTCFullYear());const f=surfaceFrame(landingSites.pluto,new Date(date));
    assert.ok(horizonAngles(f.targets.Charon.direction).altitude < -65);
    assert.ok(Math.abs(f.targets.Charon.distanceKm-20700)<400);
  }
});

test('outer moon parent sizes remain physical while independent pose allows libration',()=>{
  loadYear(2026);
  for(const [id,min,max] of [['titan',5,6],['enceladus',27,30],['miranda',21,24]]){
    const site=landingSites[id],a=surfaceFrame(site),b=surfaceFrame(site,new Date(Date.parse(site.date)+86400000));
    const size=MathUtils.radToDeg(angularDiameter(site.parentRadiusKm,a.targets[site.parent].distanceKm));
    assert.ok(size>min&&size<max,`${id}: ${size}`);
    assert.ok(a.targets[site.parent].direction.angleTo(b.targets[site.parent].direction)>1e-5&&a.targets[site.parent].direction.angleTo(b.targets[site.parent].direction)<.2,id);
    assert.ok(a.targets.Sun.direction.angleTo(b.targets.Sun.direction)>.01,id);
    const basis=bodyBasis(site.body,new Date(site.date));
    assert.ok(Math.abs(basis.prime.dot(basis.north))<1e-12);
  }
});

test('daylight jump advances a night landing to an actually illuminated time',()=>{
  for(const id of ['mars','mercury','io']){
    const site=landingSites[id],start=Date.parse(site.date),time=nextDaylight(site,start);
    assert.ok(time>start,id);
    assert.ok(horizonAngles(surfaceFrame(site,new Date(time)).targets.Sun.direction).altitude>8,id);
  }
});
