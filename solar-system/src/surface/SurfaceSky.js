import * as THREE from 'three';
import { bindPhysicalSun } from '../physical-lighting.js';
import { surfaceFrame, surfaceSunDirection, angularDiameter, horizonAngles } from './geometry.js';
import { physicalData } from '../physical-scale.js';
import { AU_KM } from '../physics/definitions.js';
import { physicalState } from '../physics/state.js';
import { brightStars } from '../sky-data/bright-stars.js';
import { equatorialDirection, starAppearance } from '../sky-coordinates.js';
import { SurfaceExposure } from './SurfaceExposure.js';
import { bindSkyDepth, skyDepthParameters } from './sky-depth.js';
import { createBodyGeometry } from '../body-geometry.js';
import { bodyModels } from '../body-models.js';
import { bodyTexturePath } from '../body-textures.js';
import { createRingSystemGeometry, ringSystemFor } from '../ring-systems.js';
import { createRingScatteringTexture, SCATTERING_ROW_BASE, shippedScatteringTable } from '../ring-multiple-scattering.js';
import { createRingSurfaceMaterial } from '../ring-photometry.js';
import { patchEarthNightMaterial } from '../earth-night.js';
import { createSaturnWeatherUniforms, patchSaturnWeather } from '../saturn-weather.js';
import { createSaturnRingShadowUniforms, patchSaturnRingShadow } from '../saturn-ring-shadow.js';
import { createVenusWeatherUniforms, patchVenusWeather } from '../venus-weather.js';
import { createNeptuneWeatherUniforms, patchNeptuneWeather } from '../neptune-weather.js';

const { smoothstep, clamp, degToRad } = THREE.MathUtils;
const HOURS = 3600000;
const WIND_CYCLE_HOURS = 72;

// Terrain stays at 100 units, compact celestial meshes at 300–1200, stars at
// 2000. Celestial fragment depth uses physical distances (see sky-depth.js).
export const surfaceCameraRange = Object.freeze({near:10, far:3000});

// Bound mesh coordinates inside the camera clip planes; physical fragment
// depth, rather than these compressed sphere centers, determines occlusion.
export const surfaceSkyDistance = distanceKm => 300 + 900 * distanceKm / (distanceKm + AU_KM);

// Two bounded flow phases crossfade; a phase is invisible when it wraps.
// This keeps weather textures intact even decades after the landing-site epoch.
export function surfaceWindCycle(hours) {
  const phase=THREE.MathUtils.euclideanModulo(hours/WIND_CYCLE_HOURS,1);
  return [phase*WIND_CYCLE_HOURS, ((phase+.5)%1)*WIND_CYCLE_HOURS,
    smoothstep(Math.abs(phase*2-1),0,1)];
}

function visibleDiskFraction(r,R,d) {
  if (d >= r + R) return 1;
  if (d <= Math.abs(R-r)) return R >= r ? 0 : 1-R*R/(r*r);
  const overlap = r*r*Math.acos(clamp((d*d+r*r-R*R)/(2*d*r),-1,1))
    + R*R*Math.acos(clamp((d*d+R*R-r*r)/(2*d*R),-1,1))
    - .5*Math.sqrt(Math.max(0,(-d+r+R)*(d+r-R)*(d-r+R)*(d+r+R)));
  return clamp(1-overlap/(Math.PI*r*r),0,1);
}

// Uniform-brightness circular disks in the angular sky plane; no limb
// darkening, atmospheric refraction or ellipsoidal limb. The local moons of a
// planetary landing can transit too. A body farther than the Sun cannot eclipse
// it. This affects ground illumination, not the target's own lighting direction.
export function solarVisibility(frame,parentRadiusKm,parentName) {
  const sun=frame.targets.Sun,r=angularDiameter(physicalData.sun.radiusKm,sun.distanceKm)/2;
  const blockers=[];
  for(const [name,target] of Object.entries(frame.targets)) {
    if(name==='Sun'||target.distanceKm>=sun.distanceKm)continue;
    const radius=target.radiusKm||(name===parentName?parentRadiusKm:0);
    if(!(radius>0))continue;
    const R=angularDiameter(radius,target.distanceKm)/2,d=sun.direction.angleTo(target.direction);
    if(d>=r+R)continue;
    const visible=visibleDiskFraction(r,R,d);
    if(visible===0)return 0;
    blockers.push({target,R,d,visible});
  }
  if(!blockers.length)return 1;
  if(blockers.length===1)return blockers[0].visible;
  // Integrate the union of disk intervals, so overlapping foreground moons
  // cannot dim the same solar area twice. Only multiple simultaneous transits
  // use this bounded quadrature; the common single-body case is analytical.
  const axis=new THREE.Vector3(Math.abs(sun.direction.y)>.9?1:0,Math.abs(sun.direction.y)>.9?0:1,0);
  const x=axis.cross(sun.direction).normalize(),y=sun.direction.clone().cross(x);
  const circles=blockers.map(({target,R,d})=>{
    const k=d>1e-12?d/Math.sin(d)/r:0;
    return {x:target.direction.dot(x)*k,y:target.direction.dot(y)*k,r:R/r};
  });
  let covered=0;
  const slices=1024,step=2/slices;
  for(let row=0;row<slices;row++) {
    const v=-1+(row+.5)*step,half=Math.sqrt(1-v*v),intervals=[];
    for(const c of circles) {
      const square=c.r*c.r-(v-c.y)**2;
      if(square<=0)continue;
      const dx=Math.sqrt(square),left=Math.max(-half,c.x-dx),right=Math.min(half,c.x+dx);
      if(right>left)intervals.push([left,right]);
    }
    intervals.sort((a,b)=>a[0]-b[0]);
    let end=-half;
    for(const [left,right] of intervals){covered+=Math.max(0,right-Math.max(end,left))*step;end=Math.max(end,right);}
  }
  return clamp(1-covered/Math.PI,0,1);
}

export function surfaceLight(frame, site, referenceAltitude) {
  const altitude = horizonAngles(frame.targets.Sun.direction).altitude;
  const direct = smoothstep(altitude,-.3,3) * Math.max(0,Math.sin(degToRad(altitude)));
  const reference = Math.max(.05,Math.sin(degToRad(referenceAltitude)));
  const eclipse = solarVisibility(frame,site.parentRadiusKm,site.parent);
  // Moonlight is a display term, not photometry: where the Moon is a resolvable
  // neighbour (the Earth viewer), a full moon high in the sky lifts the ground
  // well above the night floor, while a new moon or a lunar-set night stays
  // dark. Sites opt in through a numeric gain; every other site is unchanged.
  const moon = site.moonlight ? frame.targets.Moon : null;
  let moonlight = 0;
  if (moon) {
    const moonAltitude = horizonAngles(moon.direction).altitude;
    const up = smoothstep(moonAltitude,-.3,2) * Math.max(0,Math.sin(degToRad(moonAltitude)));
    const phase = (1 - Math.cos(moon.direction.angleTo(frame.targets.Sun.direction))) / 2;
    moonlight = up * phase * site.moonlight;
  }
  return { altitude, eclipse,
    brightness: clamp((site.nightFloor??.008) + moonlight + clamp(direct/reference,0,1.5)*eclipse, 0, 1.5),
    stars:THREE.MathUtils.lerp(1.25,.35,smoothstep(direct*eclipse+moonlight,0,.15)) };
}

// The globe outline for a body, from the same model the solar-system view builds its mesh
// from. Exported so a test can hold the landing sky to that model instead of a screenshot.
export function skyGlobeGeometry(id, detailed) {
  const sphere = new THREE.SphereGeometry(1, detailed ? 72 : 24, detailed ? 48 : 32);
  return createBodyGeometry(bodyModels[id] || {}, sphere);
}

export function createSurfaceSky({scene,renderer,site,parentMap,cloudMap,groundMaterial,onCatalogueError,onCatalogueReady,signal,provider=physicalState,initialFrame}) {
  const epoch=Date.parse(site.date), objects=new Map();
  let frame=initialFrame || surfaceFrame(site,new Date(site.date),provider), stars, clouds;
  const referenceAltitude=site.referenceSolarAltitude??horizonAngles(frame.targets.Sun.direction).altitude;
  const exposure=new SurfaceExposure();
  let illumination;
  const windCycle={value:new THREE.Vector3()};
  const depthRange={value:new THREE.Vector2()};
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
  // The shape comes from the same body model the solar-system view uses, so a flattened
  // world is flattened here too: shading these as spheres made Jupiter and Saturn round
  // discs from their own moons while the overview drew them oblate.
  const earthNight=[];  // {globe, uniforms} for every globe that shows the night side
  function addGlobe(id,name,radiusKm,map,emissive=false) {
    const material=emissive?new THREE.MeshBasicMaterial({map,color:map?'#ffffff':'#fff8e8'}):new THREE.MeshLambertMaterial({map,color:map?'#ffffff':'#bbbcb6'});
    const globe=new THREE.Mesh(skyGlobeGeometry(id,Boolean(map)),material);
    globe.name=`surface-${name}`;
    if(name==='Jupiter'&&map)windMaterial(material,.0001);
    // The same haze and polar morphology as the overview. Surface skies show the
    // representative baseline; demonstration weather events belong to the overview.
    if(id==='saturn'){
      patchSaturnRingShadow(material,createSaturnRingShadowUniforms());
      patchSaturnWeather(material,createSaturnWeatherUniforms());
    }
    if(id==='venus')patchVenusWeather(material,createVenusWeatherUniforms());
    if(id==='neptune')patchNeptuneWeather(material,createNeptuneWeatherUniforms());
    const sunlight=new THREE.Vector3();
    bindPhysicalSun(material,sunlight);
    const physicalScale={value:1};
    bindSkyDepth(material,physicalScale,depthRange);
    objects.set(name,{globe,radiusKm,sunlight,physicalScale});scene.add(globe);return globe;
  }
  // A neighbour is only worth a texture once it is more than a dot: the same key the
  // overview starts from is used, loaded here because this view owns its own sky.
  const textureLoader=new THREE.TextureLoader();
  function loadNeighbourTexture(globe,id) {
    const url=bodyTexturePath(id);
    if(!url)return;
    textureLoader.load(url,texture=>{
      if(signal.aborted){texture.dispose();return;}
      texture.colorSpace=THREE.SRGBColorSpace;
      globe.material.map=texture;
      globe.material.color.set('#ffffff');
      globe.material.needsUpdate=true;
      if(id==='earth')enableEarthNight(globe);
    },undefined,()=>{});
  }
  if(parentMap)parentMap.wrapS=THREE.RepeatWrapping;
  const globe=addGlobe(site.parent.toLowerCase(),site.parent,site.parentRadiusKm,parentMap,site.parent==='Sun');
  // The rings are the measured system, not a textured band: the same 401 regions, the same
  // span and the same slab photometry the overview uses. A Lambert annulus receives nothing
  // at grazing incidence, which is exactly how the rings look from inside the ring plane.
  let ring=null;
  if(site.parent==='Saturn'){
    const system=ringSystemFor('saturn');
    const scatteringRows=Object.values(shippedScatteringTable().systems).reduce((total,entry)=>total+2*entry.regions.length,0);
    const material=createRingSurfaceMaterial({
      scattering:createRingScatteringTexture().texture, rowBase:SCATTERING_ROW_BASE.saturn??0,
      rows:scatteringRows, phaseG:system.phaseG, lightIntensity:2.2,
    });
    bindSkyDepth(material,objects.get(site.parent).physicalScale,depthRange);
    ring=new THREE.Mesh(createRingSystemGeometry(system),material);
    ring.rotation.x=-Math.PI/2;globe.add(ring);
  }
  if(cloudMap){
    cloudMap.wrapS=THREE.RepeatWrapping;
    const material=new THREE.MeshLambertMaterial({map:cloudMap,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.8});
    windMaterial(material,.0009);
    bindPhysicalSun(material,objects.get(site.parent).sunlight);
    bindSkyDepth(material,objects.get(site.parent).physicalScale,depthRange);
    clouds=new THREE.Mesh(globe.geometry,material);clouds.scale.setScalar(1.003);globe.add(clouds);
  }
  const resolvable=target=>target&&target.angularDiameter>THREE.MathUtils.degToRad(.08);
  for(const name of ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'])
    if(name!==site.parent&&frame.targets[name]){
      const neighbour=addGlobe(name.toLowerCase(),name,frame.targets[name].radiusKm,null);
      if(resolvable(frame.targets[name]))loadNeighbourTexture(neighbour,name.toLowerCase());
    }
  for(const [name,target] of Object.entries(frame.targets)) {
    const physicalBody=frame.physical.bodies.get(target.id);
    if(!objects.has(name)&&[site.id,site.parent.toLowerCase()].includes(physicalBody.parent)){
      const neighbour=addGlobe(target.id,name,target.radiusKm,null);
      if(resolvable(target))loadNeighbourTexture(neighbour,target.id);
    }
  }
  if(site.parent!=='Sun')addGlobe('sun','Sun',physicalData.sun.radiusKm,null,true);
  // Earth's night side is lit by its own cities in the overview; without the same term the
  // landing sky drew it black, which is the one body where the two views showed different
  // worlds for a reason the user can see.
  // Only a globe that already carries its day map can take the night patch: the term is
  // sampled with the map's own coordinates, and without a map that varying does not exist.
  function enableEarthNight(globe){
    if(!globe||!globe.material.map||globe.userData.earthNight)return;
    globe.userData.earthNight=true;
    textureLoader.load('/solar-system/textures/earth_night_2016.jpg',nightMap=>{
      if(signal.aborted){nightMap.dispose();return;}
      nightMap.colorSpace=THREE.SRGBColorSpace;
      const uniforms=patchEarthNightMaterial(globe.material,nightMap);
      earthNight.push({globe,uniforms});
    },undefined,()=>{});
  }
  if(objects.has('Earth'))enableEarthNight(objects.get('Earth').globe);

  const atmosphere=site.atmosphere?new THREE.Mesh(new THREE.SphereGeometry(1800,48,32),new THREE.ShaderMaterial({
    uniforms:{sun:{value:frame.targets.Sun.direction.clone()},day:{value:1},kind:{value:{mars:1,titan:2,pluto:3,venus:4,earth:5}[site.atmosphere]},
      sunAlt:{value:horizonAngles(frame.targets.Sun.direction).altitude}},
    vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 direction;uniform vec3 sun;uniform float day;uniform float kind;uniform float sunAlt;
      void main(){vec3 d=normalize(direction);float h=exp(-max(d.y,0.)*3.);float alignment=max(0.,dot(d,sun));
        vec3 colour;float opacity;
        if(kind<1.5){colour=mix(vec3(.18,.11,.08),vec3(.53,.34,.23),h)*day;
          colour+=vec3(.16,.24,.32)*pow(alignment,90.)*day;opacity=mix(.06,.96,day);}
        else if(kind<2.5){colour=mix(vec3(.24,.11,.03),vec3(.48,.26,.09),h)*(.04+.96*day);
          colour+=vec3(.16,.095,.028)*pow(alignment,18.)*day;opacity=1.;}
        else if(kind<3.5){float haze=exp(-max(d.y,0.)*9.);
          colour=(vec3(.14,.28,.46)*haze+vec3(.18,.35,.50)*pow(alignment,16.))*day;
          opacity=clamp((.08*haze+.22*pow(alignment,16.))*day,0.,.35);}
        else if(kind<4.5){
          vec3 ochre=mix(vec3(.42,.26,.08),vec3(.64,.44,.18),exp(-max(d.y,0.)*1.5));
          colour=(ochre+vec3(.32,.25,.10)*pow(alignment,2.5))*(.02+.98*day);
          opacity=mix(.1,1.,day);
        }
        else{
          // Earth keys its sky to the Sun's altitude, not to ground brightness:
          // moonlight lifts the ground at night without painting the sky blue.
          float dayness=smoothstep(-1.,8.,sunAlt);
          float up=clamp(d.y,0.,1.);
          vec3 blue=mix(vec3(.60,.73,.88),vec3(.17,.35,.68),pow(up,.5))*dayness;
          float dusk=exp(-pow(abs(sunAlt)/6.,1.5));
          vec3 warm=(vec3(.98,.52,.20)*exp(-up*3.5)+vec3(.55,.25,.10))*pow(alignment,2.)*dusk;
          colour=blue+warm;
          opacity=clamp(1.05*dayness+.3*pow(alignment,2.)*dusk,0.,1.);
        }
        gl_FragColor=vec4(colour,opacity);
        #include <colorspace_fragment>
      }`,side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false
  })):null;
  if(atmosphere){atmosphere.renderOrder=10;scene.add(atmosphere);}
  const plume=site.activity==='ice'?new THREE.Mesh(new THREE.PlaneGeometry(155,450),new THREE.ShaderMaterial({
    uniforms:{time:{value:0},light:{value:1}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 vUv;uniform float time;uniform float light;
      void main(){float y=vUv.y,x=vUv.x;float density=0.;
        for(int i=0;i<3;i++){float p=float(i);float centre=.3+p*.18+.025*y*sin(y*9.-time+p);
          float width=.009+y*.05;density+=exp(-pow((x-centre)/width,2.))*(1.-smoothstep(.25,1.,y))*(.8+.2*sin(y*34.-time*2.+p));}
        float a=clamp(density,0.,1.)*.4*light*smoothstep(0.,.06,y);
        gl_FragColor=vec4(.77,.87,1.,a);
        #include <colorspace_fragment>
      }`,transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide
  })):null;
  if(plume){plume.position.set(-100,208,950);plume.lookAt(0,208,0);plume.renderOrder=12;scene.add(plume);}

  // Use a camera-facing disc with a soft exposure halo; there is no atmosphere.
  const halo=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({uniforms:{visibility:{value:1}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;vec3 transformed=position;\n#include <project_vertex>\n}',
    fragmentShader:`varying vec2 vUv;uniform float visibility;void main(){
      #include <logdepthbuf_fragment>
      float r=length(vUv-.5)*2.;float a=exp(-r*7.)*(1.-smoothstep(.6,1.,r))*.22*visibility;gl_FragColor=vec4(1.,.86,.63,a);}`,
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.renderOrder=2;scene.add(halo);
  bindSkyDepth(halo.material,objects.get('Sun').physicalScale,depthRange);
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
    frame=surfaceFrame(site,new Date(time),provider);
    depthRange.value.fromArray(skyDepthParameters([...objects.keys()].map(name=>frame.targets[name]).filter(Boolean)));
    for(const [name,{globe,radiusKm,sunlight,physicalScale}] of objects){
      const target=frame.targets[name];
      if(!target){globe.visible=false;continue;}
      globe.visible=true;
      sunlight.copy(surfaceSunDirection(frame,target));
      const distance=surfaceSkyDistance(target.distanceKm);
      physicalScale.value=target.distanceKm/distance;
      globe.position.copy(target.direction).multiplyScalar(distance);
      globe.scale.setScalar(distance*radiusKm/target.distanceKm);
      if(target.orientation){
        const basis=target.orientation;
        globe.setRotationFromMatrix(new THREE.Matrix4().makeBasis(frame.local(basis.prime),frame.local(basis.north),frame.local(basis.east).negate()));
      }
    }
    windCycle.value.fromArray(surfaceWindCycle((time-epoch)/HOURS));
    light.position.copy(frame.targets.Sun.direction).multiplyScalar(1e6);
    for(const entry of earthNight){
      entry.globe.updateWorldMatrix(true,false);
      entry.uniforms.uSurfaceSun.value.copy(frame.targets.Sun.direction)
        .applyMatrix3(new THREE.Matrix3().setFromMatrix4(entry.globe.matrixWorld).invert()).normalize();
    }
    if(ring){
      // The slab model wants both in the ring's own frame, in equatorial radii: the
      // vertex positions are built that way, so the shading cannot disagree with geometry.
      ring.updateWorldMatrix(true,false);
      ring.material.uniforms.uRingCamera.value.copy(ring.worldToLocal(camera.position.clone()));
      ring.material.uniforms.uRingSun.value.copy(frame.targets.Sun.direction)
        .applyMatrix3(new THREE.Matrix3().setFromMatrix4(ring.matrixWorld).invert()).normalize();
    }
    illumination=surfaceLight(frame,site,referenceAltitude);
    if(atmosphere){atmosphere.material.uniforms.sun.value.copy(frame.targets.Sun.direction);
      atmosphere.material.uniforms.sunAlt.value=illumination.altitude;}
    if(resetExposure||!exposure.value)exposure.reset(illumination);
    advanceExposure(0);
    stars.material.uniforms.rotation.value.copy(frame.rotation);
    const sun=frame.targets.Sun;
    const haloDistance=surfaceSkyDistance(sun.distanceKm)*.999;
    halo.position.copy(sun.direction).multiplyScalar(haloDistance);
    halo.scale.setScalar(haloDistance*Math.max(.012,angularDiameter(physicalData.sun.radiusKm,sun.distanceKm)*7));
    halo.quaternion.copy(camera.quaternion);halo.material.uniforms.visibility.value=illumination.eclipse;
    return frame;
  }
  function advanceExposure(elapsedSeconds) {
    if(!illumination)return;
    const display=exposure.update(illumination,elapsedSeconds);
    groundMaterial.uniforms.daylight.value=display.brightness;
    stars.material.uniforms.exposure.value=display.stars*(site.atmosphere==='mars'?1-smoothstep(display.brightness,.025,.12):1);
    if(atmosphere)atmosphere.material.uniforms.day.value=smoothstep(display.brightness,0,1);
    if(plume){plume.material.uniforms.time.value=((frame.date.getTime()-epoch)/3600000)%72;plume.material.uniforms.light.value=clamp(display.brightness,.035,1);}
    if(groundMaterial.uniforms.activityTime)groundMaterial.uniforms.activityTime.value=THREE.MathUtils.euclideanModulo((frame.date.getTime()-epoch)/1000,86400);
  }
  return {update,advanceExposure,faceCamera:camera=>halo.quaternion.copy(camera.quaternion)};
}
