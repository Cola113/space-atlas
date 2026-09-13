import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {Vector3} from 'three';
const out='test-results/overview-session';await mkdir(out,{recursive:true});
const date=Date.UTC(1900,0,1),offset=[2,3,8];const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
try{
for(const [name,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 await context.addInitScript(({date,offset})=>{if(!sessionStorage.getItem('space-atlas:scene:solar-system'))sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date,offset,selected:'earth',playing:false,speed:5000,speedUnit:'realtime',lockSpin:true,rotations:[['earth',999]]}}));},{date,offset});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5191/solar-system/');
 await page.waitForFunction(()=>window.solarAtlas?.snapshot().loading.renderedFrames>4,null,{timeout:60000});
 const s=await page.evaluate(()=>window.solarAtlas.snapshot());
 assert.equal(s.date,date);assert.equal(s.speed,5000);assert.equal(s.selected,'earth');assert.equal(s.followRotation,true);assert.equal(s.playing,false);
 const summary=page.locator('#observation-settings summary');await summary.click();
 const menuControls=await page.locator('#observation-settings-panel button,#observation-settings-panel input,#observation-settings-panel select').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {id:n.id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
 for(const control of menuControls)assert.ok(control.width>=43.9&&control.height>=43.9,JSON.stringify(control));
 const panel=await page.locator('#observation-settings-panel').boundingBox();assert.ok(panel.x>=0&&panel.y>=0&&panel.x+panel.width<=width+.1&&panel.y+panel.height<=height+.1,JSON.stringify(panel));
 await page.screenshot({path:`${out}/${name}-settings.png`});await page.keyboard.press('Escape');
 assert.equal(await summary.evaluate(e=>document.activeElement===e),true);assert.equal(await page.locator('#observation-settings').getAttribute('open'),null);
 await page.locator('#display-settings summary').click();
 const button=page.locator('#info-button');await button.scrollIntoViewIfNeeded();const bounds=await button.boundingBox();await button.click();
 await page.waitForFunction(()=>document.querySelector('#credits-dialog').open);
 assert.match(await page.locator('#physics-accuracy').textContent(),/GAST/);
 await page.screenshot({path:`${out}/${name}-calculation.png`});await page.locator('#close-credits').click();
 assert.equal(await page.locator('#display-settings summary').evaluate(e=>document.activeElement===e),true);
 assert.ok(bounds.width>=44&&bounds.height>=44&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+.1&&bounds.y+bounds.height<=height+.1,JSON.stringify(bounds));
 await page.screenshot({path:`${out}/${name}.png`});
 await page.reload();await page.waitForFunction(()=>window.solarAtlas?.snapshot().loading.renderedFrames>4,null,{timeout:60000});
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('space-atlas:scene:solar-system')).value);
 assert.equal(saved.followRotation,true);assert.equal(saved.lockSpin,undefined);assert.equal(saved.rotations,undefined);assert.equal(saved.date,date);assert.equal(saved.speed,5000);
 assert.deepEqual(errors,[]);results.push({name,date,followMigration:true,discardedRotations:true,bounds,menuControls,panel,errors});console.log(name,'migration passed');await context.close();
}
await writeFile(`${out}/report.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
