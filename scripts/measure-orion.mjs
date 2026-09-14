import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
const output=new URL('../test-results/orion-quality/',import.meta.url);
await mkdir(output,{recursive:true});
const report=[];
const modes=(process.env.ORION_MEASURE_MODES||'minimal,smooth,low,high').split(',');
const allViewports=[{width:1440,height:900},{width:390,height:844}];
const viewports=process.env.ORION_MEASURE_SCREEN==='desktop'?allViewports.slice(0,1)
 :process.env.ORION_MEASURE_SCREEN==='phone'?allViewports.slice(1):allViewports;
for(const viewport of viewports){
 const measurements=[];
 for(const mode of modes){
  // Fresh process, paused fixed pose. No other browser benchmark may run at
  // the same time. Full readback establishes completion and checks the pixels.
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
   const context=await browser.newContext({viewport,deviceScaleFactor:viewport.width===390?3:1});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(mode=>{
    sessionStorage.setItem('space-atlas:scene:orion-nebula',JSON.stringify({version:1,value:{version:4,quality:mode,cruise:false,cruiseTime:0}}));
    const prototype=WebGL2RenderingContext.prototype;
    const clear=prototype.clear,arrays=prototype.drawArrays,elements=prototype.drawElements;
    const readback=prototype.readPixels,records=new WeakMap(),buffers=new WeakMap();
    window.completedRenderTimes=[];
    prototype.clear=function(...args){
     if(this.canvas.id==='universe'&&!records.has(this))records.set(this,{start:performance.now(),volumeDraws:0,clears:0});
     const record=records.get(this);if(record)record.clears++;
     return clear.apply(this,args);
    };
    prototype.drawElements=function(...args){
     const record=records.get(this);if(record)record.volumeDraws++;
     return elements.apply(this,args);
    };
    prototype.drawArrays=function(...args){
     const result=arrays.apply(this,args),record=records.get(this);
     if(record&&args[0]===this.POINTS){
      const width=this.drawingBufferWidth,height=this.drawingBufferHeight,length=width*height*4;
      let pixels=buffers.get(this);
      if(!pixels||pixels.length!==length){pixels=new Uint8Array(length);buffers.set(this,pixels);}
      const submitted=performance.now();
      readback.call(this,0,0,width,height,this.RGBA,this.UNSIGNED_BYTE,pixels);
      const finished=performance.now(),error=this.getError();
      let checksum=2166136261,lit=0,count=0;
      // Inspect color across the returned image: alpha alone cannot prove draw.
      for(let i=0;i<pixels.length;i+=4*127){
       for(let c=0;c<3;c++){checksum=Math.imul(checksum^pixels[i+c],16777619)>>>0;if(pixels[i+c]>30)lit++;count++;}
      }
      window.completedRenderTimes.push({totalMs:finished-record.start,submitMs:submitted-record.start,
       readbackMs:finished-submitted,volumeDraws:record.volumeDraws,clears:record.clears,
       width,height,bytes:pixels.length,checksum,litFraction:lit/count,error});
      records.delete(this);
     }
     return result;
    };
   },mode);
   await page.goto(base+'/orion-nebula/',{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready&&window.completedRenderTimes.length>=1,null,{timeout:120000});
   const start=await page.evaluate(()=>window.orionAtlas.snapshot());
   assert.equal(start.cruise,false);
   // Two warm-up redraws, then five measured redraws. Exposure changes only
   // final tone mapping; alternating it proves the readback is a new frame.
   const samples=[];
   for(let frame=0;frame<7;frame++){
    const count=await page.evaluate(exposure=>{
     const count=window.completedRenderTimes.length,input=document.getElementById('exposure');
     input.value=String(exposure);input.dispatchEvent(new Event('input',{bubbles:true}));return count;
    },frame%2?1.3:1.25);
    await page.waitForFunction(count=>window.completedRenderTimes.length>count,count,{timeout:120000});
    const sample=await page.evaluate(()=>window.completedRenderTimes.at(-1));
    assert.equal(sample.error,0);assert.equal(sample.volumeDraws,1);
    assert.ok(sample.litFraction>.07,'full readback is blank');
    assert.equal(sample.bytes,sample.width*sample.height*4);
    if(frame>=2)samples.push(sample);
   }
   const measured=await page.evaluate(()=>{
    const gl=document.getElementById('universe').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {state:window.orionAtlas.snapshot(),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
   });
   assert.equal(measured.state.currentQuality,mode);assert.equal(measured.state.quality,mode);
   assert.deepEqual(measured.state.pose,start.pose);assert.equal(measured.state.cruiseTime,start.cruiseTime);
   assert.ok(new Set(samples.map(s=>s.checksum)).size>=2,'exposure redraw returned unchanged pixels');
   assert.deepEqual(errors,[]);
   const median=[...samples].sort((a,b)=>a.totalMs-b.totalMs)[2].totalMs;
   const result={mode,completedRenderMedianMs:median,samples,renderer:measured.renderer,
    rendering:measured.state.rendering,browser:browser.version(),pose:measured.state.pose};
   measurements.push(result);
   await page.screenshot({path:fileURLToPath(new URL(`readback-${viewport.width}-${mode}.png`,output))});
   console.log(JSON.stringify({viewport,mode,renderer:result.renderer,completedRenderMedianMs:median}));
  }finally{await browser.close();}
  await writeFile(new URL('performance-readback-progress.json',output),JSON.stringify({completed:report,current:{viewport,measurements}},null,2));
 }
 report.push({viewport,dpr:viewport.width===390?3:1,modes:measurements,environment:'headless Edge; paused fixed pose; draw submission plus full RGBA pixel readback wall time. Includes readback overhead, not hardware FPS or GPU-only time.'});
 await writeFile(new URL(`performance-readback${process.env.ORION_MEASURE_SCREEN?'-'+process.env.ORION_MEASURE_SCREEN:''}.json`,output),JSON.stringify(report,null,2));
}
