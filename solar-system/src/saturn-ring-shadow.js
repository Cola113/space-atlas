import * as THREE from 'three';
import { createRingOpticalDepthTexture, RING_INNER, RING_OUTER } from './ring-optical-depth.js';
import { bodyModels } from './body-models.js';

export const saturnShadowFunctions = /* glsl */ `
  varying mat3 vActivityViewToLocal;
  float ringOpticalDepth(float radiusUv, float footprint) {
    float edge = max(footprint, .001);
    float mask = smoothstep(-edge, edge, radiusUv)
      * (1.0 - smoothstep(1.0-edge, 1.0+edge, radiusUv));
    return textureGrad(uRingOpticalDepth, vec2(clamp(radiusUv,0.0,1.0),.5),
      vec2(footprint,0.0), vec2(0.0)).r * mask;
  }
  float ringSurgeAmplitude(float radiusUv) {
    return texture2D(uRingOpticalDepth, vec2(clamp(radiusUv,0.0,1.0),.5)).b;
  }
  // Transmission through a particle slab: exp(-tau/mu), with mu the cosine between
  // the ray and the ring normal. Grazing rays cross more material, so the ring goes
  // opaque near the ring-plane crossings instead of keeping its face-on opacity.
  float ringRayTransmission(vec3 p, vec3 lightDirection, float angularWidth) {
    float safeY = (lightDirection.y < 0.0 ? -1.0 : 1.0) * max(abs(lightDirection.y),.0001);
    float travel = -p.y / safeY;
    vec2 intersection = (p + lightDirection * travel).xz;
    float ringRadius = length(intersection);
    float span = max(uRingSpan.y - uRingSpan.x, .0001);
    float ringUv = (ringRadius - uRingSpan.x) / span;
    float radialDerivative = abs(dot(intersection, lightDirection.xz))
      / max(ringRadius * length(lightDirection.xz), .0001);
    float sourceFootprint = abs(p.y) * radialDerivative * angularWidth / (safeY * safeY * span);
    float footprint = clamp(max(fwidth(ringUv), sourceFootprint), .001, .5);
    float tau = ringOpticalDepth(ringUv, footprint);
    // |lightDirection.y| is the cosine between the ray and the ring normal.
    float mu = clamp(abs(lightDirection.y), .001, 1.0);
    return travel > .0001 ? exp(-tau / mu) : 1.0;
  }
  float ringTransmission(vec3 p, vec3 lightDirection) {
    if (uShadowEnabled < .5) return 1.0;
    // Integrate strips of the solar disk, including rays crossing either side of the ring plane.
    vec3 horizontal = normalize(vec3(lightDirection.x, 0.0, lightDirection.z) + vec3(.000001,0.0,0.0));
    float elevation = asin(clamp(lightDirection.y, -1.0, 1.0));
    // Average the transmission over the solar disk. Averaging opacity instead would
    // need a different curve for every geometry, since exp is not linear.
    float transmission = 0.0, totalWeight = 0.0;
    for (int i = 0; i < 9; i++) {
      float offset = (float(i) - 4.0) / 4.5;
      float weight = sqrt(1.0 - offset * offset);
      float angle = elevation + offset * uSunAngularRadius;
      vec3 direction = horizontal * cos(angle) + vec3(0.0, sin(angle), 0.0);
      transmission += ringRayTransmission(p, direction, uSunAngularRadius / 4.5) * weight;
      totalWeight += weight;
    }
    return transmission / totalWeight;
  }
  // p and lightDirection are both in the ring mesh's own frame, in units of the
  // equatorial radius, where the ring plane is z = 0 and the polar axis is +Z. Dividing
  // the polar component by the polar ratio takes that frame to the one where the
  // ellipsoid is a unit sphere: the ring plane is unchanged, and a ray stays a ray
  // because the map is linear. Measuring against a unit sphere without it leaves the
  // shadow too wide; the ratio is 1 for every round body, and the caller must scale the
  // point and the light the same way or they end up in different spaces.
  float planetTransmission(vec3 p, vec3 lightDirection) {
    vec3 light = vec3(lightDirection.x, lightDirection.y, lightDirection.z / uBodyPolarRatio);
    vec3 point = vec3(p.x, p.y, p.z / uBodyPolarRatio);
    float lightLength = length(light);
    float along = dot(point,light) / lightLength;
    float closest = length(cross(point,light)) / lightLength;
    float feather = max(fwidth(closest) * 1.5,
      .001 + max(-along,0.0) * tan(uSunAngularRadius));
    float visibility = along < 0.0 ? smoothstep(1.0-feather,1.0+feather,closest) : 1.0;
    return mix(1.0,visibility,uShadowEnabled);
  }
`;

export function saturnDirectLighting(transmission, scatter = false) {
  // Apply occlusion to incident light before accumulating direct illumination.
  // Ring particles also scatter across the plane, unlike an opaque Lambert surface.
  return THREE.ShaderChunk.lights_fragment_begin.replaceAll(
    "RE_Direct( directLight,",
    `directLight.color *= ${transmission};\n${scatter ? "reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * .05;\n" : ""}RE_Direct( directLight,`,
  );
}

let cachedRingOpticalDepth = null;

export function createSaturnRingShadowUniforms() {
  if (!cachedRingOpticalDepth) cachedRingOpticalDepth = createRingOpticalDepthTexture();
  return {
    uRingOpticalDepth: { value: cachedRingOpticalDepth },
    uRingSpan: { value: new THREE.Vector2(RING_INNER, RING_OUTER) },
    uSunAngularRadius: { value: 0.0005 },
    uShadowEnabled: { value: 1.0 },
    uBodyPolarRatio: { value: bodyModels.saturn?.shape?.[1] || (54364 / 60268) },
  };
}

export function patchSaturnRingShadow(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vActivityPosition;
         varying mat3 vActivityViewToLocal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vActivityPosition = position;
         vActivityViewToLocal = transpose(mat3(modelViewMatrix));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uRingOpticalDepth;
         uniform vec2 uRingSpan;
         uniform float uSunAngularRadius;
         uniform float uShadowEnabled;
         uniform float uBodyPolarRatio;
         varying vec3 vActivityPosition;
         ${saturnShadowFunctions}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        saturnDirectLighting(
          'ringTransmission(vActivityPosition, normalize(vActivityViewToLocal * directLight.direction))',
        ),
      );
  };
  material.customProgramCacheKey = () => (key ? key + '-' : '') + 'saturn-ring-shadow-v1';
  material.needsUpdate = true;
}
