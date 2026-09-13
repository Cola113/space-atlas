import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5190';
const output=new URL('../test-results/orion-quality/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
const snapshot=page=>page.evaluate(()=>window.orionAtlas.snapshot());
const nextPaint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
try {
 for(const [width,height,dpr] of [[1440,900,1],[390,844,3],[800,450,2],[640,360,2]]) {
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,isMobile:width===390,hasTouch:width===390});
  const page=await context.newPage(),errors=[],assets=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(/cloud-guide|density-guide|stars\.json/.test(r.url()))assets.push(r.url());});
  await page.goto(base+'/orion-nebula/');
  await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready);
  assert.equal((await snapshot(page)).currentQuality,'low','auto must start at energy saving on all devices');
  await page.locator('#cruise-button').click();await nextPaint(page);
  const paused=await snapshot(page),initialAssets=assets.length;
  await page.waitForTimeout(600);
  assert.equal((await snapshot(page)).frames,paused.frames,'paused scene rendered without an invalidation');
  await page.locator('#quality-button').click();
  assert.equal(await page.locator('#quality').evaluate(e=>e===document.activeElement),true);
  const modes=[];
  for(const [mode,pixels,steps,starSteps,background] of [['high',1250000,176,48,8000],['low',480000,96,48,8000],['smooth',240000,48,16,3000],['minimal',100000,24,8,1000]]) {
   await page.locator('#quality').selectOption(mode);await nextPaint(page);
   const s=await snapshot(page),r=s.rendering;
   assert.equal(s.currentQuality,mode);assert.equal(s.quality,mode);
   assert.ok(r.width*r.height<=pixels,JSON.stringify(r));
   assert.equal(r.preset.volumeSteps,steps);assert.equal(r.preset.starSteps,starSteps);
   assert.equal(r.drawnStars-r.anchorStars,background);
   assert.deepEqual(s.pose,paused.pose);assert.equal(s.cruiseTime,paused.cruiseTime);
   assert.equal(s.exposure,paused.exposure);assert.equal(s.stars,paused.stars);
   assert.deepEqual(r.memory,paused.rendering.memory,'quality rebuilt geometry or textures');
   assert.equal(r.programs,paused.rendering.programs,'quality recompiled shader programs');
   assert.equal(assets.length,initialAssets,'quality fetched cloud assets again');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#quality-button').evaluate(e=>e===document.activeElement),true);
   const png=await page.locator('#universe').screenshot();
   const raw=await sharp(png).resize(128,96).removeAlpha().raw().toBuffer();
   assert.ok([...raw].filter(v=>v>30).length/raw.length>.07,'quality lost the visible cloud');
   await page.screenshot({path:fileURLToPath(new URL(`${width}-${mode}.png`,output))});
   modes.push({mode,rendering:r});
   await page.locator('#quality-button').click();
  }
  await page.locator('#exposure').fill('1.55');await page.locator('#exposure').dispatchEvent('input');await nextPaint(page);
  assert.equal((await snapshot(page)).exposure,1.55);
  const settings=await snapshot(page);await page.waitForTimeout(300);
  assert.equal((await snapshot(page)).frames,settings.frames);
  await page.keyboard.press('Escape');
  const downloading=page.waitForEvent('download');await page.locator('#capture-button').click();
  const download=await downloading;await download.saveAs(fileURLToPath(new URL(`${width}-capture.png`,output)));
  const captured=await snapshot(page);await page.waitForTimeout(300);
  assert.equal((await snapshot(page)).frames,captured.frames,'screenshot restarted paused rendering');
  // Exercise reserved safe areas even on a desktop browser without a notch.
  await page.addStyleTag({content:':root{--safe-top:20px;--safe-bottom:20px}'});
  const layout=await page.evaluate(()=>{
   const nodes=[...document.querySelectorAll('#scene-switcher,.top-actions button,.dock button')];
   const boxes=nodes.map(el=>({id:el.id,...Object.fromEntries(['left','top','right','bottom','width','height'].map(k=>[k,el.getBoundingClientRect()[k]]))}));
   return {boxes,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(layout.overflow,false);
  for(const b of layout.boxes){assert.ok(b.width>=44&&b.height>=44,JSON.stringify(b));assert.ok(b.left>=0&&b.right<=width&&b.top>=0&&b.bottom<=height,JSON.stringify(b));}
  for(const a of layout.boxes)for(const b of layout.boxes)if(a.id!==b.id){
   assert.ok(a.right+7.9<=b.left||b.right+7.9<=a.left||a.bottom+7.9<=b.top||b.bottom+7.9<=a.top,`${a.id} / ${b.id} overlap or lack spacing`);
  }
  await page.locator('#settings-button').click();
  await page.locator('#fullscreen-button').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('#fullscreen-button').isVisible());
  await page.locator('#quality').selectOption('auto');
  assert.equal((await snapshot(page)).currentQuality,'low');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings-button').evaluate(e=>e===document.activeElement),true);
  await page.screenshot({path:fileURLToPath(new URL(`${width}-safe-area.png`,output))});
  await page.reload();await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready);
  const restored=await snapshot(page);assert.equal(restored.quality,'auto');assert.equal(restored.currentQuality,'low');assert.equal(restored.cruise,false);assert.equal(restored.exposure,1.55);
  assert.deepEqual(errors,[]);
  report.push({width,height,dpr,modes,layout,pauseOnDemand:true,resourceReuse:true,keyboardAndSafeArea:true});
  console.log(JSON.stringify({width,qualityAndLayoutPassed:true}));
  await context.close();
 }
 await writeFile(new URL('verification.json',output),JSON.stringify({browser:browser.version(),report},null,2));
} finally {await browser.close();}
