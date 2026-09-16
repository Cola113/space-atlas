import {chromium} from 'playwright';
import {launchBrowser} from './browser-launch.mjs';

import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const out='test-results/solar-controls',base=process.env.ATLAS_URL||'http://127.0.0.1:5191';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),results=[];let page,name;
const snap=()=>page.evaluate(()=>window.solarAtlas.snapshot());
const settle=()=>page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
const direct=['#scene-switcher','#overview-tab','#atlas-tab','#display-settings summary','#rotation-toggle','#observation-settings summary','#back-button','#body-details-button','#surface-button','[data-landing-site]','#zoom-in','#zoom-out','#reset-camera','#play-toggle','#time-settings summary','#catalog-filter','#dock-prev','#dock-next'];
async function control(sel,{scroll=false}={}){
 const e=page.locator(sel).first();if(scroll)await e.scrollIntoViewIfNeeded();
 const r=await e.boundingBox(),vp=page.viewportSize();
 assert.ok(r&&r.width>=43.9&&r.height>=43.9,`${name} small ${sel} ${JSON.stringify(r)}`);
 assert.ok(r.x>=-.1&&r.y>=-.1&&r.x+r.width<=vp.width+.1&&r.y+r.height<=vp.height+.1,`${name} outside ${sel} ${JSON.stringify(r)}`);
 const hit=await e.evaluate(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return h===e||e.contains(h);});
 assert.ok(hit,`${name} covered ${sel}`);return {...r,sel};
}
function gaps(rects){for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];const dx=Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width),dy=Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height);assert.ok(Math.hypot(dx,dy)>=7.9,`${name} gap ${a.sel}/${b.sel}: ${dx},${dy}`);}}
async function directControls(){const rects=[];for(const sel of direct)if(await page.locator(sel).first().isVisible())rects.push(await control(sel));gaps(rects);const info=await page.locator('#planet-info').boundingBox(),footer=await page.locator('.explorer-bottom').boundingBox();if(info)assert.ok(info.y+info.height<=footer.y-7.9,`${name} info overlaps footer`);return rects;}
async function select(id){await page.locator('#atlas-tab').click();await page.locator('#atlas-search').fill(id);await page.locator(`.atlas-item[data-body="${id}"]`).click();await settle();}
async function openDisplay(){await page.locator('#display-settings summary').click();}
async function checkDisplay(){await openDisplay();const rects=[];for(const sel of ['#display-settings-close','#activity-toggle','#orbit-toggle','#label-toggle','#info-button','#fullscreen','#reset-camera'])rects.push(await control(sel,{scroll:true}));
 for(const [id,key] of [['activity-toggle','dynamics'],['orbit-toggle','orbits'],['label-toggle','labels']]){const before=await page.locator('#'+id).getAttribute('aria-pressed');await page.locator('#'+id).click();assert.equal(await page.locator('#'+id).getAttribute('aria-pressed'),String(before!=='true'));assert.match(await page.locator('#'+id+' span').textContent(),before==='true'?/关$/:/开$/);await page.locator('#'+id).click();}
 await page.locator('#fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);assert.match(await page.locator('#fullscreen span').textContent(),/开$/);await page.locator('#fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement);
 await page.locator('#reset-camera').click();await settle();await openDisplay();
 await page.locator('#info-button').click();assert.equal(await page.locator('#credits-dialog').getAttribute('open'),'');await control('#close-credits');await page.keyboard.press('Escape');assert.equal(await page.locator('#display-settings summary').evaluate(e=>e===document.activeElement),true);
 await openDisplay();await page.locator('#display-settings-close').click();assert.equal(await page.locator('#display-settings summary').evaluate(e=>e===document.activeElement),true);return rects;
}
try{for(const [caseName,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 name=caseName;const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(1971,7,1),playing:false,selected:'europa',speed:1000,speedUnit:'realtime'}})));
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/solar-system/');await settle();
 const normal=await directControls();await page.screenshot({path:`${out}/${name}-europa.png`});
 const start=await snap();await page.locator('#surface-button').click();await settle();assert.equal((await snap()).close,true);assert.equal((await snap()).date,start.date);await page.locator('#surface-button').click();await settle();
 for(const selector of ['#zoom-in','#zoom-out']){await page.locator(selector).click();await settle();assert.equal((await snap()).date,start.date);}
 await page.locator('#body-details-button').click();const date=(await snap()).date;await control('#close-body-details');assert.match(await page.locator('#planet-title').textContent(),/木卫二/);await page.waitForTimeout(100);assert.equal((await snap()).date,date);
 await control('#activity-rate',{scroll:true});await page.locator('#activity-rate').selectOption('2');assert.equal(await page.locator('#activity-rate').inputValue(),'2');await page.screenshot({path:`${out}/${name}-details-scrolled.png`});await page.keyboard.press('Escape');assert.equal(await page.locator('#body-details-button').evaluate(e=>e===document.activeElement),true);
 const display=await checkDisplay();
 await page.locator('#scene-switcher').click();for(const id of ['solar-system','black-hole','orion-nebula'])await control(`#scene-menu a[data-scene-link="${id}"]`,{scroll:true});await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#scene-menu a').evaluateAll(a=>a.some(e=>e===document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#scene-switcher').evaluate(e=>e===document.activeElement),true);
 await select('earth');await page.locator('#body-details-button').click();for(const sel of ['#cloud-mode','#activity-rate','#layer-toggle'])await control(sel,{scroll:true});const checked=await page.locator('#layer-toggle').isChecked();await page.locator('#layer-toggle').setChecked(!checked);await page.locator('#layer-toggle').setChecked(checked);await page.keyboard.press('Escape');
 await page.locator('#observation-settings summary').click();const obs=[];for(const sel of ['#family-select','#landmark-select','#night-view','#night-toggle','#shadow-toggle'])if(await page.locator(sel).isVisible())obs.push(await control(sel,{scroll:true}));
 await page.locator('#landmark-select').selectOption({index:1});await settle();await control('#landmark-clear',{scroll:true});await page.locator('#landmark-clear').click();await settle();
 if(await page.locator('#observation-settings').getAttribute('open')===null)await page.locator('#observation-settings summary').click();
 await page.locator('#night-view').click();await settle();await page.keyboard.press('Escape');
 await select('europa');
 // Simulated cutouts reserve the same CSS geometry as native env() values; this is not a hardware notch test.
 await page.addStyleTag({content:'#app{--safe-top:20px;--safe-bottom:20px;--safe-left:24px;--safe-right:24px}'});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await settle();const safe=await directControls();await page.screenshot({path:`${out}/${name}-safe.png`});
 await page.locator('#back-button').click();await settle();assert.equal((await snap()).selected,null);await control('#explore-earth',{scroll:true});await page.locator('#explore-earth').click();await settle();assert.equal((await snap()).selected,'earth');
 assert.deepEqual(errors,[]);results.push({name,dpr,normal,display,observation:obs,safe,passed:true,errors});console.log(name,'controls passed');await context.close();
}await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));}
catch(error){if(page&&!page.isClosed()){await page.screenshot({path:`${out}/failure-${name}.png`});await writeFile(`${out}/failure.json`,JSON.stringify({name,error:error.stack,snapshot:await snap()},null,2));}throw error;}finally{await browser.close();}
