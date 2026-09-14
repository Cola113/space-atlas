import {nativeBrowser} from './native-browser.mjs';
import assert from 'node:assert/strict';
import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191',out='test-results/orion-quality';
await mkdir(out,{recursive:true});
const native=await nativeBrowser(out),{browser,context}=native;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report=[];
try{
 await context.addInitScript(()=>{
  sessionStorage.setItem('space-atlas:scene:orion-nebula',JSON.stringify({version:1,value:{version:4,quality:'auto',cruise:true,cruiseTime:0}}));
  window.nativeVisibilityEvents=[];
  document.addEventListener('visibilitychange',event=>window.nativeVisibilityEvents.push({hidden:document.hidden,trusted:event.isTrusted,time:performance.now()}));
 });
 const page=await context.newPage(),other=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(page);
 await page.setViewportSize({width:800,height:450});
 await page.bringToFront();
 await page.goto(base+'/orion-nebula/');
 await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready&&!document.hidden,null,{timeout:30000});
 const snapshot=()=>page.evaluate(()=>({hidden:document.hidden,state:window.orionAtlas.snapshot(),ownHiddenProperty:Object.hasOwn(document,'hidden')}));
 async function background(name,hide,show){
  const before=await snapshot();
  await hide();
  await page.waitForFunction(()=>document.hidden,null,{polling:100,timeout:10000});
  const hidden=await snapshot();await wait(1600);const held=await snapshot();
  assert.equal(held.state.frames,hidden.state.frames,name+' rendered in background');
  assert.equal(held.state.cruiseTime,hidden.state.cruiseTime,name+' advanced while hidden');
  assert.equal(held.state.rendering.qualityChanges,hidden.state.rendering.qualityChanges);
  await show();
  await page.waitForFunction(()=>!document.hidden,null,{polling:100,timeout:10000});
  await wait(180);const after=await snapshot();
  assert.equal(after.state.quality,before.state.quality);
  assert.equal(after.state.currentQuality,held.state.currentQuality,'background recovery caused an immediate quality change');
  assert.equal(after.state.rendering.sampledWindows,held.state.rendering.sampledWindows,'background gap entered performance sampling');
  assert.ok(after.state.cruiseTime-held.state.cruiseTime<.4,'background return jumped the cruise');
  if(!before.state.cruise){
   assert.equal(after.state.cruiseTime,held.state.cruiseTime);
   assert.ok(after.state.frames<=held.state.frames+1);
  }
  assert.equal(after.ownHiddenProperty,false);
  report.push({name,before,hidden,held,after});
 }
 await background('native-tab-playing',()=>other.bringToFront(),()=>page.bringToFront());
 await page.locator('#cruise-button').click();await wait(180);
 await background('native-tab-paused',()=>other.bringToFront(),()=>page.bringToFront());
 const {windowId}=await cdp.send('Browser.getWindowForTarget');
 await background('native-window-minimized',
  ()=>cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}}),
  async()=>{await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await page.bringToFront();});
 await writeFile(`${out}/native-background-progress.json`,JSON.stringify({report},null,2));
 // With noDefaults, download policy/events belong to our CDP session rather
 // than Playwright's default-session download wrapper. Observe that session.
 const downloadStarted=new Promise(resolve=>native.protocol.once('Browser.downloadWillBegin',resolve));
 const downloadFinished=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Native capture download did not finish')),15000);
  native.protocol.on('Browser.downloadProgress',event=>{
   if(event.state==='completed'){clearTimeout(timer);resolve(event);}
   if(event.state==='canceled'){clearTimeout(timer);reject(new Error('Native capture canceled'));}
  });
 });
 await page.locator('#capture-button').click();
 const [download,finished]=await Promise.all([downloadStarted,downloadFinished]);
 assert.equal(download.guid,finished.guid);assert.equal(download.suggestedFilename,'orion-nebula.png');
 await copyFile(path.join(out,download.guid),`${out}/native-background-capture.png`);
 const pixels=await sharp(`${out}/native-background-capture.png`).resize(96,64).removeAlpha().raw().toBuffer();
 assert.ok([...pixels].filter(v=>v>30).length/pixels.length>.07,'capture after native resume is blank');
 const captured=await snapshot();await wait(350);assert.equal((await snapshot()).state.frames,captured.state.frames);
 const events=await page.evaluate(()=>window.nativeVisibilityEvents);
 assert.ok(events.filter(e=>e.hidden&&e.trusted).length>=3,'missing trusted native background events');
 assert.ok(events.filter(e=>!e.hidden&&e.trusted).length>=3,'missing trusted native foreground events');
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/native-background.json`,JSON.stringify({browser:browser.version(),headless:false,
  noDefaults:true,focusEmulationDisabled:true,domVisibilityOverride:false,report,events,errors},null,2));
 console.log('Native tab and minimized-window lifecycle passed; no synthetic visibility events');
}finally{await native.close();}
