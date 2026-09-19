import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

// Isolate shader motion from rotation/camera movement. Also compile the shared
// Lambert path used by the landing sky, and put an outbreak across the UV seam.
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
const output=new URL('../test-results/saturn-weather/render/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await launchBrowser();
const report=[];
try {
  const page=await browser.newPage({viewport:{width:800,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/__saturn-weather-probe',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:black}</style>'}));
  await page.goto(base+'/__saturn-weather-probe');
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {patchSaturnWeather,createSaturnWeatherUniforms,saturnStormUv}=await import('/solar-system/src/saturn-weather.js');
    const {bodyModels}=await import('/solar-system/src/body-models.js');
    const {createBodyGeometry}=await import('/solar-system/src/body-geometry.js');
    const {uvDirection}=await import('/solar-system/src/feature-anchors.js');
    const {bindPhysicalSun}=await import('/solar-system/src/physical-lighting.js');
    const {bindSkyDepth}=await import('/solar-system/src/surface/sky-depth.js');
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(800,800);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,10);
    const map=await new THREE.TextureLoader().loadAsync('/solar-system/textures/8k_saturn.jpg');
    map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;map.anisotropy=4;
    const uniforms=createSaturnWeatherUniforms();
    const sun=new THREE.Vector3(),light=new THREE.DirectionalLight('white',2.2);
    scene.add(light,new THREE.AmbientLight('white',.018));
    const materials=[new THREE.MeshStandardMaterial({map,roughness:1}),new THREE.MeshLambertMaterial({map})];
    for(const material of materials){patchSaturnWeather(material,uniforms);bindPhysicalSun(material,sun);}
    bindSkyDepth(materials[1],{value:100000},{value:new THREE.Vector2(100,20)});
    const mesh=new THREE.Mesh(createBodyGeometry(bodyModels.saturn,new THREE.SphereGeometry(1,128,96)),materials[0]);scene.add(mesh);
    window.saturnProbe={render({time=0,progress=-1,u=.2,pole=false,night=false,lambert=false}={}){
      uniforms.uSaturnTime.value=time;uniforms.uSaturnProgress.value=progress;
      uniforms.uSaturnStorm.value.fromArray(saturnStormUv(0,u));
      const aim=pole?new THREE.Vector3(.02,1,.03).normalize():uvDirection(saturnStormUv(0,u));
      camera.position.copy(aim).multiplyScalar(4);camera.up.set(0,pole?0:1,pole?-1:0);camera.lookAt(0,0,0);
      sun.copy(aim).multiplyScalar(night?-1:1);light.position.copy(sun);
      mesh.material=materials[lambert?1:0];renderer.render(scene,camera);
    }};
  });
  async function render(name,options){
    await page.evaluate(options=>window.saturnProbe.render(options),options);
    const png=await page.locator('canvas').screenshot();
    await writeFile(new URL(name+'.png',output),png);
    return sharp(png).removeAlpha().raw().toBuffer();
  }
  function difference(a,b){
    let changed=0,total=0,sum=0;
    for(let y=100;y<700;y++)for(let x=100;x<700;x++){
      const i=(y*800+x)*3,delta=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));
      if(delta>2)changed++;sum+=delta;total++;
    }
    return {changed,fraction:changed/total,mean:sum/total};
  }
  const start=await render('clouds-0',{time:0});
  const moved=await render('clouds-8',{time:8});
  const cloudMotion=difference(start,moved);
  assert.ok(cloudMotion.changed>1000,'clouds do not move independently of the planet');
  assert.ok((await render('clouds-0-repeated',{time:0})).equals(start),'fixed weather state is not deterministic');
  const pole0=await render('pole-0',{time:0,pole:true});
  const pole8=await render('pole-8',{time:8,pole:true});
  const polarMotion=difference(pole0,pole8);
  assert.ok(polarMotion.changed>500,'polar cloud tracers do not move');
  const seam0=await render('seam-baseline',{time:12,u:.995});
  const seamStorm=await render('seam-storm',{time:12,u:.995,progress:.5});
  const outbreak=difference(seam0,seamStorm);
  assert.ok(outbreak.changed>2000,'outbreak disappears across the longitude seam');
  const left=await render('cycle-before',{time:31.99});
  const right=await render('cycle-after',{time:32.01});
  const wrap=difference(left,right);
  assert.ok(wrap.mean<cloudMotion.mean*.08,'bounded advection jumps at its cycle boundary');
  const night0=await render('night-baseline',{time:12,u:.995,night:true});
  const nightStorm=await render('night-storm',{time:12,u:.995,night:true,progress:.5});
  const night=difference(night0,nightStorm);
  assert.ok(night.mean<outbreak.mean*.15,'storm or haze glows on the unlit hemisphere');
  await render('landing-shared-material',{time:0,lambert:true,pole:true});
  assert.deepEqual(errors,[]);
  report.push({cloudMotion,polarMotion,outbreak,wrap,night});
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await browser.close();}
