import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5173',output='test-results/control-audit';
await mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:800,height:450},{width:640,height:360}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:viewport.width===390?2:1});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,600));});
  async function capture(scene,state){
   const audit=await page.evaluate(()=>{
    const controls=[...document.querySelectorAll('button,select,summary')].filter(e=>e.checkVisibility()&&!e.closest('[hidden]'));
    const rows=controls.map(e=>{const r=e.getBoundingClientRect();return{id:e.id||e.className,label:e.getAttribute('aria-label')||e.textContent?.trim(),x:r.x,y:r.y,w:r.width,h:r.height};});
    return {small:rows.filter(r=>r.w<43.5||r.h<43.5),outside:rows.filter(r=>r.x<-.5||r.y<-.5||r.x+r.w>innerWidth+.5||r.y+r.h>innerHeight+.5),controls:rows};
   });
   const cdp=await context.newCDPSession(page);
   const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
   await writeFile(`${output}/${scene}-${viewport.width}-${state}.png`,Buffer.from(shot.data,'base64'));
   await cdp.detach();results.push({scene,viewport,state,audit,errors:[...errors]});console.log(JSON.stringify({scene,viewport,state,small:audit.small.map(x=>x.id),outside:audit.outside.map(x=>x.id),errors}));
  }
  await page.goto(base+'/solar-system/');await page.waitForFunction(()=>window.solarAtlas?.snapshot().ready,null,{timeout:60000});await page.waitForTimeout(800);
  await capture('solar','overview');await page.locator('.planet-choice[data-body="earth"]').click();await page.waitForTimeout(1200);
  await page.locator('#rotation-toggle').click();await capture('solar','earth');
  await page.locator('#catalog-filter').selectOption('system:earth');await page.locator('.planet-choice[data-body="moon"]').click();
  await page.locator('#landing-button').click();await page.locator('.surface-skip').click();
  await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:60000});
  await page.locator('[data-zoom="4"]').click();await capture('surface','moon');
  await page.locator('.surface-time-toggle').click();await capture('surface','clock');
  for(const scene of ['orion-nebula','black-hole']){
   await page.goto(base+'/'+scene+'/');await page.waitForFunction(()=>document.documentElement.dataset.sceneReady==='true',null,{timeout:90000});
   await page.waitForTimeout(1200);await capture(scene,'overview');
   await page.locator('#settings-button').click();await capture(scene,'settings');
  }
  await context.close();
 }
}finally{await browser.close();await writeFile(`${output}/audit.json`,JSON.stringify(results,null,2));}
