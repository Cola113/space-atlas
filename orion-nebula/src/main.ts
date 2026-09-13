import './style.css';
import { NebulaRenderer } from './Renderer';
import { isQuality } from './Quality';
import { NebulaCamera } from './Camera';
import { Vector3 } from 'three';
import { NebulaUI } from './Interface';
import { mountNavigation } from '../../platform/navigation';
import { readSession, rememberScene } from '../../platform/session';
const canvas=document.querySelector<HTMLCanvasElement>('#universe')!;
let pipeline:NebulaRenderer, rig:NebulaCamera, ui:NebulaUI;
let raf=0, previous=0, ready=false, disposed=false, contextLost=false;
let detachNavigation=()=>{},detachSession=()=>{};
let uiTime=0;
const events=new AbortController();
const state=()=>({version:4,ready,disposed,mode:'cruise',cruise:rig.cruising,cruiseTime:rig.time,shot:rig.shot,pose:rig.pose(),aspect:rig.camera.aspect,quality:pipeline.quality,currentQuality:pipeline.current,exposure:pipeline.exposure,stars:pipeline.starBrightness,frames:pipeline.frames,fps:pipeline.adaptive.fps,rendering:pipeline.diagnostics(),errors:pipeline.errors});
function sync(){if(ready)ui.sync(rig.cruising,rig.shot,pipeline.quality,pipeline.current,pipeline.adaptive.fps);}
function requestRender(){if(ready&&!disposed&&!document.hidden&&!contextLost&&!raf)raf=requestAnimationFrame(frame);}
function resize(){if(!rig)return;rig.resize(innerWidth,innerHeight);pipeline.resize(innerWidth,innerHeight);previous=0;requestRender();}
function frame(now:number){
 raf=0;
 if(disposed||document.hidden||contextLost)return;
 const elapsed=previous?now-previous:0;previous=now;
 if(rig.cruising&&elapsed>0)pipeline.sample(elapsed,now);
 rig.update(Math.min(.05,elapsed/1000));pipeline.render(rig.camera);
 if(now-uiTime>450){uiTime=now;sync();}
 if(rig.cruising)requestRender();else previous=0;
}
function visibility(){cancelAnimationFrame(raf);raf=0;previous=0;pipeline.adaptive.exclude(performance.now());requestRender();}
function dispose(){if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);detachSession();detachNavigation();events.abort();ui?.dispose();pipeline?.dispose();}
function fail(error:unknown){if(disposed)return;console.error(error);document.getElementById('loading')!.hidden=true;const host=document.getElementById('fatal')!;host.hidden=false;host.textContent='星云未能加载，请检查网络与浏览器硬件加速后刷新。';dispose();}

async function capture() {
 try {
  pipeline.adaptive.exclude(performance.now());previous=0;
  pipeline.render(rig.camera);
  const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
  const ctx=output.getContext('2d')!;ctx.drawImage(canvas,0,0);
  const font=Math.max(11,Math.round(output.width/120));ctx.font=font+'px Arial';
  const text='NASA, ESA, M. Robberto (Space Telescope Science Institute/ESA) and the Hubble Space Telescope Orion Treasury Project Team';
  const words=text.split(' '),lines:string[]=[];let line='';
  for(const word of words){if(ctx.measureText(line+' '+word).width>output.width-32){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
  lines.push(line);lines.push('Orion Nebula | Illustrative 3D cloud model; reference image and star extraction credited above');
  const height=lines.length*(font+5)+20;ctx.fillStyle='#06090ce8';ctx.fillRect(0,output.height-height,output.width,height);
  ctx.fillStyle='#dae4e0';lines.forEach((value,i)=>ctx.fillText(value,16,output.height-height+font+10+i*(font+5)));
  const blob=await new Promise<Blob|null>(resolve=>output.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('Capture failed');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='orion-nebula.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  ui.notice('画面已保存');
 }catch{ui.notice('截图未能保存，请重试');}
}
async function start(){
 pipeline=new NebulaRenderer(canvas);
 rig=new NebulaCamera();
 ui=new NebulaUI({
  cruise:()=>{rig.toggleCruise();previous=0;pipeline.adaptive.exclude(performance.now());sync();requestRender();},capture:()=>{void capture();},
  quality:value=>{pipeline.setQuality(value);previous=0;sync();requestRender();},
  exposure:value=>{pipeline.exposure=value;requestRender();},stars:value=>{pipeline.starBrightness=value;requestRender();},
 });
 detachNavigation=mountNavigation('orion-nebula');resize();
 await pipeline.initialize();if(disposed)return;
 const saved=readSession<Partial<ReturnType<typeof state>>>('orion-nebula');
 if(saved){
  if(isQuality(saved.quality))pipeline.setQuality(saved.quality);
  for(const [key,id,min,max] of [['exposure','exposure',.5,2.2],['starBrightness','stars',0,1.5]] as const){
   const value=id==='stars'?saved.stars:saved.exposure;
   if(typeof value==='number'&&Number.isFinite(value)){
    pipeline[key]=Math.max(min,Math.min(max,value));
    (document.getElementById(id) as HTMLInputElement).value=String(pipeline[key]);
    document.getElementById(id+'-value')!.textContent=pipeline[key].toFixed(2);
   }
  }
  (document.getElementById('quality') as HTMLSelectElement).value=pipeline.quality;
  if(saved.version===4&&typeof saved.cruiseTime==='number'&&Number.isFinite(saved.cruiseTime))rig.restore(saved.cruiseTime,saved.cruise!==false);
 }
 ready=true;document.documentElement.dataset.sceneReady='true';document.getElementById('loading')!.hidden=true;
 detachSession=rememberScene('orion-nebula',state);
 const signal=events.signal;
 window.addEventListener('pagehide',dispose,{once:true});
 window.addEventListener('pageshow',event=>{if(event.persisted&&disposed)location.reload();});
 window.addEventListener('resize',resize,{signal});
 document.addEventListener('visibilitychange',visibility,{signal});
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(raf);raf=0;ui.notice('图形资源暂时中断，正在恢复');},{signal});
 canvas.addEventListener('webglcontextrestored',()=>location.reload(),{signal});
 (window as unknown as {orionAtlas:unknown}).orionAtlas={snapshot:state,transmission:(from:number[],to:number[])=>pipeline.transmission(new Vector3().fromArray(from),new Vector3().fromArray(to))};
 sync();pipeline.render(rig.camera);visibility();
}
void start().catch(fail);
if(import.meta.hot)import.meta.hot.dispose(dispose);
