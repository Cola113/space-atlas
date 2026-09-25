import { Vector3 } from 'three';

// Presentation only. Ring radii, optical depths, particle albedos and the scattering
// solver remain in ring-systems / ring-photometry. Uranus's kilometre-wide rings need
// an explicitly artistic exposure and coverage lift to read at whole-planet scale.
// Uniforms keep one shader program safe to share between different ring systems.
export function createRingDisplayUniforms(bodyId) {
  const enhanced = bodyId === 'uranus';
  return {
    uRingPresentation: { value: enhanced ? 1 : 0 },
    uRingPresentationTint: { value: new Vector3(.78, .9, 1) },
  };
}

export const RING_DISPLAY_GLSL = /* glsl */ `
  uniform float uRingPresentation;
  uniform vec3 uRingPresentationTint;

  vec3 ringDisplayColour(vec3 colour) {
    return mix(colour, uRingPresentationTint, uRingPresentation);
  }

  float ringDisplayOpacity(float opacity, float coverage, float tau) {
    // Lift only dense narrow rings. Broad, tenuous dust stays quiet, and the
    // physical-width ordering survives: epsilon still reads strongest.
    float narrow = smoothstep(.02, .1, tau);
    float readableCoverage = mix(coverage, pow(coverage, .3), narrow);
    return opacity * mix(coverage, readableCoverage * .6, uRingPresentation);
  }

  float ringDisplayRadiance(float radiance, float tau, float mu0, float facing) {
    // A cool exposure floor makes the translucent foreground pass a fine silver
    // line instead of a black scratch. The unlit face is quieter; illumination
    // still varies with the sun and the planet's shadow is applied afterwards.
    float fill = 1.1 * (1.0 - exp(-tau * 4.0)) * (.3 + .7 * sqrt(mu0));
    fill *= mix(.55, 1.0, smoothstep(-.02, .02, facing));
    return mix(radiance, max(radiance * 6.0, fill), uRingPresentation);
  }
`;
