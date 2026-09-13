import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
const out='test-results/overview-physics';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const report=[];
const v=a=>new Vector3().fromArray(a), q=a=>new Quaternion().fromArray(a);
const local=s=>v(s.camera).sub(v(s.bodies.find(b=>b.id===s.selected).position)).applyQuaternion(q(s.bodies.find(b=>b.id===s.selected).orientation).invert()).normalize();
try{
for(const [name,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|program|GL_INVALID/.test(m.text()))errors.push(m.text());});
const snapshot=()=>page.evaluate(()=>window.solarAtlas.snapshot());
await page.goto('http://127.0.0.1:5191/solar-system/');
await page.waitForFunction(()=>window.solarAtlas?.snapshot().loading.renderedFrames>4,null,{timeout:60000});
async function select(id){await page.locator('#atlas-tab').click();await page.locator('#atlas-search').fill(id);await page.locator(`.atlas-item[data-body="${id}"]`).click();await page.waitForFunction(id=>{const s=window.solarAtlas.snapshot();return s.selected===id&&!s.ephemeris.blocked&&!s.flight&&s.bodies.find(b=>b.id===id).detailReady;},id,{timeout:60000});}
await select('earth');
const a=await snapshot();await page.locator('#rotation-toggle').click();await page.waitForTimeout(120);const b=await snapshot();assert.ok(v(a.camera).distanceTo(v(b.camera))<1e-8,'enable jumped');
const bounds=await page.locator('#rotation-toggle').boundingBox();assert.ok(bounds.width>=44&&bounds.height>=44&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,JSON.stringify(bounds));
await page.locator('#play-toggle').click();await page.waitForTimeout(400);const c=await snapshot();await page.waitForTimeout(1200);const d=await snapshot();
assert.ok(c.followActive&&d.followActive);assert.ok(local(c).distanceTo(local(d))<1e-5,'camera slips across surface');
assert.ok(q(c.bodies.find(x=>x.id==='earth').orientation).angleTo(q(d.bodies.find(x=>x.id==='earth').orientation))>.0001,'model stopped spinning');
await page.locator('#play-toggle').click();await page.locator('#rotation-toggle').click();const e=await snapshot();assert.ok(!e.followRotation);
for(const id of ['saturn','enceladus','miranda','charon'])await select(id);
await page.screenshot({path:`${out}/${name}.png`});assert.deepEqual(errors,[]);
report.push({name,bounds,followLocalDrift:local(c).distanceTo(local(d)),date:d.date,ephemeris:(await snapshot()).ephemeris,errors});await context.close();console.log(name,'passed');
}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
}finally{await browser.close();}
