import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from '../scripts/browser-launch.mjs';
const out='outputs/effects-20260916';await mkdir(out,{recursive:true});
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1100,height:700},deviceScaleFactor:1,reducedMotion:'reduce'});
await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(2026,8,16),playing:false,selected:null,speed:1000,speedUnit:'realtime'}})));
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.ATLAS_URL+'/solar-system/');
await page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
for(const [id,label] of [['saturn','saturn-spokes'],['mars','mars-caps'],['ganymede','ganymede-aurora'],['triton','triton-plume']]){
  await page.locator('#atlas-tab').click();
  await page.locator('#atlas-search').fill(id);
  await page.locator(`.atlas-item[data-body="${id}"]`).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({path:`${out}/${label}.png`});
  console.log(label,'captured');
}
console.log('page errors:',JSON.stringify(errors));
await browser.close();
