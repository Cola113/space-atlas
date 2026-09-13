import { createIcons, createElement, Camera, Expand, Info, Pause, Play, SlidersHorizontal, X } from 'lucide';
import { cruiseCaptions } from './Camera';
import { QUALITY_PRESETS, type Quality, type ManualQuality } from './Quality';

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
  click('settings-button',()=>this.togglePanel('settings'));
  click('quality-button',()=>this.togglePanel('settings','quality-button'));
  click('science-button',()=>this.togglePanel('science'));
  click('fullscreen-button',()=>{void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>this.notice('当前浏览器不支持全屏'));});
  document.addEventListener('fullscreenchange',()=>{
   const button=document.getElementById('fullscreen-button')!,label=document.fullscreenElement?'退出全屏':'全屏';
   button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(Boolean(document.fullscreenElement)));
   button.querySelector('span')!.textContent=label;
  },{signal});
  for(const button of document.querySelectorAll('.close-panel'))button.addEventListener('click',()=>this.closePanel(),{signal});
  document.querySelector<HTMLSelectElement>('#quality')!.addEventListener('change',e=>this.actions.quality((e.target as HTMLSelectElement).value as Quality),{signal});
  for(const id of ['exposure','stars'] as const)document.getElementById(id)!.addEventListener('input',e=>{
   const value=Number((e.target as HTMLInputElement).value);
   document.getElementById(id+'-value')!.textContent=value.toFixed(2);this.actions[id](value);
  },{signal});
  document.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&this.active){e.preventDefault();this.closePanel();return;}
   if((e.target as HTMLElement).closest('input,select,textarea,button,a')||e.ctrlKey||e.metaKey||e.altKey)return;
   if(e.code==='Space'){e.preventDefault();this.actions.cruise();}
  },{signal});
  document.addEventListener('pointerdown',e=>{
   if(this.active&&!(e.target as HTMLElement).closest('.panel,#settings-button,#science-button,#quality-button'))this.closePanel(false);
  },{signal});
 }
 private opener='';
 private togglePanel(name:string,opener=name+'-button'){
  const open=this.active!==name;this.closePanel(false);
  if(open){
   this.active=name;document.getElementById(name+'-panel')!.hidden=false;
   this.opener=opener;
   document.getElementById(name+'-button')!.setAttribute('aria-expanded','true');
   if(name==='settings')document.getElementById('quality-button')!.setAttribute('aria-expanded','true');
   if(opener==='quality-button')document.getElementById('quality')!.focus();
   else document.getElementById(name+'-panel')!.querySelector<HTMLButtonElement>('button')!.focus();
  }
 }
 private closePanel(focus=true){
  if(!this.active)return;
  const name=this.active;this.active=null;document.getElementById(name+'-panel')!.hidden=true;
  document.getElementById(name+'-button')!.setAttribute('aria-expanded','false');
  if(name==='settings')document.getElementById('quality-button')!.setAttribute('aria-expanded','false');
  if(focus)document.getElementById(this.opener)!.focus();
 }
 sync(playing:boolean,shot:number,mode:Quality,quality:ManualQuality,fps:number){
  if(this.playing!==playing){
   this.playing=playing;
   const button=document.getElementById('cruise-button')!,label=playing?'暂停巡游':'继续巡游';
   button.setAttribute('aria-label',label);button.dataset.tip=label;
   const text=document.createElement('span');text.textContent=label;
   button.replaceChildren(createElement(playing?Pause:Play),text);
   button.setAttribute('aria-pressed',String(playing));
  }
  const caption=cruiseCaptions[shot];
  document.getElementById('live-status')!.textContent=playing?'自动巡游中':'巡游已暂停';
  document.getElementById('view-index')!.textContent=caption[0];
  document.getElementById('view-description')!.textContent=caption[1];
  const label=(mode==='auto'?'自动 · ':'')+QUALITY_PRESETS[quality].label;
  document.getElementById('quality-value')!.textContent=label;
  document.getElementById('quality-button')!.textContent='画质 · '+label;
  document.getElementById('fps-value')!.textContent=playing?(fps?fps.toFixed(0):'测量中'):'已暂停';
 }
 notice(message:string){
  const host=document.getElementById('notice')!;host.textContent=message;host.hidden=false;
  clearTimeout(this.noticeTimer);this.noticeTimer=window.setTimeout(()=>{host.hidden=true;},3500);
 }
 dispose(){this.events.abort();clearTimeout(this.noticeTimer);}
}
export interface UIActions{cruise:()=>void;capture:()=>void;quality:(value:Quality)=>void;exposure:(value:number)=>void;stars:(value:number)=>void}
