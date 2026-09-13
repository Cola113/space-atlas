import {Vector3,Matrix4,Quaternion,MathUtils} from 'three';
import {HelioVector,GeoMoon,JupiterMoons,RotationAxis} from 'astronomy-engine';
import orientationData from './ephemeris/orientation-data.js';
import {tdbSeconds,localPosition,hasEphemeris} from './ephemeris/local.js';
import {physicalData} from './physical-scale.js';
export const AU_KM=149597870.7;
const vector=v=>new Vector3(v.x,v.y,v.z),rad=MathUtils.degToRad;
export const localEphemerisBodies=new Set(['titan','enceladus','miranda','pluto','charon']);
export function physicalBasis(body,date,et=tdbSeconds(date)){
 const model=orientationData[body];let a,d,w,north;
 if(model){
  const days=et/86400,centuries=days/36525;
  const poly=(terms,t)=>terms.reduce((s,v,i)=>s+v*t**i,0);
  const angles=Array.from({length:model.angles.length/2},(_,i)=>rad(model.angles[i*2]+model.angles[i*2+1]*centuries));
  const periodic=(terms,fn)=>terms.reduce((s,v,i)=>s+v*fn(angles[i]||0),0);
  a=rad(poly(model.ra,centuries)+periodic(model.raTerms,Math.sin));d=rad(poly(model.dec,centuries)+periodic(model.decTerms,Math.cos));
  w=rad((poly(model.w,days)+periodic(model.wTerms,Math.sin))%360);north=new Vector3(Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d));
 }else {const axis=RotationAxis(body,date);a=rad(axis.ra*15);w=rad(axis.spin%360);north=vector(axis.north).normalize();}
 const node=new Vector3(-Math.sin(a),Math.cos(a),0),across=north.clone().cross(node);
 const prime=node.multiplyScalar(Math.cos(w)).addScaledVector(across,Math.sin(w));
 return {prime,north,east:north.clone().cross(prime).normalize()};
}
export function basisQuaternion(basis,rotation){
 const x=basis.prime.clone(),y=basis.north.clone(),z=basis.east.clone().negate();
 if(rotation){x.applyMatrix3(rotation);y.applyMatrix3(rotation);z.applyMatrix3(rotation);}
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));
}
let lastDate,lastLoaded,lastState;
export function physicalState(date){
 const loaded=hasEphemeris(date);
 if(lastDate===date.getTime()&&lastLoaded===loaded)return lastState;
 const states=new Map(),et=tdbSeconds(date);
 const add=(name,position,source='Astronomy Engine 2.1.19',approximate=false)=>{
  const id=name.toLowerCase();states.set(id,{id,name,position,basis:physicalBasis(name,date,et),radiusKm:physicalData[id].radiusKm,source,approximate});
 };
 add('Sun',new Vector3());
 for(const name of ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'])add(name,vector(HelioVector(name,date)));
 add('Moon',states.get('earth').position.clone().add(vector(GeoMoon(date))));
 const jovian=JupiterMoons(date);
 for(const name of ['Io','Europa','Ganymede','Callisto'])add(name,states.get('jupiter').position.clone().add(vector(jovian[name.toLowerCase()])));
 if(loaded){
  for(const [name,parent] of [['Pluto',null],['Enceladus','saturn'],['Titan','saturn'],['Miranda','uranus'],['Charon','pluto']]){
   const result=localPosition(name,date,et);const position=new Vector3().fromArray(result.position).multiplyScalar(1/AU_KM);
   if(parent)position.add(states.get(parent).position);
   add(name,position,'JPL SPK / IAU pck00011',result.approximate);
  }
 }
 lastDate=date.getTime();lastLoaded=loaded;lastState={date,tdbSeconds:et,frame:'J2000 equatorial',units:'AU',states};return lastState;
}
