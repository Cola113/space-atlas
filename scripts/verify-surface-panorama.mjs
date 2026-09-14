import {chromium} from 'playwright';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {landingSites} from '../solar-system/src/surface/geometry.js';

const out='test-results/surface-panorama',base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
await mkdir(out,{recursive:true});
const assets=[],tiles=[],files=[...new Set([...Object.values(landingSites).flatMap(s=>[s.texture,s.mobileTexture]),'/surface/moon-4k.webp'].filter(Boolean))];
for(const file of files){
 const {data,info}=await sharp('public'+file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,2*info.height,file+' is not 360×180 equirectangular');
 let top=0,bottom=255,seam=0,count=0;
 for(let x=0;x<info.width;x++){top=Math.max(top,data[x*4+3]);bottom=Math.min(bottom,data[((info.height-1)*info.width+x)*4+3]);}
 for(let y=0;y<info.height;y++){
  const a=y*info.width*4,b=(y*info.width+info.width-1)*4;
  // Transparent sky RGB is unused; compare premultiplied visible edges.
  for(let c=0;c<3;c++){seam+=Math.abs(data[a+c]*data[a+3]/255-data[b+c]*data[b+3]/255);count++;}
 }
 assert.equal(top,0,file+' has opaque zenith pixels');assert.equal(bottom,255,file+' has a hole underfoot');
 // Lossy WebP gives the two edges different quantization noise. Record the
 // difference for visual review; it is not itself a visibility threshold.
 assets.push({file,width:info.width,height:info.height,zenithAlpha:top,nadirAlpha:bottom,meanEdgeDifference:seam/count});
 if(!file.includes('-4k')){
  const input=await sharp('public'+file).resize(320,160).flatten({background:'#142333'}).png().toBuffer();
  tiles.push({input,left:(tiles.length%3)*320,top:Math.floor(tiles.length/3)*160});
 }
}
await sharp({create:{width:960,height:Math.ceil(tiles.length/3)*160,channels:3,background:'#142333'}}).composite(tiles).png().toFile(out+'/panoramas.png');
await writeFile(out+'/assets.json',JSON.stringify(assets,null,2));
const browser=await chromium.launch({channel:'msedge',headless:true}),report=[];
try{for(const [name,width,height,dpr] of [['desktop',1440,900,1],['phone',390,844,3],['tablet',800,450,2],['short',640,360,2]]){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
 await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{playing:false,date:Date.UTC(1971,7,1),speed:1000,speedUnit:'realtime'}})));
 const page=await context.newPage();await page.goto(base+'/solar-system/');await page.waitForFunction(()=>window.solarAtlas?.snapshot().ready);
 for(const id of Object.keys(landingSites)){
  await page.locator('#atlas-tab').click();await page.locator('#atlas-search').fill(id);await page.locator(`.atlas-item[data-body="${id}"]`).click();
  await page.waitForFunction(()=>{const s=window.solarAtlas.snapshot();return !s.flight&&!s.ephemeris.blocked;});
  await page.locator('#landing-button').click();await page.waitForFunction(()=>document.querySelector('.surface-view')?.dataset.ready==='true',null,{timeout:60000});
  const before=await page.evaluate(()=>window.solarAtlas.snapshot().surface);
  // Exercise the installed keyboard look handler, without altering physical
  // state, camera internals or textures. Repeated downward input reaches nadir.
  await page.locator('.surface-canvas canvas').focus();
  await page.evaluate(()=>{const e=document.activeElement;for(let n=0;n<60;n++)e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>document.querySelector('.surface-view').dataset.pitch==='-85.00');
  const image=await page.locator('.surface-canvas canvas').screenshot();
  const p=await sharp(image).resize(96,64).removeAlpha().raw().toBuffer();
  assert.ok(Math.max(...p)>10,name+'/'+id+' has no terrain below');
  assert.equal((await page.evaluate(()=>window.solarAtlas.snapshot().surface)).date,before.date);
  await page.screenshot({path:`${out}/${name}-${id}-nadir.png`});
  await page.locator('.surface-reset').click();
  if(name==='desktop'){
   await page.locator('.surface-canvas canvas').focus();
   await page.evaluate(()=>{const e=document.activeElement,h=Number(document.querySelector('.surface-view').dataset.heading);for(let n=0;n<Math.round(h/3);n++)e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));});
   await page.screenshot({path:`${out}/${name}-${id}-wrap.png`});
  }
  await page.locator('.surface-exit').click();await page.waitForFunction(()=>!document.querySelector('.surface-view'));
  report.push({name,id,dpr,nadirPitch:-85,nonblank:true,datePreserved:true});
 }
 console.log(name,'nine nadir views passed');await context.close();
}await writeFile(out+'/report.json',JSON.stringify({assets,report},null,2));}finally{await browser.close();}
