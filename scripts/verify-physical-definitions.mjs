import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const out='test-results/physical-definitions',base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
await mkdir(out,{recursive:true});
const definitions=JSON.parse(await readFile('solar-system/src/physics/body-definitions.json','utf8'));
const browser=await chromium.launch({channel:'msedge',headless:true});const report=[];
try{
 for(const [name,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
  await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(1971,7,1),playing:false,selected:'earth',speed:1000,speedUnit:'realtime'}})));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const settle=()=>page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
  await page.goto(base+'/solar-system/');await settle();
  const checks=[];
  for(const id of ['vesta','haumea','hiiaka','makemake','nereid','phoebe','janus','styx','earth','io','europa']){
   await page.locator('#atlas-tab').click();await page.locator('#atlas-search').fill(id);await page.locator(`.atlas-item[data-body="${id}"]`).click();await settle();
   const snapshot=await page.evaluate(()=>window.solarAtlas.snapshot());const body=snapshot.bodies.find(b=>b.id===id);
   assert.equal(body.radiusKm,definitions.bodies[id].radius.value);assert.ok(body.physicalAvailable&&body.visible);
   assert.ok(body.physicalPositionKm.every(Number.isFinite)&&body.physicalOrientation.every(Number.isFinite));
   if(definitions.bodies[id].orbit.provider==='mean-kepler')assert.match(body.physicalModel,/平均椭圆/);
   await page.locator('#body-details-button').click();
   const facts=await page.locator('#planet-facts').innerText();assert.ok(facts.includes(definitions.bodies[id].radius.label),id+' radius type');assert.doesNotMatch(facts,/NaN|undefined|physical:/);
   if(id==='io'||id==='europa'){
    assert.ok(facts.includes('公转周期 · 约'),id+' catalog period label');
    assert.ok(facts.includes(id==='io'?'1.77':'3.55'),id+' NASA nominal period');
   }
   const layout=await page.locator('#planet-facts').evaluate(e=>{const parent=e.closest('#planet-info-content'),r=parent.getBoundingClientRect();return{overflow:parent.scrollWidth-parent.clientWidth,cols:[...e.children].map(n=>{const b=n.getBoundingClientRect();return{x:b.x,w:b.width,right:r.right,left:r.left};})};});
   assert.ok(layout.overflow<=1,`${name} ${id} horizontal overflow ${layout.overflow}`);
   for(const r of layout.cols)assert.ok(r.x>=r.left-1&&r.x+r.w<=r.right+1,`${name} ${id} fact column outside panel`);
   if(['haumea','hiiaka','earth'].includes(id))await page.screenshot({path:`${out}/${name}-${id}-facts.png`});
   await page.keyboard.press('Escape');assert.equal(await page.locator('#body-details-button').evaluate(e=>e===document.activeElement),true);
   if(['haumea','hiiaka','nereid'].includes(id)){
    await page.locator('#surface-button').click();await settle();
    const canvas=page.locator('#universe canvas');const image=await canvas.screenshot();
    const {data}=await sharp(image).resize(120,80).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.ok([...data].filter(v=>v>20).length>100,'blank observation canvas');
    await page.screenshot({path:`${out}/${name}-${id}-view.png`});
   }
   checks.push({id,radiusKm:body.radiusKm,facts,layout});
  }
  for(const path of ['/solar-system/BODY_MODELS.md','/solar-system/GROUND_AUDIT.md','/solar-system/physical-definitions.json']){
   const response=await page.request.get(base+path);assert.equal(response.status(),200,path);assert.doesNotMatch(await response.text(),/<!doctype html>/i,path+' is an HTML fallback');
  }
  assert.deepEqual(errors,[]);report.push({name,width,height,dpr,checks,errors});await context.close();console.log(name,'definitions passed');
 }
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
}finally{await browser.close();}
