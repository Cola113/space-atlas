import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';

const base=process.env.ATLAS_URL||'http://127.0.0.1:5191',out='test-results/black-hole-controls';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),report=[];
let page,name,cdp;
const direct=['#scene-switcher','#settings-button','#home-button','#views-button','#cruise-button','#pause-button','#speed-button','#capture-button','#zoom-in','#zoom-out'];
const snap=()=>page.evaluate(()=>window.observatory.getState());
const settled=()=>page.waitForFunction(()=>window.observatory?.getState().ready&&!window.observatory.getState().transitioning,null,{timeout:30000});
const focused=selector=>page.locator(selector).evaluate(e=>e===document.activeElement);
async function control(selector,scroll=false){
 const element=page.locator(selector);if(scroll)await element.scrollIntoViewIfNeeded();
 const rect=await element.boundingBox(),v=page.viewportSize();
 assert.ok(rect&&rect.width>=43.9&&rect.height>=43.9,`${name}: small ${selector} ${JSON.stringify(rect)}`);
 assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=v.width+.1&&rect.y+rect.height<=v.height+.1,`${name}: offscreen ${selector}`);
 const hit=await element.evaluate(e=>{const r=e.getBoundingClientRect();return [[.5,.5],[.12,.15],[.88,.85]].every(([x,y])=>{const h=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return h===e||e.contains(h);});});
 assert.ok(hit,`${name}: covered ${selector}`);
 const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
 const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
 const ax=nodes.find(n=>!n.ignored);
 assert.ok(ax?.name?.value?.trim(),`${name}: missing computed accessibility name ${selector}`);
 const visible=await page.evaluate(()=>[...document.querySelectorAll('#interface button,#interface input,#interface select,#interface a,#scene-switcher')].flatMap(e=>{
  const r=e.getBoundingClientRect();if(!r.width||!r.height||e.closest('[hidden]'))return [];
  const clip=e.closest('.panel-content,.view-options')?.getBoundingClientRect();
  if(clip&&(r.top<clip.top||r.bottom>clip.bottom))return [];
  if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)return [];
  return [{selector:e.id||e.getAttribute('data-view')||e.textContent.slice(0,24),x:r.x,y:r.y,width:r.width,height:r.height}];
 }));gaps(visible);
 return {selector,...rect,role:ax.role.value,name:ax.name.value};
}
function gaps(rects){for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
 const a=rects[i],b=rects[j],dx=Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width),dy=Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height);
 assert.ok(Math.hypot(dx,dy)>=7.9,`${name}: gap ${a.selector}/${b.selector} ${dx},${dy}`);
}}
async function directLayout(){const rects=[];for(const s of direct)rects.push(await control(s));gaps(rects);return rects;}
async function panelBounds(selector){
 const p=await page.locator(selector).boundingBox(),dock=await page.locator('.dock').boundingBox(),header=await page.locator('.topbar').boundingBox();
 assert.ok(p&&p.y>=header.y+header.height+7.9&&p.y+p.height<=dock.y-7.9,`${name}: panel obscures toolbar ${selector}`);
 assert.equal(await page.locator(selector).evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`${name}: panel horizontal overflow`);
}
async function capture(selector,filename,expected){
 const before=await snap(),download=page.waitForEvent('download',{timeout:60000});
 await page.locator(selector).click();const d=await download;await d.saveAs(`${out}/${name}-${filename}.png`);
 const meta=await sharp(`${out}/${name}-${filename}.png`).metadata();
 if(expected)assert.deepEqual([meta.width,meta.height],expected);
 const pixels=await sharp(`${out}/${name}-${filename}.png`).resize(96,64).removeAlpha().raw().toBuffer();
 assert.ok([...pixels].filter(v=>v>25).length>90,`${name}: blank export`);
 assert.match(await page.locator(selector==='#render-frame'?'#settings-notice':'#notice').textContent(),/已保存/);
 const after=await snap();assert.equal(after.time,before.time);
 for(const key of ['radius','polar','azimuth'])assert.ok(Math.abs(after.camera[key]-before.camera[key])<1e-10,`${name}: capture moved camera ${key}`);
 assert.deepEqual(after.camera.target,before.camera.target);assert.equal(after.qualityMode,before.qualityMode);
 assert.equal(await page.locator(selector).isDisabled(),false);
 return {width:meta.width,height:meta.height};
}

try{for(const [caseName,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 name=caseName;const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 await context.addInitScript(()=>{if(!sessionStorage.getItem('space-atlas:scene:black-hole'))sessionStorage.setItem('space-atlas:scene:black-hole',JSON.stringify({version:1,value:{paused:true,time:24,speed:1,qualityMode:'low'}}));});
 page=await context.newPage();cdp=await context.newCDPSession(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/black-hole/');await settled();
 const normal=await directLayout();await page.screenshot({path:`${out}/${name}-normal.png`});
 const views=[];
 for(const view of ['overview','edge','disk','top']){
  await page.locator('#views-button').click();await panelBounds('#views-panel');await control('#close-views');
  views.push(await control(`[data-view="${view}"]`,true));await page.locator(`[data-view="${view}"]`).click();await settled();
  assert.equal((await snap()).view,view);assert.equal(await focused('#views-button'),true);
 }
 await page.locator('#home-button').click();await settled();assert.equal((await snap()).view,'overview');
 const start=await snap();await page.locator('#zoom-in').click();await settled();const near=await snap();assert.ok(near.camera.radius<start.camera.radius);
 await page.locator('#zoom-out').click();await settled();assert.ok((await snap()).camera.radius>near.camera.radius);
 assert.equal((await snap()).time,24);
 for(const expected of [2,4,.25,.5,1]){await page.locator('#speed-button').click();assert.equal((await snap()).speed,expected);assert.match(await page.locator('#speed-button').textContent(),new RegExp(String(expected).replace('.','\\.')+'×'));}
 await page.locator('#cruise-button').click();assert.equal((await snap()).cruise,true);assert.match(await page.locator('#cruise-button').textContent(),/开/);
 await page.locator('#pause-button').click();await page.waitForTimeout(300);assert.ok((await snap()).time>24);
 await page.locator('#pause-button').click();const paused=await snap();await page.waitForTimeout(200);assert.equal((await snap()).time,paused.time);
 await page.locator('#cruise-button').click();assert.equal((await snap()).cruise,false);
 await page.locator('#universe').focus();await page.keyboard.press('c');assert.equal((await snap()).cruise,true);await page.keyboard.press('c');assert.equal((await snap()).cruise,false);
 await page.keyboard.press('Space');assert.equal((await snap()).paused,false);await page.keyboard.press('Space');assert.equal((await snap()).paused,true);
 await page.keyboard.press('2');await settled();assert.equal((await snap()).view,'edge');await page.keyboard.press('r');await settled();
 const currentCapture=await capture('#capture-button','current');
 await page.locator('#settings-button').click();await panelBounds('#settings-panel');assert.equal(await focused('#close-settings'),true);await control('#close-settings');
 await page.keyboard.press('Shift+Tab');assert.equal(await focused('#science-button'),true);await page.keyboard.press('Tab');assert.equal(await focused('#close-settings'),true);
 assert.equal(await page.locator('#close-settings').evaluate(e=>e.matches(':focus-visible')&&parseFloat(getComputedStyle(e).outlineWidth)>=2),true);
 const settings=[];
 for(const id of ['exposure','bloom','diskIntensity','stars']){
  settings.push(await control('#'+id,true));const before=Number(await page.locator('#'+id).inputValue());
  await page.locator('#'+id).focus();await page.keyboard.press('ArrowRight');const value=Number(await page.locator('#'+id).inputValue());
  assert.ok(value>before);assert.equal((await snap()).appearance[id],value);assert.equal(await page.locator('#'+id+'-value').textContent(),value.toFixed(2));
 }
 settings.push(await control('#quality',true));
 for(const mode of ['medium','high','ultra','auto','low']){await page.locator('#quality').selectOption(mode);assert.equal((await snap()).qualityMode,mode);assert.equal(await page.locator('#quality').inputValue(),mode);}
 await page.locator('#quality').focus();await page.keyboard.press('Escape');assert.equal(await focused('#settings-button'),true);
 await page.locator('#settings-button').click();await control('#capture-time',true);await page.locator('#capture-time').fill('-1');
 await control('#render-frame',true);await page.locator('#render-frame').click();assert.match(await page.locator('#settings-notice').textContent(),/请输入/);assert.equal(await focused('#capture-time'),true);assert.equal(await page.locator('#render-frame').isDisabled(),false);
 await page.locator('#capture-time').fill('24.5');await control('#capture-format',true);
 await page.locator('#capture-format').selectOption(width<height?'1080x1920':'1920x1080');await control('#render-frame',true);
 const specifiedCapture=await capture('#render-frame','specified',width<height?[1080,1920]:[1920,1080]);
 await control('#fullscreen-button',true);await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>!!document.fullscreenElement&&document.getElementById('fullscreen-button').getAttribute('aria-pressed')==='true');assert.match(await page.locator('#fullscreen-button span').textContent(),/开$/);
 await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>!document.fullscreenElement&&document.getElementById('fullscreen-button').getAttribute('aria-pressed')==='false');assert.match(await page.locator('#fullscreen-button span').textContent(),/关$/);
 await control('#science-button',true);await page.locator('#science-button').click();await panelBounds('#science-panel');await control('#close-science');
 const sources=[];for(let i=0;i<3;i++)sources.push(await control(`.source-links a:nth-of-type(${i+1})`,true));
 await page.screenshot({path:`${out}/${name}-science.png`});await page.keyboard.press('Escape');assert.equal(await focused('#science-button'),true);assert.equal(await page.locator('#settings-panel').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await focused('#settings-button'),true);
 await page.addStyleTag({content:'#app{--safe-top:20px;--safe-bottom:20px;--safe-left:24px;--safe-right:24px}'});
 const safe=await directLayout();await page.screenshot({path:`${out}/${name}-safe.png`});
 await page.locator('#views-button').click();await panelBounds('#views-panel');for(const v of ['overview','edge','disk','top'])await control(`[data-view="${v}"]`,true);
 await page.screenshot({path:`${out}/${name}-safe-views.png`});await page.locator('#close-views').click();assert.equal(await focused('#views-button'),true);
 await page.locator('#settings-button').click();await panelBounds('#settings-panel');for(const s of ['#exposure','#bloom','#diskIntensity','#stars','#quality','#capture-format','#capture-time','#render-frame','#fullscreen-button','#science-button'])await control(s,true);
 await page.screenshot({path:`${out}/${name}-safe-settings.png`});await page.keyboard.press('Escape');
 await page.locator('#scene-switcher').click();const navigation=[];
 for(const scene of ['solar-system','black-hole','orion-nebula'])navigation.push(await control(`#scene-menu a[data-scene-link="${scene}"]`,true));gaps(navigation);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');assert.equal(await focused('#scene-switcher'),true);
 const saved=await snap();await page.reload();await settled();const restored=await snap();
 for(const key of ['time','speed','paused','qualityMode'])assert.equal(restored[key],saved[key]);assert.deepEqual(restored.appearance,saved.appearance);
 assert.deepEqual(errors,[]);report.push({name,width,height,dpr,normal,views,settings,sources,safe,navigation,currentCapture,specifiedCapture,keyboard:true,panelReturnFocus:true,computedAccessibilityNames:true,errors,passed:true});
 await writeFile(`${out}/progress.json`,JSON.stringify(report,null,2));console.log(name,'black hole controls passed');await context.close();
}await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
catch(error){if(page&&!page.isClosed()){await page.screenshot({path:`${out}/failure-${name}.png`});await writeFile(`${out}/failure.json`,JSON.stringify({name,error:error.stack,state:await snap()},null,2));}throw error;}
finally{await browser.close();}
