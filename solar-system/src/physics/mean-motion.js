import { Vector3,Quaternion,Matrix4,Matrix3,Euler } from 'three';
import { Rotation_ECL_EQJ } from 'astronomy-engine';
import { physicalData } from '../physical-scale.js';
import elements from './mean-elements.json';

for(const model of Object.values(elements.bodies))Object.freeze(model);
Object.freeze(elements.bodies);
export const meanElements=Object.freeze(elements);
export const COORBITAL_SWAP_DAYS=4*365.25;
const ecliptic=new Matrix3().fromArray(Rotation_ECL_EQJ().rot.flat());
const angle=d=>d*Math.PI/180;
export function meanMotion(id,time,parent) {
  const model=elements.bodies[id], days=time.tdbDays;
  const radius=physicalData[id].orbitKm || physicalData[id].orbitAU*149597870.7;
  const north=parent && model.parent!=='sun' ? parent.orientation.north.clone() : new Vector3(0,0,1).applyMatrix3(ecliptic);
  const node=new Vector3(0,0,1).cross(north).normalize();
  if(node.lengthSq()<.5)node.set(1,0,0);
  const inclination=model.retrograde&&model.inclinationDegrees>90?180-model.inclinationDegrees:model.inclinationDegrees;
  north.applyAxisAngle(node,angle(inclination));
  const across=north.clone().cross(node);
  let phase=model.phaseAtJ2000+days/model.periodDays*Math.PI*2*(model.retrograde?-1:1),r=radius;
  let speed=Math.PI*2/(model.periodDays*86400)*(model.retrograde?-1:1),radialSpeed=0;
  if(model.coorbital){
    const p=days/COORBITAL_SWAP_DAYS*Math.PI,weight=id==='janus'?.2:-.8;
    phase=days/.69435*Math.PI*2+weight*(Math.PI+(Math.PI-.12)*Math.cos(p));
    // Qualitative horseshoe exchange; radial amplitude is explicitly enlarged.
    r=radius*(1+weight*.035*Math.sin(p));
    const exchangeRate=Math.PI/(COORBITAL_SWAP_DAYS*86400);
    speed=Math.PI*2/(.69435*86400)-weight*(Math.PI-.12)*Math.sin(p)*exchangeRate;
    radialSpeed=radius*weight*.035*Math.cos(p)*exchangeRate;
  }
  const relativeKm=node.clone().multiplyScalar(r*Math.cos(phase)).addScaledVector(across,r*Math.sin(phase));
  const relativeVelocityKmS=node.clone().multiplyScalar(radialSpeed*Math.cos(phase)-r*Math.sin(phase)*speed)
    .addScaledVector(across,radialSpeed*Math.sin(phase)+r*Math.cos(phase)*speed);
  const pole= model.parent==='sun' ? north.clone().applyAxisAngle(node,angle(model.tiltDegrees)) : north.clone();
  const base=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(node,pole.clone().cross(node),pole));
  const spin=days/model.spinDays*Math.PI*2*(model.retrograde&&!model.tumbling?-1:1);
  const turn=model.tumbling?new Quaternion().setFromEuler(new Euler(.9*Math.sin(spin*.371)+.35*Math.sin(spin*.113),.7*Math.sin(spin*.613),spin+.7*Math.sin(spin*.173)))
    :new Quaternion().setFromAxisAngle(new Vector3(0,0,1),spin%(Math.PI*2));
  const quaternion=base.multiply(turn);
  return {relativeKm,relativeVelocityKmS,orientation:{quaternion,prime:new Vector3(1,0,0).applyQuaternion(quaternion),east:new Vector3(0,1,0).applyQuaternion(quaternion),north:new Vector3(0,0,1).applyQuaternion(quaternion),
    model:'平均姿态示意',limitations:model.tumbling?'确定性翻滚示意，不预测真实混沌姿态。':'按采用周期独立自转，初始经线及未测极轴为示意。'},
    model:'平均圆轨道示意；初始相位未校准，不能预测真实方位',orbitFrame:model.orbitFrame,approximate:true};
}
