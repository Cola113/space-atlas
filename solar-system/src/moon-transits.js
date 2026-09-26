import * as THREE from 'three';
import { physicalData } from './physical-scale.js';
import { physicalDefinitions } from './physics/definitions.js';

export const MOON_TRANSIT_SYSTEMS = Object.freeze({ jupiter: Object.freeze(['io', 'europa', 'ganymede', 'callisto']) });
export const MOON_TRANSIT_SLOTS = 5;
const vec = value => value instanceof THREE.Vector3 ? value.clone() : new THREE.Vector3().fromArray(value);
export function physicalAxes(id) {
  const r = physicalDefinitions.bodies[id].radius;
  const [a, b, c] = r.semiAxesKm || [r.value, r.value, r.value];
  return [a, c, b];
}
// J2000 input; geometry axes are X=prime, Y=north, Z=minus east.
export function physicalGeometryRotation(orientation) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    orientation.prime, orientation.north, orientation.east.clone().negate()));
}
export function ellipsoidRayDistance(origin, direction, axes) {
  const o = origin.toArray().map((x, i) => x / axes[i]);
  const d = direction.toArray().map((x, i) => x / axes[i]);
  const A = d.reduce((s, x) => s + x*x, 0), B = o.reduce((s, x, i) => s + x*d[i], 0);
  const C = o.reduce((s, x) => s + x*x, -1), disc = B*B-A*C;
  if (disc < 0 || A <= 0) return null;
  const near = (-B-Math.sqrt(disc))/A, far = (-B+Math.sqrt(disc))/A;
  return near > 0 ? near : far > 0 ? far : null;
}
// Cone radii are perpendicular to the solar axis, not the oblique surface footprint.
// A missed central axis can still cast a grazing penumbra, handled by the shader.
export function computeMoonTransit({ sunPositionKm, parentPositionKm, moonPositionKm,
  parentAxesKm, moonRadiusKm, sunRadiusKm, parentRotation = new THREE.Quaternion() }) {
  const sun=vec(sunPositionKm), parent=vec(parentPositionKm), moon=vec(moonPositionKm);
  const axis=moon.clone().sub(sun), sunMoonDistanceKm=axis.length();
  if (!(sunMoonDistanceKm > sunRadiusKm+moonRadiusKm)) return null;
  axis.normalize();
  if (axis.dot(parent.clone().sub(moon)) <= 0) return null;
  const inverse=parentRotation.clone().invert(), moonLocalKm=moon.sub(parent).applyQuaternion(inverse);
  const axisLocal=axis.applyQuaternion(inverse);
  const distanceToSurfaceKm=ellipsoidRayDistance(moonLocalKm,axisLocal,parentAxesKm);
  if (distanceToSurfaceKm === null) return null;
  const hitLocalKm=moonLocalKm.clone().addScaledVector(axisLocal,distanceToSurfaceKm);
  const u=Math.asin((sunRadiusKm-moonRadiusKm)/sunMoonDistanceKm), p=Math.asin((sunRadiusKm+moonRadiusKm)/sunMoonDistanceKm);
  const signedUmbraRadiusKm=moonRadiusKm/Math.cos(u)-distanceToSurfaceKm*Math.tan(u);
  const penumbraRadiusKm=moonRadiusKm/Math.cos(p)+distanceToSurfaceKm*Math.tan(p);
  const normalLocal=new THREE.Vector3(...hitLocalKm.toArray().map((x,i)=>x/parentAxesKm[i]**2)).normalize();
  return {hitLocalKm,centerGeometry:hitLocalKm.clone().divideScalar(parentAxesKm[0]),normalLocal,axisLocal,moonLocalKm,
    distanceToSurfaceKm,sunMoonDistanceKm,signedUmbraRadiusKm,umbraRadiusKm:Math.max(0,signedUmbraRadiusKm),
    penumbraRadiusKm,shadowDiameterKm:Math.max(0,signedUmbraRadiusKm)*2};
}
export function createMoonTransitUniforms() {
  return {uMoonTransitEnabled:{value:0},uMoonTransitCount:{value:0},uTransitSun:{value:new THREE.Vector4()},
    uTransitMoons:{value:Array.from({length:MOON_TRANSIT_SLOTS},()=>new THREE.Vector4())}};
}
// Angular disk overlap for a uniformly bright Sun, including annular eclipses.
export const MOON_TRANSIT_GLSL = /* glsl */ `
  uniform float uMoonTransitEnabled;
  uniform int uMoonTransitCount;
  uniform vec4 uTransitSun;
  uniform vec4 uTransitMoons[5];
  float moonDiskCoverage(float s, float m, float d) {
    if (d >= s+m) return 0.0;
    if (d <= abs(s-m)) return min(1.0,m*m/(s*s));
    float a=acos(clamp((d*d+s*s-m*m)/(2.0*d*s),-1.0,1.0));
    float b=acos(clamp((d*d+m*m-s*s)/(2.0*d*m),-1.0,1.0));
    float lens=.5*sqrt(max(0.0,(-d+s+m)*(d+s-m)*(d-s+m)*(d+s+m)));
    return clamp((s*s*a+m*m*b-lens)/(3.141592653589793*s*s),0.0,1.0);
  }
  float moonTransmission(vec3 point) {
    if (uMoonTransitEnabled < .5) return 1.0;
    vec3 toSun=uTransitSun.xyz-point;
    float sd=length(toSun);
    vec3 sr=toSun/sd;
    float sa=asin(clamp(uTransitSun.w/sd,0.0,1.0)), transmission=1.0;
    for (int i=0;i<5;i++) {
      if(i>=uMoonTransitCount) break;
      vec3 toMoon=uTransitMoons[i].xyz-point;
      float md=length(toMoon);
      vec3 mr=toMoon/md;
      float separation=atan(length(cross(sr,mr)),dot(sr,mr));
      float ma=asin(clamp(uTransitMoons[i].w/md,0.0,1.0));
      // Pixel filtering broadens only an unresolved edge, never its centre.
      float filteredSun=max(sa,.65*fwidth(separation));
      if(dot(toMoon,toSun)>0.0 && md<sd)
        transmission*=1.0-moonDiskCoverage(filteredSun,ma,separation);
    }
    return transmission;
  }
`;
export function moonTransitDirectLighting(chunk=THREE.ShaderChunk.lights_fragment_begin) {
  return chunk.replaceAll('RE_Direct( directLight,','directLight.color *= moonTransmission(vActivityPosition);\nRE_Direct( directLight,');
}
export function createMoonTransitSystem(objects) {
  const records=new Map();
  for(const [parentId,ids] of Object.entries(MOON_TRANSIT_SYSTEMS)) {
    const parent=objects.get(parentId); if(!parent)continue;
    parent.moonTransitUniforms ??= createMoonTransitUniforms();
    records.set(parentId,{parent,ids,entries:[]});
  }
  function update(frame) {
    for(const [parentId,record] of records) {
      const {parent,ids}=record,state=frame.bodies.get(parentId),u=parent.moonTransitUniforms;
      u.uMoonTransitCount.value=0;u.uMoonTransitEnabled.value=0;record.entries=[];
      for(const slot of u.uTransitMoons.value)slot.set(0,0,0,0);
      if(!state)continue;
      const axes=physicalAxes(parentId),a=axes[0],rotation=physicalGeometryRotation(state.orientation),inverse=rotation.clone().invert();
      const sun=frame.bodies.get('sun').positionKm;
      const sl=sun.clone().sub(state.positionKm).applyQuaternion(inverse).divideScalar(a);
      u.uTransitSun.value.set(sl.x,sl.y,sl.z,physicalData.sun.radiusKm/a);
      for(const id of ids) {
        const moon=frame.bodies.get(id);
        if(!moon){record.entries.push({id,available:false,geometry:null});continue;}
        const ml=moon.positionKm.clone().sub(state.positionKm).applyQuaternion(inverse).divideScalar(a);
        u.uTransitMoons.value[u.uMoonTransitCount.value++].set(ml.x,ml.y,ml.z,physicalData[id].radiusKm/a);
        const geometry=computeMoonTransit({sunPositionKm:sun,parentPositionKm:state.positionKm,moonPositionKm:moon.positionKm,
          parentAxesKm:axes,parentRotation:rotation,moonRadiusKm:physicalData[id].radiusKm,sunRadiusKm:physicalData.sun.radiusKm});
        record.entries.push({id,available:true,geometry,moonLocal:ml.toArray(),model:moon.model});
      }
      u.uMoonTransitEnabled.value=1;
    }
  }
  function setEnabled(enabled) {for(const {parent} of records.values())parent.moonTransitUniforms.uMoonTransitEnabled.value=enabled?1:0;}
  function snapshot({camera,width=0,height=0}={}) {
    return Object.fromEntries([...records].map(([parentId,{parent,entries}])=>[parentId,entries.map(e=>{
      const g=e.geometry,point=g&&camera?parent.mesh.localToWorld(g.centerGeometry.clone()).project(camera):null;
      return {id:e.id,available:e.available,active:Boolean(g),center:g?.centerGeometry.toArray()||null,
        hitLocalKm:g?.hitLocalKm.toArray()||null,umbraRadiusKm:g?.umbraRadiusKm??null,penumbraRadiusKm:g?.penumbraRadiusKm??null,
        shadowDiameterKm:g?.shadowDiameterKm??null,moonLocal:e.moonLocal||null,model:e.model||null,
        screen:point?{x:(point.x+1)*width/2,y:(1-point.y)*height/2}:null};
    })]));
  }
  return {update,setEnabled,snapshot};
}

