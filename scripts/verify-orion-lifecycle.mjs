import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
const output=new URL('../test-results/orion-quality/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:640,height:360}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const request=window.requestAnimationFrame.bind(window);
  window.testFrameDelay=0;
  window.requestAnimationFrame=callback=>request(timestamp=>{
   if(window.testFrameDelay)setTimeout(()=>callback(performance.now()),window.testFrameDelay);
   else callback(timestamp);
  });
 });
 await page.goto(base+'/orion-nebula/');await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready);
 assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().currentQuality),'low');
 await page.evaluate(()=>window.testFrameDelay=60);
 await page.waitForFunction(()=>window.orionAtlas.snapshot().currentQuality==='minimal',null,{timeout:60000});
 const minimum=await page.evaluate(()=>window.orionAtlas.snapshot());
 assert.equal(minimum.quality,'auto');assert.ok(minimum.rendering.qualityChanges>=2);
 const pixels=await sharp(await page.locator('#universe').screenshot()).resize(96,64).removeAlpha().raw().toBuffer();
 assert.ok([...pixels].filter(v=>v>30).length/pixels.length>.07,'auto resize cleared the visible scene');
 await page.locator('#cruise-button').click();
 await page.waitForTimeout(200);
 const paused=await page.evaluate(()=>window.orionAtlas.snapshot());
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().frames),paused.frames);
 // Exercise the production visibility handler with an explicit simulated
 // visibility event; native tab/OS background behavior remains a separate gate.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.orionAtlas.snapshot().frames),paused.frames);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(300);
 const visible=await page.evaluate(()=>window.orionAtlas.snapshot());
 assert.equal(visible.cruiseTime,paused.cruiseTime);assert.equal(visible.currentQuality,'minimal');
 assert.equal(visible.rendering.qualityChanges,paused.rendering.qualityChanges);
 assert.ok(visible.frames<=paused.frames+1,'paused foreground return restarted continuous rendering');
 await page.locator('#quality-button').click();await page.locator('#quality').selectOption('smooth');await page.keyboard.press('Escape');
 await page.locator('#cruise-button').click();await page.waitForTimeout(4500);
 const manual=await page.evaluate(()=>window.orionAtlas.snapshot());
 assert.equal(manual.currentQuality,'smooth');assert.ok(manual.cruiseTime>visible.cruiseTime);
 await page.locator('#settings-button').click();
 await page.locator('#fullscreen-button').scrollIntoViewIfNeeded();await page.locator('#fullscreen-button').click();
 await page.waitForFunction(()=>!!document.fullscreenElement&&document.getElementById('fullscreen-button').getAttribute('aria-label')==='退出全屏');
 assert.equal(await page.locator('#fullscreen-button').getAttribute('aria-label'),'退出全屏');
 await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>!document.fullscreenElement&&document.getElementById('fullscreen-button').getAttribute('aria-label')==='全屏');
 assert.equal(await page.locator('#fullscreen-button').getAttribute('aria-label'),'全屏');
 await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:fileURLToPath(new URL('lifecycle.png',output))});
 await writeFile(new URL('lifecycle.json',output),JSON.stringify({controlledFramePacing:true,autoDownshift:true,manualFixed:true,simulatedVisibility:true,nativeVisibilityVerified:false,fullscreenState:true,minimumFps:minimum.fps},null,2));
 console.log('Automatic downshift, manual hold, pause, simulated visibility and fullscreen state passed');
}finally{await browser.close();}
