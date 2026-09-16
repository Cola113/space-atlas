import * as THREE from 'three';
import { RING_PHASE_G, RING_SURGE_SCALE_RAD } from './ring-optical-depth.js';

// Ring photometry, shared by the solar-system view and the landing sky.
//
// The GLSL below is the measured model: Chandrasekhar's finite-atmosphere solution for a
// particle slab, with the Henyey-Greenstein phase function of Lumme, Irvine & Esposito
// 1983 and the opposition surge fitted by French et al. 2007. A ring is deliberately not
// shaded as a surface: a flat diffuse surface receives nothing at grazing incidence, and
// a ring seen from inside its own plane is exactly that case, so the old Lambert annulus
// went black at the very geometry where the rings are brightest. Everything that shades
// a ring must come from here, so the two views cannot disagree about the same ring.
//
// The functions read these uniforms and do not declare them: uRingSurgeScale, uRingScattering,
// uRingScatteringRow, uRingScatteringRows and uRingPhaseG. The solar-system path declares them
// in its own shared chunk; createRingSurfaceMaterial declares them for the landing sky, so the
// two views agree on the names as well as on the model.
export const RING_PHOTOMETRY_GLSL = /* glsl */ `
// The particle colour is built per fragment from the region's measured red/blue
// ratio, so a ring that is measured to be less red renders less red.
vec3 ringParticleColour(float ratio) {
  float blue = 1.0 / max(ratio, 0.1);
  return vec3(1.0, (1.0 + blue) * 0.5, blue);
}
// Henyey-Greenstein phase function. g < 0 is backscattering, which is what the ring
// particles are. The value is the visible-light particle asymmetry from Lumme,
// Irvine & Esposito 1983; the far-ultraviolet |g| this used to carry describes
// grains at 155-180 nm and is the wrong band for a visible render.
float ringPhase(float cosAlpha, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 + 2.0 * g * cosAlpha, 1.5);
}
// Narrow opposition spike on top of that broad curve. One Henyey-Greenstein term
// cannot make it at any wavelength, and it is the brightest part of the measured
// phase curve. French et al. 2007 fit an exponential to the rings' total I/F and
// report its amplitude relative to the background per ring region; the amplitude
// applies to the whole reflectance because that is what was measured.
float ringOppositionSurge(float cosAlpha, float amplitude) {
  float alpha = acos(clamp(cosAlpha, -1.0, 1.0));
  return 1.0 + amplitude * exp(-alpha / uRingSurgeScale);
}
// The bracket X(mu)X(mu0) - Y(mu)Y(mu0) of Chandrasekhar's finite-atmosphere
// solution, stored per ring region as its two spectral factors. Region r occupies
// texel rows 2r and 2r+1 and is sampled at the exact texel centre, so the filtered
// read never mixes two regions or the two factors.
float ringScatteringBracket(float mu, float mu0, float region) {
  float row = uRingScatteringRow + 2.0 * region;
  vec2 x = texture2D(uRingScattering, vec2(mu, (row + 0.5) / uRingScatteringRows)).rg;
  vec2 x0 = texture2D(uRingScattering, vec2(mu0, (row + 1.5) / uRingScatteringRows)).rg;
  return x.x * x0.x - x.y * x0.y;
}
// Reflectance of a plane-parallel particle slab, in two parts that add up to
// Chandrasekhar's exact solution for a finite atmosphere:
//   I/F = mu0/(mu+mu0) * [ K + (w/4) * S * (P(alpha) - 1) ]
// with S = 1 - exp(-tau (1/mu + 1/mu0)) the first-order saturation and K the
// isotropic bracket above. The first order keeps the real Henyey-Greenstein phase
// function; everything below it is the isotropic multiple-scattering term, which
// is what makes the optically thick B ring stop being an order of magnitude dim.
// No display factor is applied anywhere: the brightness is the optical depth, the
// albedo and the angles.
float ringSlabReflectance(float tau, float albedo, float mu, float mu0, float cosAlpha, float region, float g) {
  float slab = 1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0));
  float single = 0.25 * albedo * slab;
  return mu0 / (mu + mu0)
    * (ringScatteringBracket(mu, mu0, region) + single * (ringPhase(cosAlpha, g) - 1.0));
}
// The other face of the same slab: light enters through the sunlit side, crosses the
// ring and leaves through the side the camera is on. Chandrasekhar's solution gives it
// from the same pair of spectral factors, with the antisymmetric combination,
//   T(mu, mu0) = mu0/(mu - mu0) * [X(mu)Y(mu0) - Y(mu)X(mu0)],
// so the shipped table needs no second set of rows. The first order is replaced by the
// real phase function exactly as in reflection; the same phase argument serves both,
// because the scattering angle is the supplement of the angle between the sun
// direction and the view direction either way. What separates the two orders is the
// saturation: light leaving the far face has crossed the whole slab, so it is
// exp(-tau/mu) - exp(-tau/mu0) rather than 1 - exp(-tau(1/mu + 1/mu0)).
float ringTransmittedBracket(float mu, float mu0, float region) {
  float row = uRingScatteringRow + 2.0 * region;
  vec2 x = texture2D(uRingScattering, vec2(mu, (row + 0.5) / uRingScatteringRows)).rg;
  vec2 x0 = texture2D(uRingScattering, vec2(mu0, (row + 1.5) / uRingScatteringRows)).rg;
  return x.x * x0.y - x.y * x0.x;
}
float ringSlabTransmittance(float tau, float albedo, float mu, float mu0, float cosAlpha, float region, float g) {
  // mu = mu0 is a removable singularity: the bracket vanishes with the denominator. Step
  // a thousandth off it on whichever side the fragment is on, so the ratio stays finite
  // and stays continuous through the crossing.
  float step = (mu >= mu0 ? 1.0 : -1.0) * max(abs(mu - mu0), .001);
  float exitMu = mu0 + step;
  float single = 0.25 * albedo * (exp(-tau / exitMu) - exp(-tau / mu0));
  return mu0 / step
    * (ringTransmittedBracket(exitMu, mu0, region) + single * (ringPhase(cosAlpha, g) - 1.0));
}
`;

// Display level of the ring surface, as a fraction of the reflectance the solver computed.
//
// The measurement of the ring against the globe - same frame, same geometry, both models -
// carries a spread of about twenty percent: the bands are averaged radially, the slab table
// is sampled at twenty-four angles, and the sub-pixel coverage factor varies region by
// region. A factor inside that range is inside the model's own uncertainty and is not a
// statement about the ring; outside it, the ring's brightness stops being a photometric
// one. The sunlit face as shipped read brighter than the planet's own disk at the default
// framing, so it sits at the low end of that range.
//
// This is a display adjustment in the sense REALISM_STANDARD.md allows, written down rather
// than folded into the reflectance: the slab reflectance stays the measured quantity, and
// the one number to turn is here.
export const RING_DISPLAY_LEVEL = 0.85;

// How much of the ring's radiance a spoke removes at its centre. Spokes are dark in the images and
// their own scattering is not modelled, so this is a display level for a darkening, not a physical
// reflectance: it says how dark the markings are drawn, not how much dust is there.
export const RING_SPOKE_LEVEL = 0.55;

// The landing sky lights its globes with a directional light of this intensity, so the ring
// is scaled by the same number to stay commensurate with the planet beside it.
export function createRingSurfaceMaterial({ scattering, rowBase = 0, rows, phaseG = RING_PHASE_G, lightIntensity = 1 }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      uRingSurgeScale: { value: RING_SURGE_SCALE_RAD }, uRingScattering: { value: scattering },
      uRingScatteringRow: { value: rowBase }, uRingScatteringRows: { value: rows },
      uRingPhaseG: { value: phaseG }, uRingSun: { value: new THREE.Vector3() },
      uRingCamera: { value: new THREE.Vector3() }, uRingLight: { value: lightIntensity },
      uRingDisplayLevel: { value: RING_DISPLAY_LEVEL },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aRingProfile;
      attribute float aRingRegion;
      varying vec4 vRingProfile;
      varying float vRingRegion;
      varying vec3 vRingLocal;
      void main() {
        vRingProfile = aRingProfile;
        vRingRegion = aRingRegion;
        vRingLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vRingProfile;
      varying float vRingRegion;
      varying vec3 vRingLocal;
      uniform vec3 uRingSun;
      uniform vec3 uRingCamera;
      uniform float uRingLight;
      uniform float uRingDisplayLevel;
      // The shared photometry reads these; the solar-system path declares them in its own
      // material, so the two views agree on the names as well as on the model.
      uniform sampler2D uRingScattering;
      uniform float uRingScatteringRow;
      uniform float uRingScatteringRows;
      uniform float uRingPhaseG;
      uniform float uRingSurgeScale;
      ${RING_PHOTOMETRY_GLSL}
      void main() {
        vec3 sunLocal = normalize(uRingSun);
        vec3 viewLocal = normalize(uRingCamera - vRingLocal);
        float mu0 = clamp(abs(sunLocal.z), .001, 1.0);
        float mu = clamp(abs(viewLocal.z), .001, 1.0);
        float tau = vRingProfile.r, albedo = vRingProfile.g, surge = vRingProfile.b;
        float cosAlpha = dot(sunLocal, viewLocal);
        // Opposite faces of one slab are different surfaces: the sunlit face reflects off
        // its particles, the other is lit only by what crossed the slab.
        float radiance = sunLocal.z * viewLocal.z > 0.0
          ? ringSlabReflectance(tau, albedo, mu, mu0, cosAlpha, vRingRegion, uRingPhaseG) * ringOppositionSurge(cosAlpha, surge)
          : ringSlabTransmittance(tau, albedo, mu, mu0, cosAlpha, vRingRegion, uRingPhaseG);
        vec3 colour = ringParticleColour(vRingProfile.a);
        // Opacity follows the same optical depth, so a gap lets the background through and
        // cannot disagree with the region whose depth it uses.
        gl_FragColor = vec4(colour * radiance * uRingDisplayLevel * uRingLight, 1.0 - exp(-tau / mu));
        #include <colorspace_fragment>
      }`,
  });
}
