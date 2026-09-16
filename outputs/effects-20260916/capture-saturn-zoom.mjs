import {launchBrowser} from '../scripts/browser-launch.mjs';
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1100,height:700},deviceScaleFactor:1,reducedMotion:'reduce'});
await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(2026,8,16),playing:false,selected:null,speed:1000,speedUnit:'realtime'}})));
const page=await context.newPage();
await page.goto(process.env.ATLAS_URL+'/solar-system/');
await page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
await page.locator('#atlas-tab').click();
await page.locator('#atlas-search').fill('saturn');
await page.locator('.atlas-item[data-body="saturn"]').first().click();
await page.waitForTimeout(2000);
for(let i=0;i<3;i++){await page.locator('#zoom-in').click();await page.waitForTimeout(900);}
await page.waitForTimeout(1500);
await page.screenshot({path:'outputs/effects-20260916/saturn-spokes.png'});
console.log('zoomed capture done; camera distance', JSON.stringify((await page.evaluate(()=>window.solarAtlas.snapshot())).distance));
await browser.close();
