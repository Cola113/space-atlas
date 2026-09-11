import * as THREE from 'three';
import { surfaceFrame, bodyBasis, angularDiameter, horizonAngles } from './geometry.js';
import { brightStars } from '../sky-data/bright-stars.js';
import { equatorialDirection, starAppearance } from '../sky-coordinates.js';
import { SurfaceExposure } from './SurfaceExposure.js';

const { smoothstep, clamp, degToRad } = THREE.MathUtils;
const HOURS = 3600000;
const WIND_CYCLE_HOURS = 72;

// The panorama is 100 units away. A near plane at 10 preserves enough depth
// precision to distinguish Earth's surface from its thin cloud shell at ~300.
export const surfaceCameraRange = Object.freeze({near:10, far:3000});

// Two bounded flow phases crossfade; a phase is invisible when it wraps.
// This keeps weather textures intact even decades after the landing-site epoch.
export function surfaceWindCycle(hours) {
  const phase=THREE.MathUtils.euclideanModulo(hours/WIND_CYCLE_HOURS,1);
  return [phase*WIND_CYCLE_HOURS, ((phase+.5)%1)*WIND_CYCLE_HOURS,
    smoothstep(Math.abs(phase*2-1),0,1)];
}

// Approximate disk overlap in the sky plane. This affects the observer's ground
// lighting during an eclipse, not the light illuminating the distant planets.
export function solarVisibility(frame, parentRadiusKm, parentName) {
  const sun = frame.targets.Sun, parent = frame.targets[parentName];
  if (parent.distanceKm >= sun.distanceKm) return 1;
  const r = angularDiameter(695700,sun.distanceKm)/2;
  const R = angularDiameter(parentRadiusKm,parent.distanceKm)/2;
  const d = sun.direction.angleTo(parent.direction);
  if (d >= r + R) return 1;
  if (d <= Math.abs(R-r)) return R >= r ? 0 : 1-R*R/(r*r);
  const overlap = r*r*Math.acos(clamp((d*d+r*r-R*R)/(2*d*r),-1,1))
    + R*R*Math.acos(clamp((d*d+R*R-r*r)/(2*d*R),-1,1))
    - .5*Math.sqrt(Math.max(0,(-d+r+R)*(d+r-R)*(d-r+R)*(d+r+R)));
  return clamp(1-overlap/(Math.PI*r*r),0,1);
}

export function surfaceLight(frame, site, referenceAltitude) {
  const altitude = horizonAngles(frame.targets.Sun.direction).altitude;
  const direct = smoothstep(altitude,-.3,3) * Math.max(0,Math.sin(degToRad(altitude)));
  const reference = Math.max(.05,Math.sin(degToRad(referenceAltitude)));
  const eclipse = solarVisibility(frame,site.parentRadiusKm,site.parent);
  return { altitude, eclipse, brightness:.008+clamp(direct/reference,0,1.5)*eclipse,
    stars:THREE.MathUtils.lerp(1.25,.35,smoothstep(direct*eclipse,0,.15)) };
}

export function createSurfaceSky({scene,renderer,site,parentMap,cloudMap,groundMaterial,onCatalogueError,onCatalogueReady,signal}) {
  const epoch=Date.parse(site.date), objects=new Map();
  let frame=surfaceFrame(site), stars, clouds;
  const referenceAltitude=horizonAngles(frame.targets.Sun.direction).altitude;
  const exposure=new SurfaceExposure();
  let illumination;
  const windCycle={value:new THREE.Vector3()};
  const ambient=new THREE.AmbientLight('#d4dbed',.018);
  const light=new THREE.DirectionalLight('#ffffff',2.2);
  scene.add(ambient,light);

  function makeStars(rows) {
    const positions=[],colours=[],sizes=[];
    for(const [,ra,dec,mag,bv] of rows){
      positions.push(...equatorialDirection(ra,dec).multiplyScalar(2000).toArray());
      const a=starAppearance(mag,bv);
      colours.push(...a.colour.map(x=>x*a.brightness));sizes.push(a.size);
    }
    const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
      .setAttribute('starColour',new THREE.Float32BufferAttribute(colours,3)).setAttribute('starSize',new THREE.Float32BufferAttribute(sizes,1));
    const material=new THREE.ShaderMaterial({uniforms:{pixelRatio:{value:renderer.getPixelRatio()},rotation:{value:frame.rotation.clone()},exposure:{value:.35}},
      vertexShader:`attribute vec3 starColour;attribute float starSize;uniform float pixelRatio;uniform mat3 rotation;varying vec3 vColour;
        void main(){vColour=starColour;gl_Position=projectionMatrix*modelViewMatrix*vec4(rotation*position,1.);gl_PointSize=starSize*pixelRatio;}`,
      fragmentShader:`uniform float exposure;varying vec3 vColour;
        void main(){float a=1.-smoothstep(.1,1.,length(gl_PointCoord*2.-1.));gl_FragColor=vec4(vColour*exposure,a);
        #include <colorspace_fragment>
        }`,transparent:true,depthWrite:false});
    const result=new THREE.Points(geometry,material);result.frustumCulled=false;result.renderOrder=-10;
    scene.add(result);return result;
  }
  function windMaterial(material, strength) {
    material.onBeforeCompile=shader=>{
      shader.uniforms.surfaceWindCycle=windCycle;
      shader.fragmentShader=`uniform vec3 surfaceWindCycle;
        vec4 sampleSurfaceWind(sampler2D cloudMap, vec2 cloudUv, float hours) {
          cloudUv.x += hours * ${strength.toFixed(6)} * (.65 + .35*cos(cloudUv.y*18.84956));
          cloudUv.y += .0015*sin(cloudUv.x*25.1327 + hours*.12)*sin(cloudUv.y*3.14159);
          return texture2D(cloudMap,cloudUv);
        }
        `+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        #ifdef USE_MAP
          vec4 sampledDiffuseColor=mix(sampleSurfaceWind(map,vMapUv,surfaceWindCycle.x),
            sampleSurfaceWind(map,vMapUv,surfaceWindCycle.y),surfaceWindCycle.z);
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    };
    material.customProgramCacheKey=()=>`surface-wind-cycle-${strength}`;
  }
  function addGlobe(name,radiusKm,map,emissive=false) {
    const material=emissive?new THREE.MeshBasicMaterial({color:'#fff8e8'}):new THREE.MeshLambertMaterial({map,color:map?'#ffffff':'#bbbcb6'});
    const globe=new THREE.Mesh(new THREE.SphereGeometry(1,map?72:24,map?48:16),material);
    if(name==='Jupiter'&&map)windMaterial(material,.0001);
    objects.set(name,{globe,radiusKm});scene.add(globe);return globe;
  }
  parentMap.wrapS=THREE.RepeatWrapping;
  const globe=addGlobe(site.parent,site.parentRadiusKm,parentMap);
  if(cloudMap){
    cloudMap.wrapS=THREE.RepeatWrapping;
    const material=new THREE.MeshLambertMaterial({map:cloudMap,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.8});
    windMaterial(material,.0009);
    clouds=new THREE.Mesh(globe.geometry,material);clouds.scale.setScalar(1.003);globe.add(clouds);
  }
  for(const [name,radius] of [['Mercury',2439.7],['Venus',6051.8],['Earth',6371.0084],['Mars',3389.5],['Jupiter',69911],['Saturn',58232],['Uranus',25362],['Neptune',24622]])
    if(name!==site.parent)addGlobe(name,radius,null);
  if(site.id==='europa')for(const [name,radius] of [['Io',1821.6],['Ganymede',2634.1],['Callisto',2410.3]])addGlobe(name,radius,null);
  addGlobe('Sun',695700,null,true);

  // Use a camera-facing disc with a soft exposure halo; there is no atmosphere.
  const halo=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({uniforms:{visibility:{value:1}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 vUv;uniform float visibility;void main(){float r=length(vUv-.5)*2.;float a=exp(-r*7.)*(1.-smoothstep(.6,1.,r))*.22*visibility;gl_FragColor=vec4(1.,.86,.63,a);}`,
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.renderOrder=2;scene.add(halo);
  stars=makeStars(brightStars);
  fetch('/solar-system/sky/hyg-v41-mag65.json',{signal})
    .then(r=>{if(!r.ok)throw new Error('catalogue');return r.json();})
    .then(data=>{
      if(signal.aborted)return;
      const rows=Array.isArray(data)?data:data.stars;
      if(!Array.isArray(rows))throw new Error('catalogue format');
      scene.remove(stars);stars.geometry.dispose();stars.material.dispose();stars=makeStars(rows);onCatalogueReady();
    }).catch(()=>{if(!signal.aborted)onCatalogueError();});

  function update(time,camera,{resetExposure=false}={}) {
    frame=surfaceFrame(site,new Date(time));
    for(const [name,{globe,radiusKm}] of objects){
      const target=frame.targets[name];
      const distance=name==='Sun'?1200:300+400*target.distanceKm/(target.distanceKm+149597870.7);
      globe.position.copy(target.direction).multiplyScalar(distance);
      globe.scale.setScalar(distance*radiusKm/target.distanceKm);
      if(name==='Earth'||name==='Jupiter'){
        const basis=bodyBasis(name,frame.date);
        globe.setRotationFromMatrix(new THREE.Matrix4().makeBasis(frame.local(basis.prime),frame.local(basis.north),frame.local(basis.east).negate()));
      }
    }
    windCycle.value.fromArray(surfaceWindCycle((time-epoch)/HOURS));
    light.position.copy(frame.targets.Sun.direction).multiplyScalar(1e6);
    illumination=surfaceLight(frame,site,referenceAltitude);
    if(resetExposure||!exposure.value)exposure.reset(illumination);
    advanceExposure(0);
    stars.material.uniforms.rotation.value.copy(frame.rotation);
    const sun=frame.targets.Sun;
    halo.position.copy(sun.direction).multiplyScalar(1199);
    halo.scale.setScalar(1199*Math.max(.012,angularDiameter(695700,sun.distanceKm)*7));
    halo.quaternion.copy(camera.quaternion);halo.material.uniforms.visibility.value=illumination.eclipse;
    return frame;
  }
  function advanceExposure(elapsedSeconds) {
    if(!illumination)return;
    const display=exposure.update(illumination,elapsedSeconds);
    groundMaterial.uniforms.daylight.value=display.brightness;
    stars.material.uniforms.exposure.value=display.stars;
  }
  return {update,advanceExposure,faceCamera:camera=>halo.quaternion.copy(camera.quaternion)};
}
