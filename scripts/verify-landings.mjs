import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { configureDeploymentAccess } from './deployment-access.mjs';
import { revealLanding } from './landing-navigation.mjs';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5192';
const output=new URL(process.env.ATLAS_OUTPUT||'../test-results/landings/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
const ids=(process.env.ATLAS_LANDING_IDS||'moon,moon-farside,europa,europa-subjovian,mars,mars-phoenix,io,io-subjovian,titan,enceladus,pluto,pluto-charonface,miranda,mercury,mercury-pole,charon,venus').split(',');
// Sites whose parent cannot be looked at: haze hides it, or it never rises here.
const parentNotice={titan:/雾霾/,pluto:/地平线下/,'moon-farside':/地平线下/};
async function pixels(page,checkBrightness=true){
  const buffer=await page.locator('.surface-canvas canvas').screenshot();
  // fit:'fill' keeps the whole frame; the default 'cover' crops a portrait phone to
  // its middle band, which is sky, and reports a lit surface as blank.
  const {data,info}=await sharp(buffer).resize(120,80,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const lit=[...data].filter(v=>v>20).length;
  if(checkBrightness)assert.ok(lit>100,`Blank surface: ${lit}`);
  return {data,lit,channels:info.channels};
}
try{
  for(const [name,viewport] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}],['tablet',{width:800,height:450}],['short',{width:640,height:360}]]){
    const context=await browser.newContext({viewport,deviceScaleFactor:name==='phone'?3:name==='desktop'?1:2,reducedMotion:'reduce',acceptDownloads:true});
    await configureDeploymentAccess(context,base);
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/shader|program|GL_INVALID/i.test(m.text()))errors.push(m.text());});
    page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base+'/solar-system/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.solarAtlas?.snapshot().ready&&document.getElementById('loading-screen').hidden,null,{timeout:90000});
    for(const id of ids){
      // The catalogue item is keyed by body, while a body may carry several sites,
      // so resolve the site id the app publishes before selecting anything.
      const {body}=await page.evaluate(id=>window.solarAtlas.snapshot().landing.find(site=>site.siteId===id),id);
      // The dock tab is a toggle, and the previous site may have left the drawer open.
      if(!await page.locator('#atlas-search').isVisible())await page.locator('#atlas-tab').click();
      await page.locator('#atlas-search').fill(body);
      await page.locator(`.atlas-item[data-body="${body}"]`).click();
      await page.waitForFunction(body=>window.solarAtlas.snapshot().selected===body&&!window.solarAtlas.snapshot().flight,body,{timeout:30000});
      await page.waitForFunction(()=>!window.solarAtlas.snapshot().ephemeris.blocked);
      await revealLanding(page,id);
      const orbit=await page.evaluate(()=>window.solarAtlas.snapshot());
      await page.locator(`[data-landing-site="${id}"]`).click();
      try{await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:90000});}
      catch(error){await writeFile(new URL('failure.json',output),JSON.stringify({name,id,errors,snapshot:await page.evaluate(()=>window.solarAtlas.snapshot()),message:await page.locator('.surface-view').textContent()},null,2));await page.screenshot({path:fileURLToPath(new URL('failure.png',output))});throw error;}
      if(!orbit.playing){const arrived=await page.evaluate(()=>window.solarAtlas.snapshot().surface);assert.equal(arrived.date,orbit.date);assert.equal(arrived.playing,false);assert.deepEqual(arrived.centerKm,orbit.bodies.find(b=>b.id===body).physicalPositionKm);}
      await page.locator('.surface-time-toggle').click();
      if(await page.evaluate(()=>window.solarAtlas.snapshot().surface.playing))await page.locator('.surface-pause').click();
      await page.locator('.surface-clock-close').click();
      await page.locator('.surface-daylight').click();
      await page.waitForFunction(()=>!document.querySelector('.surface-daylight').disabled);
      await page.waitForTimeout(200);
      const physical=await page.evaluate(()=>window.solarAtlas.snapshot().surface);
      assert.equal(physical.playing,false);
      assert.equal(physical.magnification,1);
      for(const zoom of [2,4,8,1]){
        await page.locator('.surface-telescope').click();
        const current=await page.evaluate(()=>window.solarAtlas.snapshot().surface);
        assert.equal(current.magnification,zoom);assert.equal(current.cameraZoom,zoom);
        assert.ok(Math.abs(current.fieldOfView-2*Math.atan(Math.tan(31*Math.PI/180)/zoom)*180/Math.PI)<1e-10);
        assert.equal(current.date,physical.date);
        assert.deepEqual(current.targets,physical.targets,'zoom must not change physical directions or sizes');
        if(zoom===8&&['europa','mercury'].includes(id))await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}-8x.png`,output)),animations:'disabled'});
      }
      const controls=await page.locator('.surface-view button').evaluateAll(buttons=>buttons.filter(b=>!b.disabled&&b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden').map(b=>{
        const r=b.getBoundingClientRect();return {name:b.getAttribute('aria-label')||b.textContent.trim(),width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom};
      }));
      for(const control of controls){assert.ok(control.width>=43.9&&control.height>=43.9,JSON.stringify(control));assert.ok(control.x>=0&&control.y>=0&&control.right<=viewport.width+.1&&control.bottom<=viewport.height+.1,JSON.stringify(control));}
      for(let a=0;a<controls.length;a++)for(let b=a+1;b<controls.length;b++){
        const x=controls[a],y=controls[b],dx=Math.max(x.x-y.right,y.x-x.right),dy=Math.max(x.y-y.bottom,y.y-x.bottom);
        assert.ok(dx>=7.9||dy>=7.9,`Controls lack 8px gap: ${x.name} / ${y.name}`);
      }
      const initial=await pixels(page);
      await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}.png`,output)),animations:'disabled'});
      const bounds=await page.evaluate(()=>{
        const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
        return {location:rect('.surface-location'),header:rect('.surface-header'),footer:rect('.surface-footer'),overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth,height:innerHeight};
      });
      assert.equal(bounds.overflow,false);
      assert.ok(bounds.location.bottom<bounds.footer.y,JSON.stringify(bounds));
      assert.ok(bounds.footer.x>=0&&bounds.footer.right<=viewport.width&&bounds.footer.bottom<=viewport.height,JSON.stringify(bounds));
      const before=await page.locator('.surface-view').getAttribute('data-heading');
      await page.locator('.surface-canvas canvas').focus();
      for(let step=0;step<8;step++)await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      assert.notEqual(await page.locator('.surface-view').getAttribute('data-heading'),before);
      const after=await pixels(page,false);
      assert.ok(after.data.some((v,i)=>Math.abs(v-initial.data[i])>8),'View does not move');
      await page.locator('.surface-reset').click();
      await page.locator('.surface-parent').click();
      if(parentNotice[id]){
        await page.waitForFunction(()=>!document.querySelector('.surface-message').hidden);
        assert.match(await page.locator('.surface-message').textContent(),parentNotice[id]);
      }else{
        await page.waitForTimeout(100);
        await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}-sky.png`,output)),animations:'disabled'});
        await page.locator('.surface-reset').click();
      }
      await page.locator('.surface-info-button').click();
      assert.ok((await page.locator('.surface-details').textContent()).includes(id==='mars'?'341':id==='mercury'?'176':'地表'));
      await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}-info.png`,output)),animations:'disabled'});
      await page.locator('.surface-details-close').click();
      assert.equal(await page.locator('.surface-info-button').evaluate(b=>document.activeElement===b),true);
      if(id==='mercury'&&name==='desktop'){
        const download=page.waitForEvent('download');
        await page.locator('.surface-photo').click();
        assert.equal((await download).suggestedFilename(),'space-atlas-mercury.png');
      }
      await page.locator('.surface-exit').click();
      await page.waitForFunction(()=>!document.querySelector('.surface-view'),null,{timeout:10000});
      assert.equal(await page.evaluate(()=>window.solarAtlas.snapshot().selected),body);
      report.push({viewport:name,id,litChannels:initial.lit,physicalDate:physical.date,controls:controls.length,zoom:[1,2,4,8],passed:true});
      console.log(`${name}/${id}: passed`);
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  await writeFile(new URL(process.env.ATLAS_REPORT||'report.json',output),JSON.stringify({base,report},null,2));
}finally{await browser.close();}
