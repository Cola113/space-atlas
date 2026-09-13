import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {loadYear} from './load-ephemeris.js';
import {localPosition,tdbSeconds} from '../src/ephemeris/local.js';
import {physicalBasis} from '../src/physical-state.js';
import {surfaceFrame,landingSites,horizonAngles} from '../src/surface/geometry.js';
import {diskVisibility,occultationVisibility} from '../src/surface/occultation.js';
const reference=JSON.parse(readFileSync(new URL('./fixtures/spice-reference.json',import.meta.url),'utf8'));
test('binary runtime matches CSPICE holdout positions to 1 km and IAU frames to 1e-7 rad',()=>{
 let maxError=0;
 for(const sample of reference.samples){
  const date=new Date(Date.UTC(2000,0,1,12)+sample.tdbSeconds*1000);loadYear(date.getUTCFullYear());
  for(const [name,expected] of Object.entries(sample.positions)){
   const actual=localPosition(name,date,sample.tdbSeconds);const error=Math.hypot(...actual.position.map((x,i)=>x-expected[i]));maxError=Math.max(maxError,error);
   assert.ok(error<1,`${name}: ${error} km`);
  }
  for(const [name,matrix] of Object.entries(sample.orientations)){
   const basis=physicalBasis(name,date,sample.tdbSeconds);
   for(const [key,column] of [['prime',0],['east',1],['north',2]])assert.ok(basis[key].distanceTo(new Vector3(...matrix.map(row=>row[column])))<1e-7,name);
  }
 }
 assert.ok(maxError>0,'Fixtures must exercise interpolation, not exact nodes');
});
test('shared surface model retains near-lock with sourced motion over multiple periods',()=>{
 loadYear(2026);
 for(const id of ['io','europa','enceladus','titan','miranda','pluto']){
  const site=landingSites[id],start=Date.parse(site.date),points=[];
  for(let i=0;i<=96;i++)points.push(surfaceFrame(site,new Date(start+i*(site.solarDay||6.387)*2*86400000/96)).targets[site.parent]);
  const excursion=Math.max(...points.map(p=>p.direction.angleTo(points[0].direction)));
  assert.ok(excursion>1e-5&&excursion<.25,`${id}: ${excursion}`);
  if(id==='pluto')assert.ok(points.every(p=>horizonAngles(p.direction).altitude<0));
 }
});
test('coverage boundaries mark extrapolation, and time conversion includes TT offset',()=>{
 for(const year of [1890,2110]){loadYear(year<1900?1900:2099);const result=localPosition('Titan',new Date(Date.UTC(year,0,1)));assert.equal(result.approximate,true);assert.ok(result.position.every(Number.isFinite));}
 assert.ok(tdbSeconds(new Date('2000-01-01T12:00:00Z'))>60);
});
test('overlapping foreground discs do not double-count solar extinction',()=>{
 const sun={direction:new Vector3(0,0,1),distanceKm:149597870.7};
 const moon={direction:new Vector3(.003,0,1).normalize(),distanceKm:380000};
 const frame={targets:{Sun:sun,Moon:moon,Duplicate:moon}};
 const single=occultationVisibility({targets:{Sun:sun,Moon:moon}},1737.4,'Moon');
 const union=occultationVisibility(frame,1737.4,'Duplicate');
 assert.ok(single>0&&single<1);assert.ok(Math.abs(single-union)<.015);
 assert.equal(diskVisibility(1,2,0),0);assert.equal(diskVisibility(1,.5,0),.75);
});
