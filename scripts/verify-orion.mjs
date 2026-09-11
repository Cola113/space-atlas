import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5173';
const output=new URL('../test-results/orion-cruise/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
const ready=page=>page.waitForFunction(()=>window.orionAtlas?.snapshot().ready&&window.orionAtlas.snapshot().frames>30,null,{timeout:60000});
async function pixels(page){
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('universe')).opacity==='1');
 const buffer=await page.locator('#universe').screenshot();
 const data=await sharp(buffer).resize(128,96).removeAlpha().raw().toBuffer();
 assert.ok([...data].filter(v=>v>30).length/data.length>.07,'Nebula canvas is blank');
 return data;
}
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:800,height:450},{width:640,height:360}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:viewport.width===390,hasTouch:viewport.width===390});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base+'/orion-nebula/');await ready(page);
  assert.equal(await page.locator('#view-select,#home-button,#zoom-in,#zoom-out,#enter-button,[data-location]').count(),0);
  const start=await page.evaluate(()=>window.orionAtlas.snapshot());
  assert.equal(start.cruise,true);assert.equal(start.mode,'cruise');
  const before=await pixels(page);
  await page.waitForFunction(t=>window.orionAtlas.snapshot().cruiseTime>t+.5,start.cruiseTime);
  const after=await pixels(page);
  assert.ok(before.some((v,i)=>Math.abs(v-after[i])>4),'Cruise is visually stationary');
  await page.locator('#cruise-button').click();
  assert.equal(await page.locator('#cruise-button').getAttribute('aria-label'),'继续巡游');
  const paused=await page.evaluate(()=>window.orionAtlas.snapshot());
  await page.mouse.move(viewport.width*.45,viewport.height*.5);await page.mouse.down();
  await page.mouse.move(viewport.width*.7,viewport.height*.6,{steps:16});await page.mouse.up();
  await page.mouse.wheel(0,-650);await page.mouse.wheel(0,650);
  await page.mouse.dblclick(viewport.width*.6,viewport.height*.5);
  await page.keyboard.press('+');await page.keyboard.press('-');await page.keyboard.press('ArrowUp');await page.keyboard.press('w');await page.keyboard.press('r');
  if(viewport.width===390){
   const client=await context.newCDPSession(page);
   await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:130,y:350,id:1},{x:240,y:350,id:2}]});
   for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:130-i*5,y:350,id:1},{x:240+i*5,y:350,id:2}]});
   await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();
  }
  assert.deepEqual(await page.evaluate(()=>window.orionAtlas.snapshot().pose),paused.pose,'Manual input moved the camera');
  assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().cruiseTime),paused.cruiseTime);
  assert.equal(await page.evaluate(()=>visualViewport.scale),1);
  await page.locator('#cruise-button').click();
  await page.mouse.move(viewport.width*.45,viewport.height*.5);await page.mouse.down();await page.mouse.move(viewport.width*.7,viewport.height*.6,{steps:10});await page.mouse.up();await page.mouse.wheel(0,-500);
  await page.waitForFunction(t=>window.orionAtlas.snapshot().cruiseTime>t+.25,paused.cruiseTime);
  assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().cruise),true,'Pointer input interrupted the tour');
  await page.locator('#cruise-button').click();
  await page.locator('#settings-button').click();await page.locator('#quality').selectOption('low');
  await page.locator('#exposure').fill('1.35');await page.locator('#exposure').dispatchEvent('input');
  await page.locator('#settings-panel .close-panel').click();
  await page.locator('#science-button').click();await page.locator('#science-panel img').evaluate(img=>img.decode());await page.locator('#science-panel .close-panel').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#capture-button').click();
  const download=await downloadPromise;assert.equal(download.suggestedFilename(),'orion-nebula.png');
  await download.saveAs(fileURLToPath(new URL(viewport.width+'-capture.png',output)));
  await page.mouse.move(0,0);
  await page.screenshot({path:fileURLToPath(new URL(viewport.width+'-overview.png',output))});
  const layout=await page.evaluate(()=>{
   const r=document.querySelector('.view-caption').getBoundingClientRect(),d=document.querySelector('.dock').getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth>innerWidth,overlap:r.left<d.right&&r.right>d.left&&r.top<d.bottom&&r.bottom>d.top,dockVisible:d.left>=0&&d.right<=innerWidth&&d.bottom<=innerHeight};
  });
  assert.equal(layout.overflow,false);assert.equal(layout.overlap,false);assert.equal(layout.dockVisible,true);
  const saved=await page.evaluate(()=>window.orionAtlas.snapshot());
  await page.reload();await ready(page);
  const restored=await page.evaluate(()=>window.orionAtlas.snapshot());
  assert.equal(restored.cruise,false);assert.equal(restored.cruiseTime,saved.cruiseTime);assert.deepEqual(restored.pose,saved.pose);
  assert.equal(restored.quality,'low');assert.equal(restored.exposure,1.35);
  await page.evaluate(()=>sessionStorage.setItem('space-atlas:scene:orion-nebula',JSON.stringify({version:1,value:{version:3,cruise:false,mode:'flight',pose:{position:[0,0,-15],target:[0,0,-25]}}})));
  // A new document must not let the old page's pagehide save overwrite the migration fixture.
  const legacy=await context.newPage();await legacy.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:orion-nebula',JSON.stringify({version:1,value:{version:3,cruise:false,mode:'flight',pose:{position:[0,0,-15],target:[0,0,-25]}}})));
  await legacy.goto(base+'/orion-nebula/');await ready(legacy);
  const migrated=await legacy.evaluate(()=>window.orionAtlas.snapshot());
  assert.equal(migrated.cruise,true);assert.ok(migrated.pose.position[2]>30);await legacy.close();
  assert.deepEqual(errors,[]);
  results.push({viewport,manualCameraInputDisabled:true,autoMotion:true,pauseResume:true,sessionRestore:true,legacyMigration:true,layout});
  console.log(JSON.stringify({viewport,passed:true}));await context.close();
 }
 const reduced=await browser.newContext({reducedMotion:'reduce'}),page=await reduced.newPage();
 await page.goto(base+'/orion-nebula/');await ready(page);
 assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().cruise),true);
 await page.locator('#cruise-button').click();
 assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().cruise),false);await reduced.close();
 for(const asset of ['cloud-guide.webp','density-guide.webp','stars.json']){
  const context=await browser.newContext(),page=await context.newPage();
  await page.route('**/orion-nebula/'+asset,route=>route.abort());
  await page.goto(base+'/orion-nebula/');await page.locator('#fatal').waitFor({state:'visible'});
  assert.equal(await page.locator('#loading').isVisible(),false);await context.close();
 }
 await writeFile(new URL('verification.json',output),JSON.stringify({results,assetFailuresHandled:true},null,2));
}finally{await browser.close();}
