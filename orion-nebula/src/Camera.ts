import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from 'three';

export interface Pose { position:number[];target:number[] }
export const CRUISE_DURATION=96;
const positions=[
 [0,0,46],[2,1,39],[1.5,1.4,34],[-2,2.4,39],
 [-4,2,46],[0,-1,41],[3,-.5,48],[1,.8,53],
];
// Keep the closing wide shot near the opening composition so the cloud stays
// prominent on phones as well as desktop; the closed curves preserve velocity.
const targets=[
 [0,0,0],[-1.4,1.5,-3],[-1.7,1.6,-4],[-4,4,-1],
 [-4.8,5,0],[4,-2,0],[1,0,0],[0,0,0],
];
const curve=(points:number[][])=>new CatmullRomCurve3(points.map(p=>new Vector3().fromArray(p)),true,'catmullrom',.25);
const positionCurve=curve(positions),targetCurve=curve(targets);
export function cruiseTime(seconds:number){
 return Number.isFinite(seconds)?((seconds%CRUISE_DURATION)+CRUISE_DURATION)%CRUISE_DURATION:0;
}
export function sampleCruisePose(seconds:number,aspect:number):Pose{
 const t=cruiseTime(seconds)/CRUISE_DURATION;
 const position=positionCurve.getPoint(t),target=targetCurve.getPoint(t);
 const factor=Math.max(1,.85/Math.max(.2,aspect));
 position.sub(target).multiplyScalar(factor).add(target);
 return {position:position.toArray(),target:target.toArray()};
}
export const cruiseCaptions=[
 ['01 / 全景','恒星诞生的云海'],
 ['02 / 中央恒星群','年轻恒星照亮云内空腔'],
 ['02 / 中央恒星群','年轻恒星照亮云内空腔'],
 ['03 / 暗尘埃带','光与暗交汇的边缘'],
 ['03 / 暗尘埃带','光与暗交汇的边缘'],
 ['04 / 发光云壁','温暖光芒中的细丝'],
 ['05 / 外围云带','星光与云气的延伸'],
 ['06 / 全景回望','回望恒星诞生的云海'],
] as const;
export class NebulaCamera{
 readonly camera=new PerspectiveCamera(48,innerWidth/innerHeight,.03,600);
 private elapsed=0;
 private playing=true;
 private speed=matchMedia('(prefers-reduced-motion: reduce)').matches?.4:1;
 constructor(){this.apply();}
 get cruising(){return this.playing;}
 get time(){return this.elapsed;}
 get shot(){return Math.floor(this.elapsed/CRUISE_DURATION*positions.length);}
 pose():Pose{return {position:this.camera.position.toArray(),target:targetCurve.getPoint(this.elapsed/CRUISE_DURATION).toArray()};}
 toggleCruise(){this.playing=!this.playing;}
 restore(seconds:number,playing:boolean){this.elapsed=cruiseTime(seconds);this.playing=playing;this.apply();}
 resize(width:number,height:number){this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.apply();}
 update(dt:number){
  if(this.playing)this.elapsed=cruiseTime(this.elapsed+Math.max(0,Math.min(.05,dt))*this.speed);
  this.apply();
 }
 private apply(){
  const pose=sampleCruisePose(this.elapsed,this.camera.aspect);
  this.camera.position.fromArray(pose.position);this.camera.lookAt(new Vector3().fromArray(pose.target));this.camera.updateMatrixWorld();
 }
}
