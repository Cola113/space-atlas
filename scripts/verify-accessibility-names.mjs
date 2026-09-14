import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5191',out='test-results/accessibility';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),report=[];
const roles=new Set(['button','link','checkbox','radio','switch','combobox','slider','spinbutton','textbox','searchbox','menuitem','tab']);
let page,cdp,name,stage;
async function audit(label){
 stage=label;
 const {nodes}=await cdp.send('Accessibility.getFullAXTree');
 const controls=nodes.filter(n=>!n.ignored&&roles.has(n.role?.value));
 assert.ok(controls.length,`${name}/${label}: no accessible controls`);
 const unnamed=controls.filter(n=>!n.name?.value?.trim());
 for(const n of unnamed){const {node}=await cdp.send('DOM.describeNode',{backendNodeId:n.backendDOMNodeId});n.html={tag:node.nodeName,attributes:node.attributes};}
 assert.deepEqual(unnamed,[],`${name}/${label}: unnamed controls`);
 report.push({screen:name,state:label,controls:controls.map(n=>({role:n.role.value,name:n.name.value,properties:n.properties}))});
 await writeFile(`${out}/progress.json`,JSON.stringify(report,null,2));
}
const settleSolar=()=>page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
async function openAndAudit(selector,label){await page.locator(selector).click();await audit(label);await page.keyboard.press('Escape');}
try{for(const [screen,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 name=screen;const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(1971,7,1),playing:false,selected:'earth',speed:1000,speedUnit:'realtime'}}));
  sessionStorage.setItem('space-atlas:scene:black-hole',JSON.stringify({version:1,value:{paused:true,time:24,qualityMode:'low'}}));
 });
 page=await context.newPage();cdp=await context.newCDPSession(page);
 await page.goto(base+'/solar-system/');await settleSolar();await audit('solar-earth');
 await openAndAudit('#scene-switcher','solar-navigation');
 await openAndAudit('#body-details-button','solar-earth-details');
 await openAndAudit('#display-settings summary','solar-display');
 await openAndAudit('#observation-settings summary','solar-observation');
 await openAndAudit('#time-settings summary','solar-time');
 await page.locator('#atlas-tab').click();await audit('solar-atlas');
 for(const id of ['mercury','mars','io','titan','enceladus','pluto','miranda','moon','europa']){
  if(!await page.locator('#atlas-search').isVisible())await page.locator('#atlas-tab').click();
  await page.locator('#atlas-search').fill(id);await page.locator(`.atlas-item[data-body="${id}"]`).click();await settleSolar();
  await page.locator(`[data-landing-body="${id}"]`).click();await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:60000});
  await audit('surface-'+id);await openAndAudit('.surface-info-button','surface-'+id+'-details');
  assert.equal(await page.locator('.surface-view').evaluate(e=>e.open),true,'closing details also closed the surface dialog');
  assert.equal(await page.locator('.surface-info-button').evaluate(e=>e===document.activeElement),true);
  await openAndAudit('.surface-time-toggle','surface-'+id+'-time');
  assert.equal(await page.locator('.surface-view').evaluate(e=>e.open),true,'closing time settings also closed the surface dialog');
  assert.equal(await page.locator('.surface-time-toggle').evaluate(e=>e===document.activeElement),true);
  await page.locator('.surface-exit').click();await page.waitForFunction(()=>!document.querySelector('.surface-view'));
 }
 // Native dialog close is also a public browser path (for example a close
 // request the browser does not allow canceling). It must release orbit UI.
 await page.locator('[data-landing-body="europa"]').click();await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true');
 await page.evaluate(()=>document.querySelector('.surface-view').close());
 await page.waitForFunction(()=>!document.querySelector('.surface-view'));
 assert.equal(await page.locator('#scene-switcher').isVisible(),true);
 await audit('surface-native-close-return');
 await page.goto(base+'/black-hole/');await page.waitForFunction(()=>window.observatory?.getState().ready);await audit('black-hole');
 await openAndAudit('#scene-switcher','black-hole-navigation');await openAndAudit('#views-button','black-hole-views');
 await page.locator('#settings-button').click();await audit('black-hole-settings');await page.locator('#science-button').scrollIntoViewIfNeeded();await page.locator('#science-button').click();await audit('black-hole-science');
 await page.goto(base+'/orion-nebula/');await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready);await audit('orion');
 await openAndAudit('#scene-switcher','orion-navigation');await openAndAudit('#settings-button','orion-settings');await openAndAudit('#science-button','orion-science');
 console.log(name,'computed accessibility names passed');await context.close();
}await writeFile(`${out}/report.json`,JSON.stringify({browser:browser.version(),method:'Chromium computed accessibility tree; no external screen-reader application',report},null,2));}
catch(error){await page.screenshot({path:`${out}/failure-${name}.png`});await writeFile(`${out}/failure.json`,JSON.stringify({name,stage,error:error.stack},null,2));throw error;}
finally{await browser.close();}
