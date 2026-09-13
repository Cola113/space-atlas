import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191',out='test-results/time-follow';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
const vec=a=>new Vector3().fromArray(a),quat=a=>new Quaternion().fromArray(a);
const body=s=>s.bodies.find(b=>b.id===s.selected);
const offset=s=>vec(s.camera).sub(vec(body(s).position));
const local=s=>offset(s).applyQuaternion(quat(body(s).orientation).invert()).normalize();
let page,name;
async function snap(){return page.evaluate(()=>window.solarAtlas.snapshot());}
async function settle(){await page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});}
async function select(id){await page.locator('#atlas-tab').click();await page.locator('#atlas-search').fill(id);await page.locator(`.atlas-item[data-body="${id}"]`).click();await settle();}
async function play(value){const s=await snap();if(s.playing!==value)await page.locator('#play-toggle').click();await page.waitForTimeout(100);}
async function advance(ms=500){const start=(await snap()).date;await page.waitForTimeout(ms);const s=await snap();assert.ok(s.date!==start,'date does not advance');return s;}
async function followDrift(){await page.waitForTimeout(600);const start=await snap();const end=await advance(600);const drift=local(start).distanceTo(local(end));assert.ok(drift<.002,`follow drift ${drift}`);assert.ok(quat(body(start).orientation).angleTo(quat(body(end).orientation))>1e-5,'body stopped rotating');return drift;}
async function timeMenu(){await page.locator('#time-settings-toggle').click();assert.equal(await page.locator('#time-settings').getAttribute('open'),'');}
async function verifyBounds(selector){const r=await page.locator(selector).boundingBox();const vp=page.viewportSize();assert.ok(r&&r.x>=-.1&&r.y>=-.1&&r.x+r.width<=vp.width+.1&&r.y+r.height<=vp.height+.1,`${selector} ${JSON.stringify(r)}`);return r;}
try{
for(const testCase of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 [name]=testCase;const [,width,height,dpr]=testCase;
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce',acceptDownloads:true});
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|program|GL_INVALID/.test(m.text()))errors.push(m.text());});
 await page.goto(base+'/solar-system/');await settle();await select('europa');await play(false);
 const initial=await snap();assert.equal(initial.direction,1);
 await timeMenu();await verifyBounds('#time-settings-panel');
 for(const sel of ['#time-direction','#time-speed','#time-settings-close']){await page.locator(sel).scrollIntoViewIfNeeded();const r=await verifyBounds(sel);assert.ok(r.height>=44&&r.width>=44,sel);}
 await page.locator('#time-speed').focus();await page.keyboard.press('End');assert.equal((await snap()).speed,100000);
 await page.locator('#time-direction').click();assert.equal((await snap()).direction,-1);assert.equal((await snap()).date,initial.date);
 await page.screenshot({path:`${out}/${name}-time.png`});await page.locator('#time-settings-close').click();assert.equal(await page.locator('#time-settings-toggle').evaluate(e=>document.activeElement===e),true);
 await page.locator('#rotation-toggle').click();const enabled=await snap();assert.ok(offset(initial).distanceTo(offset(enabled))<1e-8,'enable jump');
 await play(true);const before=await snap(),reversed=await advance();assert.ok(reversed.date<before.date,'reverse is forward');let drift=await followDrift();
 // Real pointer drag must select a new region and then remain attached.
 const target=body(await snap()),x=Math.max(280,Math.min(width-110,target.x)),y=Math.max(170,Math.min(height-160,target.y));
 const beforeDrag=await snap();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y+16,{steps:8});await page.mouse.up();await page.waitForTimeout(1400);
 assert.ok(local(beforeDrag).distanceTo(local(await snap()))>.02,'drag did not choose a new region');drift=Math.max(drift,await followDrift());
 await play(false);const held=await snap();await page.locator('#rotation-toggle').click();assert.ok(offset(held).distanceTo(offset(await snap()))<1e-8,'disable jump');await page.locator('#rotation-toggle').click();
 await page.locator('#observation-settings summary').click();await page.locator('#family-select').selectOption('system:jupiter');await settle();assert.equal((await snap()).system,true);assert.equal((await snap()).followActive,false);assert.equal((await snap()).followRotation,true);
 await page.locator('#observation-settings summary').click();await page.locator('#family-select').selectOption('europa');await settle();assert.equal((await snap()).followRotation,true);await play(true);drift=Math.max(drift,await followDrift());await play(false);
 const departure=await snap();await page.locator('#landing-button').click();await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:90000});
 const arrived=(await snap()).surface;assert.equal(arrived.date,departure.date);assert.equal(arrived.playing,false);assert.equal(arrived.direction,-1);assert.equal(arrived.rate,100000);assert.equal((await snap()).followActive,false);
 await page.locator('.surface-time-toggle').click();await page.locator('.surface-direction').scrollIntoViewIfNeeded();await verifyBounds('.surface-direction');
 await page.locator('.surface-direction').click();assert.equal((await snap()).surface.direction,1);assert.equal((await snap()).direction,1);assert.equal((await snap()).surface.date,departure.date);
 await page.locator('.surface-clock-close').click();assert.equal(await page.locator('.surface-time-toggle').evaluate(e=>document.activeElement===e),true);
 await page.locator('.surface-pause').click();await page.waitForTimeout(500);await page.locator('.surface-pause').click();let ground=(await snap()).surface;assert.ok(ground.date>departure.date);assert.equal((await snap()).playing,false);
 await page.locator('.surface-time-toggle').click();await page.locator('.surface-direction').click();await page.locator('.surface-clock-close').click();const forward=ground.date;
 await page.locator('.surface-pause').click();await page.waitForTimeout(500);await page.locator('.surface-pause').click();ground=(await snap()).surface;assert.ok(ground.date<forward);
 for(const zoom of [2,4,8]){await page.locator('.surface-telescope').click();assert.equal((await snap()).surface.magnification,zoom);}
 const download=page.waitForEvent('download');await page.locator('.surface-photo').click();assert.equal((await download).suggestedFilename(),'space-atlas-europa.png');await page.screenshot({path:`${out}/${name}-surface-8x.png`});
 await page.locator('.surface-exit').click();await page.waitForFunction(()=>!document.querySelector('.surface-view'));await settle();const returned=await snap();
 assert.equal(returned.date,ground.date);assert.equal(returned.direction,-1);assert.equal(returned.speed,100000);assert.equal(returned.playing,false);assert.equal(returned.followRotation,true);
 assert.ok(offset(returned).distanceTo(offset(departure))<1e-7,'return camera jump');assert.equal(await page.locator('#landing-button').evaluate(e=>document.activeElement===e),true);
 await play(true);drift=Math.max(drift,await followDrift());await play(false);const saved=await snap();await page.reload();await settle();const restored=await snap();assert.equal(restored.date,saved.date);assert.equal(restored.direction,-1);assert.equal(restored.speed,100000);assert.equal(restored.followRotation,true);assert.equal(restored.selected,'europa');
 await page.screenshot({path:`${out}/${name}-returned.png`});assert.deepEqual(errors,[]);results.push({name,dpr,drift,initialDate:initial.date,returnedDate:returned.date,passed:true,errors});await context.close();console.log(name,'passed');
}
await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:`${out}/failure-${name}.png`});await writeFile(`${out}/failure.json`,JSON.stringify({name,error:error.stack,snapshot:await snap().catch(()=>null),pageText:await page.locator("body").innerText()},null,2));}throw error;}finally{await browser.close();}
