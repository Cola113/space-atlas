import * as THREE from 'three';
import { saturnShadowFunctions, saturnDirectLighting } from './dynamics.js';
import { createRingOpticalDepthTexture, RING_INNER, RING_OUTER } from './ring-optical-depth.js';

import { bodyModels } from './body-models.js';

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
