import { createIcons, createElement, Camera, Expand, Info, Pause, Play, SlidersHorizontal, X } from 'lucide';
import { cruiseCaptions } from './Camera';
import { profiles, type Quality, type Tier } from './Quality';

export class NebulaUI{
 private events=new AbortController();
 private active:string|null=null;
 private noticeTimer=0;
 private playing:boolean|null=null;
 constructor(private actions:UIActions){createIcons({icons:{Camera,Expand,Info,Pause,Play,SlidersHorizontal,X}});this.bind();}
 private bind(){
  const signal=this.events.signal;
  const click=(id:string,fn:()=>void)=>document.getElementById(id)!.addEventListener('click',fn,{signal});
  click('cruise-button',()=>this.actions.cruise());
  click('capture-button',()=>this.actions.capture());
  click('quality-indicator',()=>this.togglePanel('settings'));
  click('settings-button',()=>this.togglePanel('settings'));
  click('science-button',()=>this.togglePanel('science'));
  click('fullscreen-button',()=>{void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>this.notice('当前浏览器不支持全屏'));});
  for(const button of document.querySelectorAll('.close-panel'))button.addEventListener('click',()=>this.closePanel(),{signal});
  document.querySelector<HTMLSelectElement>('#quality')!.addEventListener('change',e=>this.actions.quality((e.target as HTMLSelectElement).value as Quality),{signal});
  for(const id of ['exposure','stars'] as const)document.getElementById(id)!.addEventListener('input',e=>{
   const value=Number((e.target as HTMLInputElement).value);
   document.getElementById(id+'-value')!.textContent=value.toFixed(2);this.actions[id](value);
  },{signal});
  document.addEventListener('keydown',e=>{
   if((e.target as HTMLElement).closest('input,select,textarea,button,a')||e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.key==='Escape')this.closePanel();
   if(e.code==='Space'){e.preventDefault();this.actions.cruise();}
  },{signal});
  document.addEventListener('pointerdown',e=>{
   if(this.active&&!(e.target as HTMLElement).closest('.panel,#settings-button,#science-button'))this.closePanel(false);
  },{signal});
 }
 private togglePanel(name:string){
  const open=this.active!==name;this.closePanel(false);
  if(open){
   this.active=name;document.getElementById(name+'-panel')!.hidden=false;
   document.getElementById(name+'-button')!.setAttribute('aria-expanded','true');
   document.getElementById(name+'-panel')!.querySelector<HTMLButtonElement>('button')!.focus();
  }
 }
 private closePanel(focus=true){
  if(!this.active)return;
  const name=this.active;this.active=null;document.getElementById(name+'-panel')!.hidden=true;
  const button=document.getElementById(name+'-button')!;button.setAttribute('aria-expanded','false');if(focus)button.focus();
 }
 sync(playing:boolean,shot:number,quality:Tier,fps:number,mode:Quality){
  if(this.playing!==playing){
   this.playing=playing;
   const button=document.getElementById('cruise-button')!,label=playing?'暂停巡游':'继续巡游';
   button.setAttribute('aria-label',label);button.dataset.tip=label;
   button.replaceChildren(createElement(playing?Pause:Play));
  }
  const caption=cruiseCaptions[shot];
  document.getElementById('live-status')!.textContent=playing?'自动巡游中':'巡游已暂停';
  document.getElementById('view-index')!.textContent=caption[0];
  document.getElementById('view-description')!.textContent=caption[1];
  document.getElementById('quality-value')!.textContent=(mode==='auto'?'自动 · ':'')+profiles[quality].label;
  document.getElementById('quality-indicator')!.textContent=(mode==='auto'?'自动 · ':'')+profiles[quality].label;
  document.getElementById('fps-value')!.textContent=playing?fps.toFixed(0):'—';
 }
 notice(message:string){
  const host=document.getElementById('notice')!;host.textContent=message;host.hidden=false;
  clearTimeout(this.noticeTimer);this.noticeTimer=window.setTimeout(()=>{host.hidden=true;},3500);
 }
 dispose(){this.events.abort();clearTimeout(this.noticeTimer);}
}
export interface UIActions{cruise:()=>void;capture:()=>void;quality:(value:Quality)=>void;exposure:(value:number)=>void;stars:(value:number)=>void}

