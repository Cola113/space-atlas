import { Vector3, MathUtils, NoColorSpace, NearestFilter, RepeatWrapping, ClampToEdgeWrapping } from 'three';

// Display enhancement, not a 5-micron radiometric calibration. Finite support
// guarantees exactly zero outside this explicitly broadened reflection cone.
export const GLINT = Object.freeze({ cutoff: Math.cos(2 * Math.PI / 180), core: Math.cos(.35 * Math.PI / 180), radiance: 12 });
export function mirrorStrength(sunDirection, surfaceNormal, viewDirection, lake = 1) {
  const s = sunDirection.clone().normalize(), n = surfaceNormal.clone().normalize(), v = viewDirection.clone().normalize();
  if (!lake || n.dot(s) <= 0 || n.dot(v) <= 0) return 0;
  return lake * MathUtils.smoothstep(s.negate().reflect(n).dot(v), GLINT.cutoff, GLINT.core);
}
export function analyticMirrorNormal(sun, view) {
  return sun.clone().normalize().add(view.clone().normalize()).normalize();
}
// Independent numerical path: maximize reflected-ray alignment, then refine
// in latitude/longitude. It never constructs the bisector.
export function numericMirrorNormal(sun, view) {
  const s = sun.clone().normalize(), v = view.clone().normalize();
  let latBest = 0, lonBest = 0, best = -Infinity;
  const trial = (lat, lon) => {
    const n = geographicNormal(lat, lon);
    if (n.dot(s) <= 0 || n.dot(v) <= 0) return;
    const score = s.clone().negate().reflect(n).dot(v);
    if (score > best) { best = score; latBest = lat; lonBest = lon; }
  };
  for (let lat = -90; lat <= 90; lat += 3) for (let lon = 0; lon < 360; lon += 3) trial(lat, lon);
  for (let step = 1; step > 1e-6; step /= 4) {
    const lat = latBest, lon = lonBest;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) trial(MathUtils.clamp(lat + y * step, -90, 90), lon + x * step);
  }
  return geographicNormal(latBest, lonBest);
}
// Same body-fixed convention as orbits.js: +X prime, +Y north, -Z east.
export function geographicNormal(latitude, longitude) {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}
export function normalToLatLon(normal) {
  const n = normal.clone().normalize();
  return { latitude: Math.asin(MathUtils.clamp(n.y, -1, 1)) * 180 / Math.PI, longitude: MathUtils.euclideanModulo(Math.atan2(-n.z, n.x) * 180 / Math.PI, 360) };
}
export function latLonToUv(lat, lon) { return [MathUtils.euclideanModulo(lon / 360, 1), .5 + lat / 180]; }

export function bindTitanGlint(material, lakeMask, sunDirection) {
  if (!material || !lakeMask) return null;
  if (material.userData.titanGlint) { material.userData.titanGlint.uTitanLakeMask.value = lakeMask; return material.userData.titanGlint; }
  // A categorical mask must never interpolate into land or use colour conversion.
  lakeMask.colorSpace = NoColorSpace; lakeMask.minFilter = lakeMask.magFilter = NearestFilter;
  lakeMask.generateMipmaps = false; lakeMask.wrapS = RepeatWrapping; lakeMask.wrapT = ClampToEdgeWrapping; lakeMask.needsUpdate = true;
  const uniforms = { uTitanLakeMask: { value: lakeMask }, uTitanGlintSun: { value: sunDirection }, uTitanGlintStrength: { value: GLINT.radiance } };
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (!shader.fragmentShader.includes('#include <opaque_fragment>')) throw new Error('Titan glint shader output hook missing');
    shader.vertexShader = 'varying vec3 vTitanPosition; varying vec3 vTitanNormal; varying vec3 vTitanLocal;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `
      #include <worldpos_vertex>
      vTitanPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vTitanNormal = normalize(mat3(modelMatrix) * normal);
      vTitanLocal = position;
    `);
    shader.fragmentShader = 'uniform sampler2D uTitanLakeMask; uniform vec3 uTitanGlintSun; uniform float uTitanGlintStrength; varying vec3 vTitanPosition; varying vec3 vTitanNormal; varying vec3 vTitanLocal;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 titanN = normalize(vTitanNormal), titanS = normalize(uTitanGlintSun);
      vec3 titanV = normalize(cameraPosition - vTitanPosition);
      vec3 titanLocal = normalize(vTitanLocal);
      vec2 titanUv = vec2(fract(atan(-titanLocal.z, titanLocal.x) / 6.28318530718 + 1.0), .5 + asin(clamp(titanLocal.y,-1.0,1.0)) / 3.14159265359);
      float titanSea = step(.5, texture2D(uTitanLakeMask, titanUv).r);
      float titanMirror = 0.0;
      if (dot(titanN,titanS) > 0.0 && dot(titanN,titanV) > 0.0)
        titanMirror = smoothstep(${GLINT.cutoff}, ${GLINT.core}, dot(reflect(-titanS,titanN),titanV));
      outgoingLight += vec3(1.0,.93,.68) * titanSea * titanMirror * uTitanGlintStrength;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => key + '-titan-glint-v2';
  material.userData.titanGlint = uniforms; material.needsUpdate = true;
  return uniforms;
}
