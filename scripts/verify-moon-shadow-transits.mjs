// Run: node --import tsx scripts/verify-moon-shadow-transits.mjs
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { Vector3,Matrix4,Quaternion } from 'three';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';
import { configureDeploymentAccess } from './deployment-access.mjs';
import { findEvents,referenceInputs } from './find-moon-shadow-events.mjs';
import { localPhysics } from '../solar-system/tests/physical-fixture.js';
import { computeMoonTransit,physicalGeometryRotation } from '../solar-system/src/moon-transits.js';
import { skyRotation } from '../solar-system/src/sky-coordinates.js';
import { bodies } from '../solar-system/src/data.js';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191',out=process.env.ATLAS_OUTPUT||'test-results/moon-shadow-transits';
await mkdir(out,{recursive:true});
const events=await findEvents(),provider=localPhysics(),report={events,numerical:[],views:[],errors:[]};
const vector=a=>new Vector3().fromArray(a);
for(const event of events){
 await provider.ensure(new Date(event.date),[event.id],{prefetch:false});
 const f=provider.frame(new Date(event.date)),i=referenceInputs(f,event.parent,event.id);
 const actual=computeMoonTransit({sunPositionKm:i.sun,parentPositionKm:i.parent,moonPositionKm:i.moon,parentAxesKm:i.axes,
  parentRotation:physicalGeometryRotation(i.orientation),moonRadiusKm:i.moonRadius,sunRadiusKm:i.sunRadius});
 const centerErrorKm=actual.hitLocalKm.distanceTo(vector(event.prediction.hitLocalKm));
 const diameterErrorKm=Math.abs(actual.shadowDiameterKm-event.prediction.diameterKm);
 assert.ok(centerErrorKm<1e-5 && diameterErrorKm<1e-6);
 report.numerical.push({id:event.id,date:event.date,predicted:event.prediction,actual:{center:actual.centerGeometry.toArray(),diameterKm:actual.shadowDiameterKm},centerErrorKm,diameterErrorKm});
}
if(process.argv.includes('--numeric-only')){await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.numerical,null,2));provider.dispose();process.exit(0);}
const browser=await launchBrowser();
const snapshot=page=>page.evaluate(()=>window.solarAtlas.snapshot());
const settle=page=>page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked&&s.bodies.find(b=>b.id===s.selected)?.detailReady;},null,{timeout:90000});
async function contextFor(event,{width=1440,height=900,dpr=2,offset,close=false}={}){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 await configureDeploymentAccess(context,base);
 await context.addInitScript(value=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value})),{
  selected:event.parent,date:Date.parse(event.date),timelineEpoch:Date.UTC(1971,7,1),playing:false,shadows:true,dynamics:false,
  followRotation:false,speed:1000,speedUnit:'realtime',direction:1,offset,portrait:width<height,close,labels:true,orbits:false});
 const page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/shader|program|GL_INVALID/i.test(m.text()))report.errors.push(m.text());});
 await page.goto(base+'/solar-system/');await settle(page);await page.waitForTimeout(1000);
 return {context,page,width,height,dpr};
}
async function toggleShadow(page,enabled){
 // Jupiter has no visible shadow switch; exercise the existing state handler
 // without adding a product control or reaching into renderer internals.
 await page.locator('#shadow-toggle').evaluate((input,value)=>{input.checked=value;input.dispatchEvent(new Event('change',{bubbles:true}));},enabled);
 await page.waitForFunction(v=>window.solarAtlas.snapshot().shadows===v,enabled);await page.waitForTimeout(180);
}
function project(local,state,body,width,height){
 const world=vector(local).multiplyScalar(body.radius).applyQuaternion(new Quaternion().fromArray(body.orientation)).add(vector(body.position));
 const view=new Matrix4().fromArray(state.cameraWorldMatrix).invert(),projection=new Matrix4().fromArray(state.cameraProjectionMatrix);
 const n=world.applyMatrix4(view).applyMatrix4(projection);return {x:(n.x+1)*width/2,y:(1-n.y)*height/2};
}
// Independent ray picking of the screenshot: bisection against the physical
// ellipsoid, followed by angular contact inequalities. No renderer shadow values.
function referenceMask(px,py,state,body,width,height,input){
 const camera=vector(state.camera),inverse=new Matrix4().fromArray(state.cameraProjectionMatrix).invert();
 const point=new Vector3(2*px/width-1,1-2*py/height,.5).applyMatrix4(inverse).applyMatrix4(new Matrix4().fromArray(state.cameraWorldMatrix));
 const q=new Quaternion().fromArray(body.orientation).invert(),scale=input.axes[0]/body.radius;
 const origin=camera.sub(vector(body.position)).applyQuaternion(q).multiplyScalar(scale);
 const ray=point.sub(vector(state.camera)).normalize().applyQuaternion(q);
 const o=origin.toArray(),d=ray.toArray(),axes=input.axes;
 const f=t=>o.reduce((sum,x,i)=>sum+((x+t*d[i])/axes[i])**2,-1);
 const tm=-o.reduce((sum,x,i)=>sum+x*d[i]/axes[i]**2,0)/d.reduce((sum,x,i)=>sum+x*x/axes[i]**2,0);
 if(tm<=0||f(tm)>0)return null;
 let lo=0,hi=tm;for(let k=0;k<48;k++){const mid=(lo+hi)/2;if(f(mid)>0)lo=mid;else hi=mid;}
 const hit=origin.addScaledVector(ray,(lo+hi)/2);
 const b=[input.orientation.prime,input.orientation.north,input.orientation.east.clone().negate()];
 const local=position=>{const r=vector(position).sub(vector(input.parent));return new Vector3(...b.map(axis=>r.dot(axis)));};
 const sun=local(input.sun).sub(hit),moon=local(input.moon).sub(hit);
 const sa=Math.asin(input.sunRadius/sun.length()),ma=Math.asin(input.moonRadius/moon.length());
 const separation=Math.atan2(new Vector3().crossVectors(sun,moon).length(),sun.dot(moon));
 return {core:separation+sa<=ma,penumbra:separation<sa+ma};
}
function bounds(points){if(!points.length)return null;const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {x:xs.reduce((s,x)=>s+x,0)/xs.length,y:ys.reduce((s,y)=>s+y,0)/ys.length,width:Math.max(...xs)-Math.min(...xs)+1,height:Math.max(...ys)-Math.min(...ys)+1,pixels:points.length};}
async function measure(on,off,state,body,predicted,viewport,input){
 const {width,height,dpr}=viewport,[a,b]=await Promise.all([sharp(on).removeAlpha().raw().toBuffer({resolveWithObject:true}),sharp(off).removeAlpha().raw().toBuffer({resolveWithObject:true})]);
 const r=Math.max(10,body.radiusPx*input.moonRadius/input.axes[0]*3),candidates=[],ideal=[];
 const left=Math.max(0,Math.floor((predicted.x-r)*dpr)),right=Math.min(a.info.width-1,Math.ceil((predicted.x+r)*dpr));
 const top=Math.max(0,Math.floor((predicted.y-r)*dpr)),bottom=Math.min(a.info.height-1,Math.ceil((predicted.y+r)*dpr));
 let maximum=0;
 for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
  const k=(y*a.info.width+x)*3,lum=v=>(v[k]*.2126+v[k+1]*.7152+v[k+2]*.0722),bright=lum(b.data);
  const loss=bright>20?(bright-lum(a.data))/bright:0;maximum=Math.max(maximum,loss);candidates.push({x,y,loss});
  if(referenceMask((x+.5)/dpr,(y+.5)/dpr,state,body,width,height,input)?.core)ideal.push({x,y});
 }
 const measured=bounds(candidates.filter(p=>p.loss>maximum*.8&&p.loss>.08)),expected=bounds(ideal);
 const result={maximumFractionalDarkening:maximum,measuredCoreDevicePixels:measured,predictedCoreDevicePixels:expected,
  measuredCoreCssPixels:measured?Object.fromEntries(Object.entries(measured).map(([k,v])=>[k,k==='pixels'?v:v/dpr])):null};
 if(measured&&expected){result.centroidErrorCssPx=Math.hypot(measured.x-expected.x,measured.y-expected.y)/dpr;result.widthErrorCssPx=Math.abs(measured.width-expected.width)/dpr;}
 return result;
}
try{
 for(const event of events){
  await provider.ensure(new Date(event.date),[event.id],{prefetch:false});const frame=provider.frame(new Date(event.date)),input=referenceInputs(frame,event.parent,event.id);
  const original=await contextFor(event),natural=await snapshot(original.page),body=natural.bodies.find(b=>b.id===event.parent);
  await original.page.screenshot({path:out+'/'+event.parent+'-native-default.png'});
  report.views.push({name:event.parent+'-native-default',date:natural.date,camera:natural.camera,body,discs:natural.moonTransitDiscs,shadow:natural.moonTransits[event.parent],note:'Unchanged default camera; simultaneous body and shadow is not forced.'});
  const defaultDistance=natural.distance;await original.context.close();
  const spin=skyRotation(frame.time.astronomy),relative=frame.bodies.get(event.id).relativeKm.clone().applyMatrix3(spin);
  const pole=frame.bodies.get(event.parent).orientation.north.clone().applyMatrix3(spin);
  const bearing=relative.normalize().applyAxisAngle(pole,event.parent==='jupiter'?.05:.018);
  for(const mode of ['default-scale','close','phone-close','short-close']){
   const layout=mode==='phone-close'?{width:390,height:844,dpr:3}:mode==='short-close'?{width:800,height:450,dpr:2}:{};
   let distance=defaultDistance;
   if(mode.includes('-close')){const seed=await contextFor(event,layout);distance=(await snapshot(seed.page)).distance;await seed.context.close();}
   const view=await contextFor(event,{...layout,offset:bearing.clone().multiplyScalar(distance*(mode==='default-scale'?1:.62)).toArray(),close:mode!=='default-scale'});
   await view.page.waitForFunction(id=>window.solarAtlas.snapshot().moonTransitDiscs.some(d=>d.id===id&&d.visible&&d.textureWidth>0),event.id,{timeout:60000});
   const {page,width,height,dpr}=view,state=await snapshot(page),planet=state.bodies.find(b=>b.id===event.parent),name=event.parent+'-'+mode;
   assert.equal(new Date(state.date).toISOString(),event.date,'date must be preserved');
   const predicted=project(event.prediction.center,state,planet,width,height);
   const actual=state.moonTransits[event.parent].find(e=>e.id===event.id),disc=state.moonTransitDiscs.find(e=>e.id===event.id);
   await writeFile(out+'/'+name+'-state.json',JSON.stringify(state,null,2));
   assert.ok(actual.active&&disc?.visible,'the chosen bearing must have both shadow and disk');
   assert.ok(Math.hypot(predicted.x-actual.screen.x,predicted.y-actual.screen.y)<1e-5);
   const on=await page.screenshot({path:out+'/'+name+'.png'});await toggleShadow(page,false);
   const off=await page.screenshot({path:out+'/'+name+'-no-shadow.png'});const after=await snapshot(page);
   assert.deepEqual(after.camera,state.camera);assert.equal(after.date,state.date);assert.ok(after.moonTransitDiscs.find(e=>e.id===event.id)?.visible);
   const pixels=await measure(on,off,state,planet,predicted,view,input);
   const image=await sharp(on).removeAlpha().raw().toBuffer({resolveWithObject:true});
   const radius=Math.max(1,planet.radiusPx*input.moonRadius/input.axes[0]*dpr*.6),cx=disc.screen.x*dpr,cy=disc.screen.y*dpr;
   let colored=0,total=0,range=0;
   for(let y=Math.floor(cy-radius);y<=Math.ceil(cy+radius);y++)for(let x=Math.floor(cx-radius);x<=Math.ceil(cx+radius);x++){
    if(x<0||y<0||x>=image.info.width||y>=image.info.height||Math.hypot(x-cx,y-cy)>radius)continue;
    const k=(y*image.info.width+x)*3,rgb=[image.data[k],image.data[k+1],image.data[k+2]],lo=Math.min(...rgb),hi=Math.max(...rgb);
    total++;if(hi-lo>12&&hi>35&&lo<235)colored++;range=Math.max(range,hi-lo);
   }
   pixels.moonColor={coloredPixels:colored,sampledPixels:total,maxChannelDifference:range};
   assert.ok(colored>0&&colored/total>.25,'the moon disk must have its own colored material rather than black or white');
   const entry={name,date:event.date,width,height,dpr,framing:'Default/close distance, explicitly aligned observer bearing; not default camera direction.',
    body:{x:planet.x,y:planet.y,radiusPx:planet.radiusPx},predictedCenterCss:predicted,actual,disc,pixels,camera:state.camera};
   report.views.push(entry);await writeFile(out+'/report.json',JSON.stringify(report,null,2));
   console.log(JSON.stringify({name,predicted,disc:disc.screen,pixels}));
   assert.ok(pixels.measuredCoreDevicePixels&&pixels.predictedCoreDevicePixels,'shadow must alter real canvas pixels');
   assert.ok(pixels.centroidErrorCssPx<2.5&&pixels.widthErrorCssPx<3,'shadow pixels must match independent geometry');
   await view.context.close();
  }
 }
 assert.deepEqual(report.errors,[],'no shader or page errors');
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();provider.dispose();}
