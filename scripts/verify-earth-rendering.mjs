// Deterministic surface visual regression; requires Vite for source imports.
// Real catalogue entry / return navigation is covered by verify-landings.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5193';
const output=new URL(process.env.ATLAS_EARTH_OUTPUT||'../work/verify-earth-rendering/',import.meta.url);
await mkdir(output,{recursive:true});
const ground=await sharp(fileURLToPath(new URL('../public/surface/earth.webp',import.meta.url))).extractChannel(3).raw().toBuffer({resolveWithObject:true});
assert.equal(ground.info.width,3840);assert.equal(ground.info.height,1920);
let coveragePixels=0;
for(const alpha of ground.data)if(alpha>0&&alpha<255)coveragePixels++;
assert.ok(coveragePixels>10000,'skyline must have graded coverage, not a binary cutout');
assert.ok(ground.data.subarray(0,3840*600).every(alpha=>alpha===0),'upper sky must be transparent');
for(let y=0;y<1920;y++)assert.equal(ground.data[y*3840],ground.data[y*3840+3839],'alpha must join at longitude wrap');
const browser=await launchBrowser(),report=[];
const snapshot=page=>page.evaluate(()=>window.earthFixture.snapshot());
async function create(page,date){
  await page.evaluate(async date=>{
    window.earthFixture?.dispose();
    const {createSurfaceView}=await import('/solar-system/src/surface/SurfaceView.js');
    window.earthFixture=createSurfaceView('earth',{initialDate:date,initialPlaying:false,initialRate:1000,renderOrbit:()=>{},onClosed:()=>{}});
  },date);
  await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:90000});
  await page.waitForTimeout(500);
}
async function capture(page,name){
  const canvas=await page.locator('.surface-canvas canvas').screenshot();
  await writeFile(new URL(name+'-canvas.png',output),canvas);
  await page.screenshot({path:fileURLToPath(new URL(name+'.png',output))});
  return canvas;
}
async function brightDisk(buffer,threshold=230){
  const {data,info}=await sharp(buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let pixels=0,peak=0;
  const radius=Math.ceil(info.height*.04);
  for(let y=Math.floor(info.height/2)-radius;y<info.height/2+radius;y++)
    for(let x=Math.floor(info.width/2)-radius;x<info.width/2+radius;x++){
      const i=(y*info.width+x)*info.channels,lo=Math.min(data[i],data[i+1],data[i+2]);
      peak=Math.max(peak,lo);if(lo>threshold)pixels++;
    }
  return {pixels,peak};
}
try{
  for(const [name,viewport,dsf,motion] of [
    ['desktop',{width:1440,height:900},1,'no-preference'],
    ['phone',{width:390,height:844},3,'reduce'],
    ['short',{width:640,height:360},2,'reduce'],
  ].filter(([name])=>!process.env.ATLAS_EARTH_VIEWPORT||name===process.env.ATLAS_EARTH_VIEWPORT)){
    const context=await browser.newContext({viewport,deviceScaleFactor:dsf,reducedMotion:motion});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/shader|program|GL_INVALID/i.test(m.text()))errors.push(m.text());});
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await create(page,'2026-09-27T05:30:00Z');
    const initial=await snapshot(page);
    assert.equal(initial.magnification,1);
    await capture(page,name+'-night');
    await page.locator('.surface-moon').click();await page.waitForTimeout(1200);
    await page.waitForLoadState('networkidle');
    const zoomed=await snapshot(page);
    assert.equal(zoomed.magnification,4);assert.equal(zoomed.cameraZoom,4);
    assert.equal(zoomed.date,initial.date);assert.deepEqual(zoomed.targets,initial.targets);
    const moonBuffer=await capture(page,name+'-night-moon'),moon=await brightDisk(moonBuffer,90);
    assert.ok(moon.pixels>12,`${name}: lunar disk missing ${JSON.stringify(moon)}`);
    await page.waitForTimeout(300);
    const pausedBuffer=await page.locator('.surface-canvas canvas').screenshot();
    await writeFile(new URL(name+'-paused-canvas.png',output),pausedBuffer);
    const firstPixels=await sharp(moonBuffer).raw().toBuffer(),pausedPixels=await sharp(pausedBuffer).raw().toBuffer();
    let changed=0,maxDifference=0;
    for(let i=0;i<firstPixels.length;i++){const delta=Math.abs(firstPixels[i]-pausedPixels[i]);if(delta>0)changed++;maxDifference=Math.max(maxDifference,delta);}
    // The high-DPI browser compositor can round a few antialiased pixels by
    // 1–2 levels between captures, even with the exact same WebGL frame.
    assert.ok(maxDifference<=2&&changed/firstPixels.length<.0002,'paused canvas must stay fixed within compositor rounding');
    assert.equal((await snapshot(page)).date,initial.date);
    await page.locator('.surface-reset').click();await page.waitForTimeout(1200);
    assert.equal((await snapshot(page)).magnification,1);
    await page.locator('.surface-daylight').click();
    await page.waitForFunction(()=>!document.querySelector('.surface-daylight').disabled);
    await capture(page,name+'-day-horizon');
    await page.locator('.surface-parent').click();await page.waitForTimeout(1200);
    const sun=await brightDisk(await capture(page,name+'-day-sun'));
    assert.ok(sun.pixels>5,`${name}: solar disk hidden by atmosphere ${JSON.stringify(sun)}`);
    assert.deepEqual(errors,[]);
    report.push({name,moon,sun,paused:true,physicalTargetsUnchanged:true});
    console.log(name,JSON.stringify(report.at(-1)));await context.close();
  }
  // Isolate the actual cloud shader at fixed lighting: moving sunlight must
  // not count as cloud motion. Rewinding must restore the same cloud pixels.
  const page=await browser.newPage({viewport:{width:900,height:500}});
  await page.goto(base+'/');
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createSurfaceSky,surfaceCameraRange}=await import('/solar-system/src/surface/SurfaceSky.js');
    const {landingSites,lookDirection}=await import('/solar-system/src/surface/geometry.js');
    const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});
    renderer.setSize(900,500);document.body.replaceChildren(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(62,1.8,surfaceCameraRange.near,surfaceCameraRange.far);camera.lookAt(lookDirection(88,0));
    const texture=await new THREE.TextureLoader().loadAsync('/surface/earth-cloud-sea.webp');texture.colorSpace=THREE.SRGBColorSpace;
    const sky=createSurfaceSky({scene,renderer,site:landingSites.earth,cloudLayerMap:texture,groundMaterial:{uniforms:{daylight:{value:1}}},signal:new AbortController().signal,onCatalogueReady:()=>{},onCatalogueError:()=>{}});
    window.renderClouds=time=>{
      sky.update(time,camera,{resetExposure:true});scene.children.forEach(object=>{object.visible=object.name==='surface-cloud-sea';});
      scene.getObjectByName('surface-cloud-sea').material.uniforms.daylight.value=1;renderer.render(scene,camera);return renderer.domElement.toDataURL();
    };
  });
  const epoch=Date.parse('2026-09-27T05:30:00Z');
  const a=await page.evaluate(t=>window.renderClouds(t),epoch);
  const b=await page.evaluate(t=>window.renderClouds(t),epoch+3*3600000);
  const restored=await page.evaluate(t=>window.renderClouds(t),epoch);
  assert.notEqual(a,b,'clouds must move with simulation time');assert.equal(a,restored,'clouds must rewind deterministically');
  for(const [name,data] of [['clouds-start',a],['clouds-3h',b]])await writeFile(new URL(name+'.png',output),Buffer.from(data.split(',')[1],'base64'));
  report.push({cloudMotion:true,cloudRewind:true});
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log('earth visual regression passed');
}finally{await browser.close();}
