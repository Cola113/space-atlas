// Render the actual SurfaceSky materials in an isolated local Vite harness.
// This checks shader illumination and depth with pixels; full UI/terrain QA
// remains in verify-landings.mjs. No diagnostic controls ship in the product.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const out='test-results/ground-rendering';
await mkdir(out,{recursive:true});
await mkdir('data/science-audit',{recursive:true});
await writeFile('data/science-audit/sky-render.html',`<!doctype html><html><body style="margin:0;background:black"><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {createSurfaceSky} from '/solar-system/src/surface/SurfaceSky.js';
import {surfaceFrame,landingSites} from '/solar-system/src/surface/geometry.js';
import {physicalState} from '/solar-system/src/physics/state.js';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(640,640);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
let previous,controller;
window.inspectSky=async sample=>{
  controller?.abort();controller=new AbortController();
  if(previous)previous.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat())m?.dispose();});
  const scene=new THREE.Scene(),site=landingSites[sample.id],date=new Date(sample.date);
  await physicalState.ensure(date,[site.id],{prefetch:false});
  const frame=surfaceFrame(site,date),target=frame.targets[site.parent];
  const camera=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(target.angularDiameter)*1.5,1,10,3000);
  camera.lookAt(target.direction);camera.updateMatrixWorld();
  const map=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);map.needsUpdate=true;
  const sky=createSurfaceSky({scene,renderer,site,parentMap:map,groundMaterial:{uniforms:{daylight:{value:0}}},
    signal:controller.signal,onCatalogueReady:()=>{},onCatalogueError:()=>{},initialFrame:frame});
  sky.update(date.getTime(),camera,{resetExposure:true});
  // Atmosphere has its own full-scene tests. Hide it here so a geometrically
  // hidden parent can still exercise its actual material and phase shader.
  for(const o of scene.children)if(o.material?.depthTest===false)o.visible=false;
  renderer.render(scene,camera);scene.updateMatrixWorld(true);
  const globe=scene.getObjectByName('surface-'+site.parent);
  const sphere=new THREE.Sphere(globe.position.clone(),globe.scale.x);
  const foregroundSpheres=scene.children.filter(o=>o.name.startsWith('surface-')&&o!==globe).map(o=>{
    const t=frame.targets[o.name.slice(8)];return new THREE.Sphere(t.direction.clone().multiplyScalar(t.distanceKm),t.radiusKm);
  });
  const gl=renderer.getContext(),pixels=new Uint8Array(640*640*4);gl.readPixels(0,0,640,640,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const light=new THREE.Vector3().fromArray(sample.targets[sample.parent].sunDirection||[1,0,0]);
  const ray=new THREE.Raycaster(),point=new THREE.Vector3(),groups={day:[],night:[]};
  for(let y=40;y<600;y+=4)for(let x=40;x<600;x+=4){
    ray.setFromCamera(new THREE.Vector2(2*(x+.5)/640-1,2*(y+.5)/640-1),camera);
    if(!ray.ray.intersectSphere(sphere,point))continue;
    const physicalHitDistance=point.length()*target.distanceKm/globe.position.length();
    if(foregroundSpheres.some(s=>{const hit=ray.ray.intersectSphere(s,new THREE.Vector3());return hit&&hit.length()<physicalHitDistance;}))continue;
    const normal=point.clone().sub(sphere.center).normalize();
    if(normal.dot(ray.ray.direction.clone().negate())<.25)continue;
    const cosine=normal.dot(light),value=pixels[(y*640+x)*4];
    if(cosine>.15)groups.day.push(value);else if(cosine<-.15)groups.night.push(value);
  }
  const stats=v=>{v.sort((a,b)=>a-b);return {count:v.length,min:v[0]??null,max:v.at(-1)??null,
    p01:v[Math.floor(v.length*.01)]??null,p99:v[Math.floor(v.length*.99)]??null,
    mean:v.length?v.reduce((s,n)=>s+n,0)/v.length:null};};
  const snapshot={id:sample.id,date:sample.date,referencePhase:sample.targets[sample.parent].illuminatedFraction,
    day:stats(groups.day),night:stats(groups.night),renderer:gl.getParameter(gl.RENDERER),glError:gl.getError(),
    objects:scene.children.filter(o=>o.name.startsWith('surface-')).map(o=>o.name),image:renderer.domElement.toDataURL()};
  previous=scene;return snapshot;
};
window.inspectDepth=async ({foreground,satellite=false})=>{
  controller?.abort();controller=new AbortController();
  const scene=new THREE.Scene(),au=149597870.7,date=new Date('2000-01-01T12:00:00Z');
  const orientation={prime:new THREE.Vector3(1,0,0),east:new THREE.Vector3(0,1,0),north:new THREE.Vector3(0,0,1)};
  const b=(name,parent,positionKm,radiusKm)=>({name,parent,positionKm:new THREE.Vector3(...positionKm),radiusKm,orientation});
  const bodies=satellite?[
    ['test',b('Test','jupiter',[0,0,-au],1)],['sun',b('Sun',null,[0,0,0],695700)],
    ['jupiter',b('Jupiter','sun',[0,0,-au-700000],70000)],
    ['io',b('Io','jupiter',[0,0,-au-(foreground?300000:1100000)],1800)]
  ]:[
    ['test',b('Test','sun',[0,0,au],1)],['sun',b('Sun',null,[0,0,0],695700)],
    ['mercury',b('Mercury','sun',[0,0,(foreground?.3:-.3)*au],695700*1.5)]
  ];
  const provider={frame:()=>({bodies:new Map(bodies),time:{timescaleNote:'Synthetic depth fixture'},accuracy:'Synthetic depth fixture'})};
  const site={id:'test',date:date.toISOString(),parent:satellite?'Jupiter':'Sun',parentRadiusKm:satellite?70000:695700,latitude:0,longitude:0};
  const frame=surfaceFrame(site,date,provider),camera=new THREE.PerspectiveCamera(satellite?20:2,1,10,3000);
  camera.lookAt(frame.targets[site.parent].direction);camera.updateMatrixWorld();
  const map=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);map.needsUpdate=true;
  const sky=createSurfaceSky({scene,renderer,site,provider,initialFrame:frame,groundMaterial:{uniforms:{daylight:{value:0}}},
    parentMap:map,signal:controller.signal,onCatalogueReady:()=>{},onCatalogueError:()=>{}});
  sky.update(date.getTime(),camera);renderer.render(scene,camera);
  const gl=renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(320,320,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  return {foreground,satellite,pixel:[...pixel],image:renderer.domElement.toDataURL()};
};
window.ready=true;
</script></body></html>`);

const server=await createServer({server:{host:'127.0.0.1',port:5192,strictPort:true}});
await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
try{
  const page=await browser.newPage({viewport:{width:640,height:640}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5192/data/science-audit/sky-render.html');
  await page.waitForFunction(()=>window.ready);
  const data=JSON.parse(await readFile('solar-system/tests/ground-audit-reference.json','utf8'));
  for(const id of ['moon','io','europa','enceladus','titan','miranda','pluto']){
    const samples=data.fixtures.filter(f=>f.id===id);
    for(const phase of [.1,.5,.9]){
      const sample=samples.reduce((best,f)=>Math.abs(f.targets[f.parent].illuminatedFraction-phase)<Math.abs(best.targets[best.parent].illuminatedFraction-phase)?f:best);
      const result=await page.evaluate(f=>window.inspectSky(f),sample);
      const {image,...metrics}=result;
      await writeFile(`${out}/${id}-${phase}.png`,Buffer.from(image.split(',')[1],'base64'));
      assert.equal(result.glError,0,`${id} WebGL error`);
      assert.ok(result.day.count+result.night.count>200,`${id} no rendered parent samples`);
      // Grazing Lambertian illumination is dim even on the correct lit side.
      // The angular mask excludes the terminator; compare to the ambient-only
      // hemisphere rather than demanding a full-phase average from a crescent.
      // One-percent tails allow antialiasing at tiny foreground satellite edges.
      if(result.day.count>50)assert.ok(result.day.p01>70,`${id}/${phase}: expected lit hemisphere ${JSON.stringify(metrics)}`);
      if(result.night.count>50)assert.ok(result.night.p99<30,`${id}/${phase}: expected unlit hemisphere ${JSON.stringify(metrics)}`);
      if(result.day.count>50&&result.night.count>50)assert.ok(result.day.p01>result.night.p99+30,`${id}/${phase}: terminator disagrees with independent light vector`);
      report.push(metrics);
    }
    console.log(id,'independent phase pixel checks passed');
  }
  const mars=await page.evaluate(f=>window.inspectSky(f),data.fixtures.find(f=>f.id==='mars'));
  assert.ok(mars.objects.includes('surface-phobos')&&mars.objects.includes('surface-deimos'),'Mars must render both local moons');
  assert.ok(report.find(f=>f.id==='pluto').objects.includes('surface-nix'),'Pluto must render its other satellites');
  const depth=[];
  for(const satellite of [false,true])for(const foreground of [true,false]){
    const {image,...result}=await page.evaluate(f=>window.inspectDepth(f),{foreground,satellite});
    await writeFile(`${out}/depth-${satellite?'satellite':'sun'}-${foreground?'foreground':'background'}.png`,Buffer.from(image.split(',')[1],'base64'));
    assert.ok(foreground?result.pixel[0]<(satellite?190:30):result.pixel[0]>(satellite?200:240),`Physical depth ordering: ${JSON.stringify(result)}`);
    depth.push(result);
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/report.json`,JSON.stringify({report,depth,localMoons:mars.objects,errors,scope:'Actual SurfaceSky materials, white parent texture and no atmosphere/terrain; independent reference illumination vs readPixels, plus synthetic physical foreground/background positions. UI, texture detail and atmosphere are checked separately.'},null,2));
}finally{await browser.close();await server.close();}
