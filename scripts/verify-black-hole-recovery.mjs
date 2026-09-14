import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191',out='test-results/black-hole-controls';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),report=[];
try{for(const [name,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
 await context.addInitScript(()=>{
  const fail=!sessionStorage.getItem('test:gl-failed');sessionStorage.setItem('test:gl-failed','yes');
  const get=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,...args){if(fail&&/webgl/.test(kind))return null;return get.call(this,kind,...args);};
  sessionStorage.setItem('space-atlas:scene:black-hole',JSON.stringify({version:1,value:{paused:true,time:24,qualityMode:'low'}}));
 });
 const page=await context.newPage();await page.goto(base+'/black-hole/');await page.locator('#fatal button').waitFor();
 const button=page.locator('#fatal button'),r=await button.boundingBox();
 assert.ok(r.width>=44&&r.height>=44&&r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height);
 assert.match(await button.ariaSnapshot(),/button "重新加载"/);
 assert.equal(await page.locator('#loading').isVisible(),false);await page.screenshot({path:`${out}/${name}-startup-error.png`});
 await button.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.observatory?.getState().ready,null,{timeout:30000});
 assert.equal(await page.locator('#fatal').isVisible(),false);
 const pixels=await sharp(await page.locator('#universe').screenshot()).resize(96,64).removeAlpha().raw().toBuffer();
 assert.ok([...pixels].filter(v=>v>25).length>90);
 report.push({name,width,height,dpr,errorButton:r,keyboardReload:true,restoredCanvas:true});console.log(name,'startup error recovered');await context.close();
}await writeFile(`${out}/recovery.json`,JSON.stringify(report,null,2));}finally{await browser.close();}
