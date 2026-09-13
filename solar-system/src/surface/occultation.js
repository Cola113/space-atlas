import {Vector3,MathUtils} from 'three';
import {physicalData} from '../physical-scale.js';
import {physicalBasis} from '../physical-state.js';
const {clamp}=MathUtils;
export function diskVisibility(r,R,d){
 if(d>=r+R)return 1;
 if(d<=Math.abs(R-r))return R>=r?0:1-R*R/(r*r);
 const overlap=r*r*Math.acos(clamp((d*d+r*r-R*R)/(2*d*r),-1,1))+R*R*Math.acos(clamp((d*d+R*R-r*r)/(2*d*R),-1,1))-.5*Math.sqrt(Math.max(0,(-d+r+R)*(d+r-R)*(d-r+R)*(d+r+R)));
 return clamp(1-overlap/(Math.PI*r*r),0,1);
}
export function occultationVisibility(frame,parentRadiusKm,parentName){
 const sun=frame.targets.Sun,r=Math.asin(physicalData.sun.radiusKm/sun.distanceKm),occluders=[];
 for(const [name,target] of Object.entries(frame.targets)){
  if(name==='Sun'||target.distanceKm>=sun.distanceKm)continue;
  const radius=physicalData[name.toLowerCase()]?.radiusKm||(name===parentName?parentRadiusKm:0);
  if(!radius||target.distanceKm<=radius)continue;
  const R=Math.asin(radius/target.distanceKm),d=sun.direction.angleTo(target.direction);
  if(d<r+R)occluders.push({target,radius,R,d});
 }
 const saturn=frame.targets.Saturn;
 const rings=Boolean(frame.date&&frame.local&&saturn&&saturn.distanceKm<sun.distanceKm&&sun.direction.angleTo(saturn.direction)<r+Math.asin(136780/saturn.distanceKm));
 if(!rings&&occluders.length<=1)return occluders.length?diskVisibility(r,occluders[0].R,occluders[0].d):1;
 // Integrate the UNION on the solar disk; overlapping moons never darken twice.
 // Fixed equal-area samples also apply a documented coarse Saturn ring transmission.
 const normal=rings?frame.local(physicalBasis('Saturn',frame.date).north):null;
 const x=new Vector3(0,1,0);if(Math.abs(x.dot(sun.direction))>.95)x.set(1,0,0);
 x.cross(sun.direction).normalize();const y=sun.direction.clone().cross(x),ray=new Vector3();let visible=0;
 const samples=2048;
 for(let i=0;i<samples;i++){
  const rho=Math.sqrt((i+.5)/samples)*Math.tan(r),theta=i*2.399963229728653;
  ray.copy(sun.direction).addScaledVector(x,rho*Math.cos(theta)).addScaledVector(y,rho*Math.sin(theta)).normalize();
  if(occluders.some(o=>ray.dot(o.target.direction)>=Math.cos(o.R)))continue;
  let transmission=1;
  if(rings){
   const denom=ray.dot(normal),plane=saturn.direction.dot(normal)*saturn.distanceKm;
   const distance=plane/denom;
   if(Math.abs(denom)>1e-10&&distance>0&&distance<sun.distanceKm){
    const radius=ray.clone().multiplyScalar(distance).addScaledVector(saturn.direction,-saturn.distanceKm).length();
    if(radius>=74500&&radius<92000)transmission=.2;
    else if(radius>=92000&&radius<117580)transmission=.04;
    else if(radius>=122170&&radius<=136780)transmission=.25;
   }
  }
  visible+=transmission;
 }
 return visible/samples;
}
