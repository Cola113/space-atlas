import {chromium} from 'playwright';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=new URL('../test-results/orion-cruise/',import.meta.url);
const base=process.env.ATLAS_URL||'http://127.0.0.1:5173';
const samples=[...Array.from({length:8},(_,shot)=>({name:'shot-'+shot,time:shot*12,shot})),
 {name:'return',time:90,shot:7},{name:'loop-before',time:95.95,shot:7},{name:'loop-after',time:96.05,shot:0}];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,isMobile:viewport.width<700,hasTouch:viewport.width<700});
  for(const {name,time,shot} of samples){
   const page=await context.newPage(),errors=[];
   await page.addInitScript(time=>sessionStorage.setItem('space-atlas:scene:orion-nebula',JSON.stringify({version:1,value:{version:4,cruiseTime:time,cruise:false}})),time);
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.goto(base+'/orion-nebula/');
   await page.waitForFunction(()=>window.orionAtlas?.snapshot().frames>5,null,{timeout:60000});
   await page.waitForFunction(()=>getComputedStyle(document.getElementById('universe')).opacity==='1');
   await page.mouse.move(0,0);
   const state=await page.evaluate(()=>window.orionAtlas.snapshot());
   assert.equal(state.shot,shot);assert.deepEqual(errors,[]);
   await page.screenshot({path:fileURLToPath(new URL(viewport.width+'-'+name+'.png',output))});
   const buffer=await page.locator('#universe').screenshot();
   const data=await sharp(buffer).resize(160,100).removeAlpha().raw().toBuffer();
   const lit=[...data].filter(v=>v>25).length/data.length;
   assert.ok(lit>.07,'Blank tour shot');report.push({viewport,name,time,shot,lit,errors});
   await page.close();
  }
  console.log(viewport.width+': all tour shots captured');
  await context.close();
 }
 await writeFile(new URL('shots.json',output),JSON.stringify(report,null,2));
}finally{await browser.close();}
