import * as THREE from 'three';

// The night side of Earth, shared by the solar-system view and the landing sky.

// The day map carries no city light, so without this term the night hemisphere is simply
// black. The overview has lit it for a while; the landing sky drew Earth from the day map
// alone, which made the same world look different depending on which view you were in.
// The constants live here so the two cannot drift: the terminator band, the threshold that
// separates lit cities from dark ocean in the night texture, and the brightness.
export const EARTH_NIGHT_GLSL = /* glsl */ `
  // Fully night below this cosine, fully day above it: a soft terminator rather than a
  // hard edge, matching the scale height the atmosphere shader uses.
  float earthNightFactor(vec3 surfaceDirection, vec3 sunDirection) {
    return 1.0 - smoothstep(-.14, .10, dot(normalize(surfaceDirection), sunDirection));
  }
  // The night texture's ocean is nearly black and its cities are warm; this keeps the
  // texture's own dark areas from being added as if they were light.
  float earthCityMask(vec3 nightColor) {
    return smoothstep(.012, .12, max(nightColor.r, nightColor.g));
  }
  vec3 earthNightLights(vec3 nightColor, float night, float enabled) {
    return nightColor * earthCityMask(nightColor) * night * enabled * 1.6;
  }
`;

// Patches a Lambert globe so its dark side shows the city lights. The caller keeps the
// returned uniforms object and writes the current sun direction, in the globe's own frame,
// into `uSurfaceSun` each frame; the sphere's vertices are its normals, so the vertex shader
// can hand the fragment stage the surface direction without a second attribute.
export function patchEarthNightMaterial(material, nightTexture) {
  const uniforms = {
    uNightTexture: { value: nightTexture },
    uSurfaceSun: { value: new THREE.Vector3(0, 1, 0) },
    uNightEnabled: { value: 1 },
  };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vEarthSurface;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vEarthSurface = position;');
    shader.fragmentShader = [
      'uniform sampler2D uNightTexture;\nuniform vec3 uSurfaceSun;\nuniform float uNightEnabled;',
      'varying vec3 vEarthSurface;',
      EARTH_NIGHT_GLSL,
      shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += earthNightLights(texture2D(uNightTexture, vMapUv).rgb, earthNightFactor(vEarthSurface, uSurfaceSun), uNightEnabled);'),
    ].join('\n');
  };
  material.customProgramCacheKey = () => 'earth-night';
  material.needsUpdate = true;
  return uniforms;
}
