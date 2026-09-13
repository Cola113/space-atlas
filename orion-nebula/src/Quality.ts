export const profiles = {
 high:{label:'精细',pixels:1250000,ratio:1.1,steps:176,starSteps:48,background:8220,detail:2},
 low:{label:'节能',pixels:480000,ratio:.85,steps:96,starSteps:48,background:8220,detail:2},
 lite:{label:'流畅',pixels:240000,ratio:.65,steps:48,starSteps:16,background:3000,detail:1},
 minimal:{label:'极简',pixels:100000,ratio:.5,steps:24,starSteps:8,background:1000,detail:0},
} as const;
export type Tier=keyof typeof profiles;
export type Quality='auto'|Tier;
const tiers:Tier[]=['minimal','lite','low','high'];
export const validQuality=(value:unknown):value is Quality=>value==='auto'||typeof value==='string'&&Object.hasOwn(profiles,value);
export class AdaptiveQuality {
 mode:Quality='auto';current:Tier='low';fps=60;
 private elapsed=0;private count=0;private slow=0;private fast=0;
 private ignoreUntil=0;private upgradeAfter=0;private probe:Tier|null=null;private probeMs=0;private probeFrames=0;
 readonly history:{at:number;tier:Tier;reason:string}[]=[];
 constructor(private changed:()=>void){}
 reset(now=0){this.elapsed=this.count=this.slow=this.fast=0;this.probe=null;this.ignoreUntil=now+1000;}
 set(mode:Quality,now:number){this.mode=mode;this.current=mode==='auto'?'low':mode;this.reset(now);this.upgradeAfter=now;this.changed();}
 private change(tier:Tier,now:number,reason:string){this.current=tier;this.elapsed=this.count=this.slow=this.fast=0;this.ignoreUntil=now+1000;this.history.push({at:now,tier,reason});if(this.history.length>32)this.history.shift();this.changed();}
 sample(ms:number,now:number){
  if(this.mode!=='auto'||now<this.ignoreUntil||!Number.isFinite(ms)||ms<=0)return;
  // Background and resize gaps are reset by the caller. Real long frames count.
  this.elapsed+=ms;this.count++;
  if(this.probe){this.probeMs+=ms;this.probeFrames++;}
  if(this.elapsed<1000)return;
  this.fps=1000*this.count/this.elapsed;
  const duration=this.elapsed;this.elapsed=this.count=0;
  if(this.probe){
   if(this.fps<25||this.probeMs>=3000){
    const previous=this.probe;this.probe=null;
    if(1000*this.probeFrames/this.probeMs<55){this.upgradeAfter=now+60000;this.change(previous,now,'probe-rollback');return;}
   }else return;
  }
  const index=tiers.indexOf(this.current);
  this.slow=this.fps<50?this.slow+1:0;this.fast=this.fps>=58?this.fast+duration:0;
  if(index>0&&(this.fps<25||this.slow>=2)){this.change(tiers[index-1],now,'slow');return;}
  if(index<tiers.length-1&&this.fast>=20000&&now>=this.upgradeAfter){
   const previous=this.current;this.change(tiers[index+1],now,'probe');this.probe=previous;this.probeMs=this.probeFrames=0;
  }
 }
}
