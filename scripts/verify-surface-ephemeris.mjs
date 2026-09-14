import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {revealLanding,landingFocusRestored} from './landing-navigation.mjs';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
const output=new URL('../test-results/surface-ephemeris/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
async function open(context,land=true){
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/solar-system/');
  await page.waitForFunction(()=>window.solarAtlas?.snapshot().ready&&!window.solarAtlas.snapshot().flight,null,{timeout:60000});
  if(land){await page.waitForFunction(()=>!window.solarAtlas.snapshot().ephemeris.blocked&&!window.solarAtlas.snapshot().flight);await revealLanding(page,'titan');await page.locator('[data-landing-body="titan"]').click();}
  return {page,errors};
}
async function seed(context,date){
  await context.addInitScript(({date})=>{
    sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{selected:'titan',playing:false,
      date,timelineEpoch:Date.UTC(1971,7,1,17),speed:1000,speedUnit:'realtime'}}));
  },{date});
}
try{
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,reducedMotion:'reduce'});
  const date=Date.parse('1971-08-01T17:00:00Z');await seed(context,date);
  let fail=true,calls=0;
  await context.route('**/ephemeris/saturn/1971.bin',route=>{calls++;return fail?route.fulfill({status:503,body:'Unavailable'}):route.continue();});
  const {page,errors}=await open(context,false);
  await page.waitForFunction(()=>window.solarAtlas.snapshot().ephemeris.error);
  assert.equal(await page.locator('[data-landing-body="titan"]').getAttribute('aria-disabled'),'true');
  assert.equal(await page.evaluate(()=>window.solarAtlas.snapshot().bodies.find(b=>b.id==='titan').visible),false);
  const errorTime=await page.evaluate(()=>window.solarAtlas.snapshot().date);
  assert.equal(errorTime,date);
  const retry=page.locator('#ephemeris-retry');
  await retry.click({trial:true});
  const bounds=await retry.boundingBox();assert.ok(bounds.width>=44&&bounds.height>=44);
  await page.screenshot({path:fileURLToPath(new URL('phone-missing-year.png',output))});
  await page.waitForTimeout(1200);assert.equal(calls,1,'no automatic request loop after failure');
  fail=false;await retry.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!window.solarAtlas.snapshot().ephemeris.blocked&&!window.solarAtlas.snapshot().flight);
  await revealLanding(page,'titan');
  await page.locator('[data-landing-body="titan"]').click();
  await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:60000});
  assert.equal(await page.evaluate(()=>window.solarAtlas.snapshot().surface.playing),false);
  assert.ok((await page.evaluate(()=>window.solarAtlas.snapshot().surface)).accuracy.includes('JPL SAT441'));
  assert.equal(await page.locator('.surface-ephemeris').isVisible(),false);
  await page.locator('.surface-exit').click();
  await page.waitForFunction(()=>!document.querySelector('.surface-view'));
  assert.equal(await landingFocusRestored(page,'titan'),true);
  assert.deepEqual(errors,[]);results.push({case:'initial failure and keyboard retry',calls,passed:true});
  await context.close();

  const boundary=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:2,reducedMotion:'reduce'});
  const start=Date.parse('1971-12-31T23:59:00Z');await seed(boundary,start);
  let failNext=true,nextCalls=0;
  await boundary.route('**/ephemeris/saturn/1972.bin',route=>{nextCalls++;return failNext?route.fulfill({status:503,body:'Unavailable'}):route.continue();});
  const second=await open(boundary),p=second.page;
  await p.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:60000});
  await p.locator('.surface-pause').click();
  await p.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ephemeris==='error',null,{timeout:30000});
  const held=await p.evaluate(()=>window.solarAtlas.snapshot().surface.date);
  assert.ok(held>=start&&held<Date.parse('1972-01-01T00:00:00Z'));
  const countAtFailure=nextCalls;
  await p.waitForTimeout(1200);
  assert.equal(await p.evaluate(()=>window.solarAtlas.snapshot().surface.date),held);
  assert.equal(nextCalls,countAtFailure);
  await p.locator('.surface-pause').click();
  failNext=false;await p.locator('.surface-ephemeris-retry').click();
  await p.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ephemeris==='ready');
  assert.equal(await p.evaluate(()=>window.solarAtlas.snapshot().surface.playing),false);
  assert.equal(await p.evaluate(()=>window.solarAtlas.snapshot().surface.date),held);
  await p.locator('.surface-pause').click();
  await p.waitForFunction(()=>window.solarAtlas.snapshot().surface.date>=Date.parse('1972-01-01T00:00:00Z'));
  await p.locator('.surface-pause').click();
  await p.screenshot({path:fileURLToPath(new URL('short-year-recovered.png',output))});
  assert.deepEqual(second.errors,[]);
  results.push({case:'year boundary stops without catch-up and preserves user pause through retry',held,nextCalls,passed:true});
  await boundary.close();
  await writeFile(new URL('report.json',output),JSON.stringify({base,results},null,2));
  console.log(JSON.stringify(results));
}finally{await browser.close();}
