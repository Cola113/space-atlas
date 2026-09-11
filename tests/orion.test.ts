import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleCruisePose, cruiseTime, CRUISE_DURATION } from '../orion-nebula/src/Camera.ts';
import { scenes } from '../platform/scenes.js';
import { sampleField, EXTENT, guideLuminance, referenceUv, wallDepth } from '../orion-nebula/src/Field.ts';
test('automatic tour stays in the detailed front region and frames portrait', () => {
 for(const aspect of [390/844,640/360,1920/1080]){
  for(let time=0;time<CRUISE_DURATION;time+=.1){
   const p=sampleCruisePose(time,aspect);
   assert.ok(p.position.every(Number.isFinite));
   assert.ok(p.position[2]>30,'Tour entered the unfinished interior');
   assert.ok(Math.hypot(p.position[0],p.position[1])/p.position[2]<.2,'Tour exposed the side projection');
   assert.ok(Math.hypot(...p.position)<180,'Portrait framing left the star field');
  }
 }
 assert.ok(sampleCruisePose(24,390/844).position[2]>sampleCruisePose(24,1920/1080).position[2]);
 assert.equal(cruiseTime(NaN),0);assert.equal(cruiseTime(Infinity),0);
 assert.deepEqual(sampleCruisePose(0,1.6),sampleCruisePose(CRUISE_DURATION,1.6));
 for(const key of ['position','target'] as const){
  const a=sampleCruisePose(CRUISE_DURATION-.001,1.6)[key],b=sampleCruisePose(0,1.6)[key],c=sampleCruisePose(.001,1.6)[key];
  for(let i=0;i<3;i++)assert.ok(Math.abs((b[i]-a[i])-(c[i]-b[i]))<1e-5,'Tour velocity jumps at the loop');
 }
});
test('nebula is registered without changing the default solar-system route',()=>{
 assert.equal(scenes[0].id,'solar-system');
 assert.equal(scenes.filter(s=>s.id==='orion-nebula').length,1);
 assert.equal(new Set(scenes.map(s=>s.path)).size,scenes.length);
});
test('cloud density occupies deep space, has a cavity, and fades before its bounding box',()=>{
 let front=0,back=0;
 for(let x=-12;x<=12;x+=2)for(let y=-10;y<=10;y+=2){front+=sampleField(x,y,4)[0];back+=sampleField(x,y,-9)[0];}
 assert.ok(front>1&&back>1,'Cloud collapsed into a thin image plane');
 assert.ok(sampleField(0,0,0)[0]<sampleField(10,0,0)[0],'Interior cavity is filled');
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
  const p:[number,number,number]=[0,0,0];p[axis]=EXTENT[axis]*sign;
  assert.deepEqual(sampleField(...p).slice(0,2),[0,0]);
 }
});
test('image guidance preserves projection, orientation, and density contrast',()=>{
 const guide={width:2,height:2,data:new Uint8ClampedArray([255,255,255,255,255,255,255,255,0,0,0,255,0,0,0,255])};
 assert.equal(guideLuminance(guide,.5,0),0);
 assert.ok(Math.abs(guideLuminance(guide,.5,1)-1)<1e-6);
 assert.ok(Math.abs(guideLuminance(guide,.5,.5)-.5)<1e-6);
 for(const z of [-12,0,10]){
  const scale=32*(1-z/44),uv=referenceUv((.3-.5)*scale,(.7-.5)*scale,z);
  assert.ok(Math.abs(uv[0]-.3)<1e-6&&Math.abs(uv[1]-.7)<1e-6);
 }
 const black={width:1,height:1,data:new Uint8ClampedArray([0,0,0,255])},white={...black,data:new Uint8ClampedArray([255,255,255,255])};
 const z=wallDepth(.5,.5);
 assert.ok(sampleField(0,0,z,white)[0]>sampleField(0,0,z,black)[0]*3,'Observation brightness does not constrain the cloud');
 assert.ok(wallDepth(.445,.55)<wallDepth(.8,.5)-8,'Cloud wall lost its depth');
});
