import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
const output=new URL('../test-results/orion-quality/',import.meta.url);
await mkdir(output,{recursive:true});
const report=[];
for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 const modes=[];
 for(const mode of ['high','low','smooth','minimal']){
  // A fresh process prevents context accumulation or queued GPU work in one
  // preset from contaminating the next. Benchmark the production build.
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
   const context=await browser.newContext({viewport,deviceScaleFactor:1});
   const page=await context.newPage();
   await page.addInitScript(mode=>{
    sessionStorage.setItem('space-atlas:scene:orion-nebula',JSON.stringify({version:1,value:{version:4,quality:mode,cruise:true,cruiseTime:0}}));
    const glClear=WebGL2RenderingContext.prototype.clear,glDraw=WebGL2RenderingContext.prototype.drawArrays;
    const starts=new WeakMap();
    window.completedRenderTimes=[];
    WebGL2RenderingContext.prototype.clear=function(...args){
     if(this.canvas.id==='universe')starts.set(this,performance.now());
     return glClear.apply(this,args);
    };
    WebGL2RenderingContext.prototype.drawArrays=function(...args){
     const result=glDraw.apply(this,args),start=starts.get(this);
     if(start!==undefined&&args[0]===this.POINTS){
      // A completion fence prevents asynchronous software/GPU queues from
      // reporting deceptively high FPS. This is render+fence wall time,
      // not a claim of GPU-only time or ordinary display refresh rate.
      this.finish();window.completedRenderTimes.push(performance.now()-start);starts.delete(this);
     }
     return result;
    };
   },mode);
   await page.goto(base+'/orion-nebula/',{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForFunction(()=>window.orionAtlas?.snapshot().ready&&window.completedRenderTimes.length>=6,null,{timeout:120000});
   const measured=await page.evaluate(()=>{
    const gl=document.getElementById('universe').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {state:window.orionAtlas.snapshot(),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),samples:window.completedRenderTimes.slice(-5)};
   });
   if(measured.state.currentQuality!==mode)throw new Error('Benchmark quality changed');
   measured.samples.sort((a,b)=>a-b);
   const result={mode,completedRenderMedianMs:measured.samples[2],samples:measured.samples,renderer:measured.renderer,rendering:measured.state.rendering,browser:browser.version()};
   modes.push(result);console.log(JSON.stringify({viewport,mode,renderer:result.renderer,completedRenderMedianMs:result.completedRenderMedianMs}));
  }finally{await browser.close();}
 }
 report.push({viewport,modes,environment:'headless Edge; WebGL finish fence; render completion wall time, not ordinary RAF FPS or GPU-only time'});
 await writeFile(new URL('performance.json',output),JSON.stringify(report,null,2));
}
