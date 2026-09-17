import {launchBrowser} from '../scripts/browser-launch.mjs';
const browser=await launchBrowser();
for(const [label,w,h,dpr] of [['desktop',1280,720,1],['phone',390,844,3]]){
  const context=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:dpr,reducedMotion:'reduce'});
  await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(2026,8,16),playing:false,selected:null,speed:1000,speedUnit:'realtime'}})));
  const page=await context.newPage();
  await page.goto(process.env.ATLAS_URL+'/solar-system/');
  await page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
  await page.locator('#date-jump').click();
  await page.waitForTimeout(600);
  await page.locator('#time-year-input').fill('2032');
  await page.locator('#time-jump-apply').click();
  await page.waitForTimeout(1800);
  await page.screenshot({path:`outputs/date-scrubber/panel-${label}.png`});
  console.log(label,'captured, date now',new Date((await page.evaluate(()=>window.solarAtlas.snapshot())).date).toISOString());
  await context.close();
}
await browser.close();
