import { Vector2 } from 'three';
import { bodyModels } from './body-models.js';

// Cassini-inspired morphology, not a dated weather forecast or a fluid solver.
// See BODY_MODELS.md, “土星大气与白色风暴”. All rates below are demonstration rates.
export const SATURN_STORM_LATITUDE = 35; // approximate planetocentric latitude
export const SATURN_STORM_DURATION = 36;
const polarRatio = bodyModels.saturn.shape[1];
const stormV = .5 + Math.atan(Math.tan(SATURN_STORM_LATITUDE * Math.PI / 180) / polarRatio) / Math.PI;
export function saturnStormUv(elapsed = 0, origin = .2) {
  return [((origin + elapsed * .0012) % 1 + 1) % 1, stormV];
}

export function createSaturnWeatherUniforms() {
  return {
    uSaturnTime: { value: 0 },
    uSaturnProgress: { value: -1 },
    uSaturnStorm: { value: new Vector2(...saturnStormUv()) },
  };
}

const weather = /* glsl */ `
  uniform float uSaturnTime;
  uniform float uSaturnProgress;
  uniform vec2 uSaturnStorm;
  varying vec3 vSaturnView;
  varying vec3 vSaturnNormal;
  float saturnHash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float saturnNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(mix(saturnHash(i), saturnHash(i+vec3(1,0,0)), f.x),
      mix(saturnHash(i+vec3(0,1,0)), saturnHash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(saturnHash(i+vec3(0,0,1)), saturnHash(i+vec3(1,0,1)), f.x),
      mix(saturnHash(i+vec3(0,1,1)), saturnHash(i+vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
  }
  float saturnCloud(vec3 p) {
    // Drop unresolved octaves instead of making them sparkle on small screens.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    return .66*saturnNoise(p) + .24*saturnNoise(p*2.07+8.3)*(1.0-smoothstep(.25,1.0,footprint*2.07))
      + .10*saturnNoise(p*4.13-4.1)*(1.0-smoothstep(.25,1.0,footprint*4.13));
  }
  vec3 saturnSphere(vec2 uv) {
    float longitude = uv.x*6.2831853, latitude = (uv.y-.5)*3.14159265;
    return vec3(-cos(longitude)*cos(latitude), sin(latitude), sin(longitude)*cos(latitude));
  }
  vec4 saturnMap(sampler2D image, vec2 uv) {
    uv.y=clamp(uv.y,.002,.998);
    vec2 dx=dFdx(uv), dy=dFdy(uv);
    dx.x-=floor(dx.x+.5); dy.x-=floor(dy.x+.5);
    return textureGrad(image,uv,dx,dy);
  }
  vec3 saturnAtmosphere(sampler2D image, vec2 uv) {
    float time=uSaturnTime;
    vec3 sphere=saturnSphere(uv);
    vec3 physical=normalize(sphere*vec3(1.0,${polarRatio.toFixed(9)},1.0));
    float lat=asin(clamp(physical.y,-1.0,1.0));
    float lowLat=1.0-smoothstep(1.1,1.4,abs(lat));
    // Strong eastward equatorial flow, alternating weaker jets away from it.
    float jet=.0014*exp(-pow(lat/.30,2.0))+.00065*sin(lat*26.0)+.00025*sin(lat*51.0);
    float phase=fract(time/32.0);
    vec2 ages=(vec2(phase,fract(phase+.5))-.5)*32.0;
    float blend=.5-.5*cos(phase*6.2831853);
    vec2 advected=uv-vec2(jet*time*lowLat,0);
    vec3 air=saturnSphere(advected);
    float eddy=saturnCloud(air*vec3(16,85,16));
    vec2 warp=vec2(0,eddy*.0018*lowLat);
    vec3 colour=mix(saturnMap(image,uv+warp-vec2(jet*ages.y*lowLat,0)).rgb,
      saturnMap(image,uv+warp-vec2(jet*ages.x*lowLat,0)).rgb,blend);
    float filaments=saturnCloud(air*vec3(52,210,52)+eddy*1.3);
    colour *= 1.0+lowLat*(eddy*.055+filaments*.032);

    // A stationary, rounded six-sided jet near 78 N. Only the cloud tracers flow.
    // Cartesian noise and a vanishing angular term at the pole prevent UV pinwheels.
    float r=length(physical.xz);
    float angle=atan(physical.z,-physical.x+.0000001);
    float sector=mod(angle+.5235988,1.0471976)-.5235988;
    float boundary=.199/cos(sector);
    float north=smoothstep(.94,.965,physical.y);
    float edgeDistance=r-boundary;
    float interior=(1.0-smoothstep(-.006,.008,edgeDistance))*north;
    float orbitalAngle=angle-time*(.055+.14*exp(-r*r/.003));
    vec2 polarFlow=vec2(cos(orbitalAngle),sin(orbitalAngle))*r;
    float polarCloud=saturnCloud(vec3(polarFlow*95.0,r*48.0));
    float jetCloud=saturnCloud(vec3(cos(angle-time*.13)*24.0,sin(angle-time*.13)*24.0,edgeDistance*180.0));
    float edge=exp(-pow((edgeDistance+jetCloud*.0013)/.0045,2.0))*north;
    vec3 polarBase=saturnMap(image,uv-vec2(time*(.008+.02*exp(-r*r/.003)),0)).rgb;
    vec3 polarColour=polarBase*vec3(.92,.96,.93)*(1.0+polarCloud*.105);
    colour=mix(colour,polarColour,interior*.85);
    colour*=1.0-edge*(.12+.05*jetCloud);
    float eye=exp(-pow(r/.0145,2.0))*north;
    float eyewall=exp(-pow((r-.023)/.007,2.0))*north;
    float spiral=sin(angle*3.0+r*240.0-time*.7)*smoothstep(.005,.018,r);
    colour*=1.0-eye*.53+eyewall*(.14+.065*spiral);

    // A local convective head develops into a sheared, turbulent wake. The wrapped
    // delta is continuous at the texture seam; the wake never reaches the antipode.
    if(uSaturnProgress>=0.0 && uSaturnProgress<1.0) {
      float progress=uSaturnProgress;
      float grow=smoothstep(0.0,.5,progress);
      float life=smoothstep(0.0,.10,progress)*(1.0-smoothstep(.70,1.0,progress));
      vec2 delta=uv-uSaturnStorm;
      delta.x-=floor(delta.x+.5);
      vec2 size=mix(vec2(.004,.004),vec2(.035,.026),grow);
      vec2 q=delta/size;
      float radius=length(q);
      float turn=2.6*exp(-radius*.8)-time*.16;
      vec2 rolled=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*q;
      float billow=saturnCloud(vec3(rolled*3.8,progress*2.0));
      float head=(1.0-smoothstep(.6,1.45,radius+billow*.22));
      float wakeLength=mix(.012,.28,grow);
      float wakeX=-delta.x;
      float wakeY=delta.y-.008*sin(wakeX*55.0-time*.18)*smoothstep(0.0,.03,wakeX);
      float wakeWidth=mix(.005,.017,grow)*(1.0-.6*clamp(wakeX/wakeLength,0.0,1.0));
      float curls=saturnCloud(vec3(wakeX*95.0,wakeY*240.0,time*.045));
      float wake=smoothstep(-.005,.015,wakeX)*(1.0-smoothstep(wakeLength*.65,wakeLength,wakeX))
        *exp(-pow(wakeY/wakeWidth+curls*.42,2.0));
      float cloud=max(head*(.72+.24*billow),wake*(.50+.24*curls));
      colour=mix(colour,vec3(.84,.81,.71)*(1.0+billow*.09),cloud*life*.80);
    }
    // A slant-path haze approximation at the cloud tops. It remains in the albedo
    // path so real sunlight and ring shadows darken ALL layers, including the limb.
    // No emissive rim, inflated spherical shell, or view-dependent night-side glow.
    float mu=abs(dot(normalize(vSaturnNormal),normalize(vSaturnView)));
    float haze=1.0-exp(-.035/max(mu,.09));
    float luminance=dot(colour,vec3(.2126,.7152,.0722));
    return mix(colour,vec3(1.04,1.00,.89)*luminance,haze);
  }
`;

// Compose with existing illumination, ring occlusion, and landing-sky depth hooks.
export function patchSaturnWeather(material, uniforms) {
  const previous=material.onBeforeCompile, key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer) {
    previous.call(this,shader,renderer);
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 vSaturnView; varying vec3 vSaturnNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vSaturnView=-(modelViewMatrix*vec4(position,1.0)).xyz;
      vSaturnNormal=normalMatrix*normal;`);
    shader.fragmentShader=weather+'\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #ifdef USE_MAP
        diffuseColor.rgb *= saturnAtmosphere(map,vMapUv);
      #endif`);
  };
  material.customProgramCacheKey=()=>key+'-saturn-weather-v1';
  material.needsUpdate=true;
}
