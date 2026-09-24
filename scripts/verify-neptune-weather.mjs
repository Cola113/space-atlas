import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

const base=process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output=new URL('../test-results/neptune-weather/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await launchBrowser();
const report=[];
let currentPage, currentName;
const snapshot=page=>page.evaluate(()=>window.solarAtlas.snapshot());
const weather=s=>s.dynamics.bodies.find(b=>b.id==='neptune');
async function settle(page) {
  await page.waitForFunction(()=>{
    const s=window.solarAtlas?.snapshot();
    return s?.ready && !s.flight && !s.ephemeris.blocked && document.getElementById('loading-screen').hidden
      && s.bodies.find(b=>b.id==='neptune').textureWidth>=2048;
  },null,{timeout:90000});
}
async function capture(page,name) {
  await page.screenshot({path:fileURLToPath(new URL(name+'.png',output))});
  const pixels=await sharp(await page.locator('canvas').first().screenshot()).resize(128,80).removeAlpha().raw().toBuffer();
  assert.ok([...pixels].filter(x=>x>30).length>300,name+': blank canvas');
  const layout=await page.evaluate(()=>{
    const visible=[...document.querySelectorAll('[data-landmark]:not([hidden])')];
    const boxes=visible.map(button=>{
      const r=button.querySelector('.landmark-name').getBoundingClientRect();
      return {id:button.dataset.landmark,inBounds:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,
        clickable:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    });
    const close=document.querySelector('#landmark-brief-close'),r=close?close.getBoundingClientRect():null;
    return {overflow:document.documentElement.scrollWidth>innerWidth,boxes,
      briefHidden:!document.querySelector('#landmark-brief')||document.querySelector('#landmark-brief').hidden,
      closeAccessible:r?(r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&close.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))):true};
  });
  assert.equal(layout.overflow,false);
  for(const box of layout.boxes)assert.ok(box.inBounds&&box.clickable,JSON.stringify(box));
  if(!layout.briefHidden)assert.ok(layout.closeAccessible,name+': brief close inaccessible');
  report.push({name,layout,weather:weather(await snapshot(page))});
}
try {
  for(const [name,width,height,motion] of [
    ['desktop',1440,900,'no-preference'],['phone',390,844,'reduce'],['short',800,450,'reduce'],
  ].filter(([name])=>!process.env.ATLAS_VIEWPORT||process.env.ATLAS_VIEWPORT===name)) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:motion});
    await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{
      selected:'neptune',playing:false,followRotation:false,date:Date.UTC(1989,7,25,0),activityRate:4,
      speed:500,speedUnit:'realtime',dynamics:true,shadows:true,
    }})));
    const page=await context.newPage(),errors=[];
    currentPage=page; currentName=name;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(base+'/solar-system/');await settle(page);
    await capture(page,name+'-atmosphere');
    // The static dark-spot landmark reads straight from the texture uv.
    await page.locator('#observation-settings summary').click();
    await page.locator('#landmark-select').selectOption('dark-spot');
    await page.keyboard.press('Escape');await settle(page);
    await capture(page,name+'-dark-spot');
    await page.locator('#play-toggle').click();
    await page.waitForTimeout(1600);
    await page.locator('#play-toggle').click();
    assert.ok(weather(await snapshot(page)).time>0,'cloud clock did not advance');
    assert.equal(weather(await snapshot(page)).eventProgress,-1,'vortex started before the initial quiet interval');
    await capture(page,name+'-dark-spot-moving');
    // At fixed time and view the entire framebuffer must stay still, including haze.
    await settle(page);
    const paused=await snapshot(page),a=await page.locator('canvas').first().screenshot();
    await page.waitForTimeout(400);
    const b=await page.locator('canvas').first().screenshot();
    assert.deepEqual(weather(await snapshot(page)).weather,weather(paused).weather);
    const globe=paused.bodies.find(body=>body.id==='neptune');
    const aa=await sharp(a).removeAlpha().raw().toBuffer(),bb=await sharp(b).removeAlpha().raw().toBuffer();
    let changed=0,total=0,max=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      if(Math.hypot(x-globe.x,y-globe.y)>globe.radiusPx*.6)continue;
      const i=(y*width+x)*3;
      const delta=Math.max(...[0,1,2].map(c=>Math.abs(aa[i+c]-bb[i+c])));
      total++;if(delta>2)changed++;max=Math.max(max,delta);
    }
    console.log(name,'paused globe pixels',{changed,total,max});
    assert.ok(changed/total<.001,'paused cloud tops keep changing');
    await page.locator('#landmark-brief-close').click();
    await page.locator('#play-toggle').click();
    // Automatic vortices repeat without clicking the trigger or stealing the view.
    await page.waitForFunction(()=>window.solarAtlas.snapshot().dynamics.bodies.find(b=>b.id==='neptune').eventCount===1,null,{timeout:60000});
    const automatic=await snapshot(page);
    assert.equal(automatic.landmarks.active,'dark-spot','automatic vortex steals the selected landmark');
    assert.equal(automatic.landmarks.markers.find(m=>m.id==='neptune-vortex').available,true);
    assert.equal(await page.locator('#landmark-brief').isVisible(),false,'automatic vortex reopens the description');
    await page.locator('#play-toggle').click();
    const autoPaused=weather(await snapshot(page)).weather;
    await page.waitForTimeout(400);
    assert.deepEqual(weather(await snapshot(page)).weather,autoPaused,'automatic vortex ignores pause');
    await page.locator('#play-toggle').click();
    await page.waitForFunction(()=>window.solarAtlas.snapshot().dynamics.bodies.find(b=>b.id==='neptune').eventCount===2,null,{timeout:60000});
    assert.equal((await snapshot(page)).landmarks.active,'dark-spot','repeated vortex steals the selected landmark');
    await page.waitForFunction(()=>window.solarAtlas.snapshot().dynamics.bodies.find(b=>b.id==='neptune').eventProgress<0,null,{timeout:40000});
    await page.locator('#body-details-button').click();
    await page.locator('#event-trigger').click();await settle(page);
    assert.equal((await snapshot(page)).landmarks.active,'neptune-vortex');
    await page.waitForFunction(()=>window.solarAtlas.snapshot().dynamics.bodies.find(b=>b.id==='neptune').eventProgress>.35,null,{timeout:30000});
    await page.locator('#play-toggle').click();
    await capture(page,name+'-dark-vortex');
    const event=await snapshot(page);
    assert.ok(event.landmarks.markers.find(m=>m.id==='neptune-vortex').visible,'vortex anchor not visible');
    const spot=event.dynamics.bodies.find(body=>body.id==='neptune').weather.spotUv;
    assert.ok(spot.every(Number.isFinite),'spot uv is not finite');
    await page.locator('#landmark-brief-close').click();
    assert.equal((await snapshot(page)).landmarks.active,'neptune-vortex','closing description stops following');
    await page.locator('#play-toggle').click();
    await page.waitForFunction(()=>window.solarAtlas.snapshot().dynamics.bodies.find(b=>b.id==='neptune').eventProgress<0,null,{timeout:40000});
    assert.equal((await snapshot(page)).landmarks.active,null,'expired vortex still followed');
    assert.equal((await snapshot(page)).followRotation,false,'follow preference was not restored');
    await page.locator('#play-toggle').click();
    // Hiding dynamics removes a live vortex and its marker even when paused.
    await page.locator('#play-toggle').click();await page.locator('#body-details-button').click();await page.locator('#event-trigger').click();await settle(page);
    await page.locator('#play-toggle').click();
    const frozenEvent=await snapshot(page);
    await page.locator('#display-settings summary').click();await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!window.solarAtlas.snapshot().landmarks.active);
    assert.equal((await snapshot(page)).landmarks.markers.find(m=>m.id==='neptune-vortex').available,false);
    const cancelled=await snapshot(page);
    assert.equal(cancelled.date,frozenEvent.date,'disabling weather changes the simulation date');
    assert.deepEqual(cancelled.bodies.find(b=>b.id==='neptune').physicalOrientation,
      frozenEvent.bodies.find(b=>b.id==='neptune').physicalOrientation,'disabling weather changes physical attitude');
    await page.locator('#display-settings summary').click();await page.locator('#activity-toggle').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>window.solarAtlas.snapshot().dynamics.enabled);
    assert.equal(weather(await snapshot(page)).eventProgress,-1,'cancelled vortex reappears');
    assert.deepEqual(errors,[]);
    await context.close();
    currentPage=null;
  }
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));
  console.log('Neptune weather: cloud motion, pause, vortex lifecycle, follow, labels and shader compilation passed.');
} catch(error) {
  if(currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({path:fileURLToPath(new URL(currentName+'-failure.png',output))});
    await writeFile(new URL(currentName+'-failure.json',output),JSON.stringify(await snapshot(currentPage),null,2));
  }
  throw error;
} finally {await browser.close();}
