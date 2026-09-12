import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5192';
const output=new URL('../test-results/landings/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
const ids=(process.env.ATLAS_LANDING_IDS||'mercury,mars,io,titan,enceladus,pluto,miranda,moon,europa').split(',');
async function pixels(page,checkBrightness=true){
  const buffer=await page.locator('.surface-canvas canvas').screenshot();
  const {data,info}=await sharp(buffer).resize(120,80).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const lit=[...data].filter(v=>v>20).length;
  if(checkBrightness)assert.ok(lit>100,`Blank surface: ${lit}`);
  return {data,lit,channels:info.channels};
}
try{
  for(const [name,viewport] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}],['short',{width:640,height:360}]]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/shader|program|GL_INVALID/i.test(m.text()))errors.push(m.text());});
    page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(base+'/solar-system/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.solarAtlas?.snapshot().ready&&document.getElementById('loading-screen').hidden,null,{timeout:90000});
    for(const id of name==='short'?ids.filter(id=>['mars','mercury','titan'].includes(id)):ids){
      await page.locator('#atlas-tab').click();
      await page.locator('#atlas-search').fill(id);
      await page.locator(`.atlas-item[data-body="${id}"]`).click();
      await page.waitForFunction(id=>window.solarAtlas.snapshot().selected===id&&!window.solarAtlas.snapshot().flight,id,{timeout:30000});
      await page.locator('#landing-button').click();
      await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:90000});
      await page.locator('.surface-time-toggle').click();
      await page.locator('.surface-pause').click();
      await page.locator('.surface-clock-close').click();
      await page.locator('.surface-daylight').click();
      await page.waitForTimeout(300);
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
      if(!['titan','pluto'].includes(id)){
        await page.locator('.surface-parent').click();
        await page.waitForTimeout(100);
        await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}-sky.png`,output)),animations:'disabled'});
        await page.locator('.surface-reset').click();
      }
      if(id==='titan'||id==='pluto'){
        await page.locator('.surface-parent').click();
        await page.waitForFunction(()=>!document.querySelector('.surface-message').hidden);
        const notice=await page.locator('.surface-message').textContent();
        assert.match(notice,id==='titan'?/雾霾/:/地平线下/);
      }
      await page.locator('.surface-info-button').click();
      assert.ok((await page.locator('.surface-details').textContent()).includes(id==='mars'?'341':id==='mercury'?'176':'地表'));
      await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}-info.png`,output)),animations:'disabled'});
      await page.locator('.surface-details-close').click();
      if(id==='mercury'&&name==='desktop'){
        const download=page.waitForEvent('download');
        await page.locator('.surface-photo').click();
        assert.equal((await download).suggestedFilename(),'space-atlas-mercury.png');
      }
      await page.locator('.surface-exit').click();
      await page.waitForFunction(()=>!document.querySelector('.surface-view'),null,{timeout:10000});
      assert.equal(await page.evaluate(()=>window.solarAtlas.snapshot().selected),id);
      report.push({viewport:name,id,litChannels:initial.lit,passed:true});
      console.log(`${name}/${id}: passed`);
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  await writeFile(new URL('report.json',output),JSON.stringify({base,report},null,2));
}finally{await browser.close();}
