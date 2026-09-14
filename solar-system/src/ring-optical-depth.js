import * as THREE from 'three';
import tauProfile from './ring-tau-profile.json';

// Normal optical depth of Saturn's rings, kept separate from the display mesh so the
// same numbers drive both the ring opacity and the ring shadow.
//
// Sources, both retrieved 2026-09-15:
//  - NASA PDS Ring-Moon Systems Node, "Vital Statistics for Saturn's Rings",
//    https://pds-rings.seti.org/saturn/saturn_rings_table.html — the boundary pair and
//    an optical-depth *range* per named feature; `tau` below is the midpoint of that
//    range, which is an approximation stated per region.
//  - NASA PDS Atmospheres Node, "Cassini Rings Science",
//    https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/Cassini/sci-rings.html
//    — the named narrow ringlets, each with its own boundary pair and optical depth.
//    These are the km-scale features the ring table used to average away: the Titan
//    ringlet is 23 km wide with tau ~ 4 inside a C ring whose average is 0.2.
// Single-scattering albedo and opposition-surge amplitude, column by column.
//
// albedo: French et al. 2007 (PASP 119, 623) put the single-scattering albedo at 0.1
// for the C ring rising to 0.6 for the B ring, but those two numbers are *338 nm*,
// in the ultraviolet, not visible light; no visible per-ring single-scattering albedo
// was retrievable, so they are kept with the band stated rather than relabelled. The
// A ring value of 0.5 is the Bond albedo of the inner and middle A ring from Dones,
// Cuzzi & Showalter 1993 (Icarus 105, 184), which is not the same quantity as the
// single-scattering albedo the reflectance formula wants. The tenuous ring and gap
// values are interpolated between those anchors, and the ringlets inherit the albedo
// and the surge amplitude of the ring they sit inside, because neither is measured
// per ringlet.
// Named anchors, kept for the things an occultation does not measure: the
// single-scattering albedo and the opposition-surge amplitude are published per named
// ring, while the optical depth now comes from the measured profile below. The D ring
// is the one row whose optical depth is still used, because no full-coverage
// occultation resolves it (see MEASURED_FROM_KM in scripts/build-ring-tau-profile.mjs).
export const RING_TABLE = [
  // name,             inner km,  outer km,  tau,   albedo, opposition surge,
  //                   red/blue colour ratio
  ['D ring',            66900,     74491,   0.0005, 0.1,    0.6, 1.0],
  ['C ring',            74491,     77867,   0.2,    0.1,    0.6, 1.0],
  ['Titan Ringlet',     77867,     77890,   4.0,    0.1,    0.6, 1.0],
  ['C ring',            77890,     87480,   0.2,    0.1,    0.6, 1.0],
  ['Maxwell Ringlet',   87480,     87539,   2.0,    0.1,    0.6, 1.0],
  ['C ring',            87539,     88702,   0.2,    0.1,    0.6, 1.0],
  ['Bond Ringlet',      88702,     88719,   1.0,    0.1,    0.6, 1.0],
  ['C ring',            88719,     90138,   0.2,    0.1,    0.6, 1.0],
  ['Dawes Ringlet',     90138,     90200,   0.6,    0.1,    0.6, 1.0],
  ['C ring',            90200,     91975,   0.2,    0.1,    0.6, 1.0],
  ['B ring B1',         91975,     99000,   1.3,    0.6,    0.4, 1.49],
  ['B ring B2',         99000,    104000,   2.2,    0.6,    0.4, 1.49],
  ['B ring B3',        104000,    110000,   3.0,    0.6,    0.4, 1.49],
  ['B ring B4',        110000,    116500,   2.5,    0.6,    0.4, 1.49],
  ['B ring B5',        116500,    117500,   2.0,    0.6,    0.4, 1.49],
  ['Cassini Division', 117500,    117806,   0.08,   0.2,    0.5, 1.0],
  ['Huygens Ringlet',  117806,    117824,   1.5,    0.2,    0.5, 1.0],
  ['Cassini Division', 117824,    118234,   0.08,   0.2,    0.5, 1.0],
  ['Herschel Ringlet', 118234,    118263,   0.1,    0.2,    0.5, 1.0],
  ['Cassini Division', 118263,    120037,   0.08,   0.2,    0.5, 1.0],
  ['Laplace Ringlet',  120037,    120078,   1.0,    0.2,    0.5, 1.0],
  ['Cassini Division', 120078,    122050,   0.08,   0.2,    0.5, 1.0],
  ['A ring',           122050,    133423,   0.6,    0.5,    0.4, 1.49],
  ['Encke Gap',        133423,    133745,   0.02,   0.5,    0.4, 1.49],
  ['A ring outer',     133745,    136487,   0.6,    0.5,    0.7, 1.49],
  ['Keeler Gap',       136487,    136522,   0.02,   0.5,    0.7, 1.49],
  ['A ring edge',      136522,    136770,   0.6,    0.5,    0.7, 1.49],
  ['Roche Division',   136770,    139826,   0.002,  0.4,    0.7, 1.49],
  ['F ring',           139826,    140612,   0.1,    0.4,    0.7, 1.49],
];

// Henyey-Greenstein asymmetry of the ring particles, negative because they
// backscatter. This is the *visible* particle value: Lumme, Irvine & Esposito 1983
// (Icarus 53, 174) fit g = -0.30 at 620 nm to the B ring as a particle-level
// asymmetry. The previous -0.6 came from Cassini UVIS, whose |g| = 0.63-0.78 is
// measured at 155-180 nm (Bradley, Colwell & Esposito 2013, Icarus 225, 726) and
// describes grains in the far ultraviolet, not particles in visible light.
export const RING_PHASE_G = -0.3;

// Opposition surge: the real phase curve is a very narrow spike sitting on a broad,
// slowly falling curve, which one Henyey-Greenstein term cannot produce at any
// wavelength. French et al. 2007 (PASP 119, 623) fit an exponential plus a linear
// background to the rings' total I/F and give the exponential's amplitude relative to
// that background per ring region, and a half width at half maximum near 0.1 degrees
// at BVRI wavelengths. The per-region amplitudes live in RING_TABLE's last column.
// The surge is applied to the whole reflectance rather than to one scattering order,
// because that is what the amplitude was measured against.
export const RING_SURGE_HWHM_DEG = 0.1;
// exp(-alpha / scale) falls to one half at alpha = scale * ln 2.
export const RING_SURGE_SCALE_RAD = (RING_SURGE_HWHM_DEG * Math.PI / 180) / Math.LN2;

// Particle colour, as the ratio between the reflectance at red and at blue
// wavelengths. One number per ring region: the model builds the colour vector from it,
// so the measured ratio is the whole input and no channel is invented separately.
//
// Measured: Lumme, Irvine & Esposito 1983 (Icarus 53, 174) give the B ring particles'
// geometric albedo as 0.61 +/- 0.04 at red and 0.41 +/- 0.03 at blue wavelengths, a
// ratio of 1.49. Estrada, Cuzzi & Showalter 2002 (Icarus 166, 212, the erratum to the
// Voyager colour photometry of 1996) find the A and B rings "in a significantly redder
// part of colour-albedo space" than the C ring, and the A ring appearing redder than the
// B ring between 6 and 14 degrees phase; Estrada & Cuzzi 1996 is the source for the C
// ring and Cassini Division being the least red.
//
// Assumed: the C ring and Cassini Division are given a ratio of 1.0, i.e. neutral. The
// direction is measured, the magnitude is not - no retrievable visible-light table gives
// their ratio - so the floor of the measurement's range is used and BODY_MODELS.md says
// so. The tenuous rings and the gaps take the value of the ring they sit in.
export const RING_COLOUR_RATIO = 0.61 / 0.41;

// Colour vector for a red-to-blue ratio, normalised to the red channel because the
// ring's overall level comes from the single-scattering albedo.
export function particleColour(ratio) {
  const blue = 1 / ratio;
  return [1, (1 + blue) / 2, blue];
}

export const RING_INNER_KM = RING_TABLE[0][1];
export const RING_OUTER_KM = RING_TABLE[RING_TABLE.length - 1][2];

// Saturn's equatorial radius, so one ring unit equals one body radius.
export const SATURN_EQUATORIAL_KM = 60268;

export const RING_INNER = RING_INNER_KM / SATURN_EQUATORIAL_KM;
export const RING_OUTER = RING_OUTER_KM / SATURN_EQUATORIAL_KM;

// The radial profile the ring opacity, the ring reflectance and the ring shadow all
// read. Inside the measured span it is the kilometre-scale optical depth from the
// Cassini UVIS occultation described in ring-tau-profile.json; the D ring, which no
// occultation resolves, keeps its published anchor.
export const RING_TAU_PROFILE = tauProfile;
export const MEASURED_FROM_KM = tauProfile.startKm;

export function opticalDepthAt(radiusKm) {
  if (radiusKm <= RING_INNER_KM || radiusKm >= RING_OUTER_KM) return 0;
  if (radiusKm < MEASURED_FROM_KM) return RING_TABLE[0][3];
  const index = Math.min(tauProfile.samples - 1, Math.max(0, Math.round(radiusKm - MEASURED_FROM_KM)));
  return tauProfile.tau[index] / tauProfile.scale;
}

export function albedoAt(radiusKm) {
  if (radiusKm <= RING_INNER_KM || radiusKm >= RING_OUTER_KM) return 0;
  for (const [, inner, outer, , albedo] of RING_TABLE) {
    if (radiusKm >= inner && radiusKm < outer) return albedo;
  }
  return 0;
}

// Amplitude of the opposition surge relative to the broad phase curve, from the named
// anchors. The C ring, the B ring and the outer A ring carry measured values; the D
// ring inherits the C ring anchor, the Cassini Division sits between the C and B ring
// anchors, and the gaps and the tenuous rings outside the A ring inherit their
// surroundings. Those interpolated entries are marked here rather than being left to
// look measured. The kilometre-scale regions all take their amplitude from the anchor
// they fall inside, because no surge amplitude is published per kilometre.
export function surgeAt(radiusKm) {
  if (radiusKm <= RING_INNER_KM || radiusKm >= RING_OUTER_KM) return 0;
  for (const [, inner, outer, , , surge] of RING_TABLE) {
    if (radiusKm >= inner && radiusKm < outer) return surge;
  }
  return 0;
}

// Normalised radius across the ring system: 0 at the D ring inner edge, 1 at the F
// ring outer edge. Both the mesh UVs and the shadow lookup use this one mapping.
export const ringRadiusUnit = (radiusKm) =>
  (radiusKm - RING_INNER_KM) / (RING_OUTER_KM - RING_INNER_KM);

// Same coordinate, for a radius already expressed in Saturn equatorial radii.
export const ringUvAtRatio = (ratio) =>
  (ratio - RING_INNER) / (RING_OUTER - RING_INNER);


// The source profile is sampled at 1 km. The texture holds 16,384 samples across the
// 73,712 km the ring system spans, which is 4.5 km per sample: close enough that the
// narrowest named ringlet is several texels wide, and still inside what a WebGL2
// context guarantees for a texture. At the original 2048 the spacing was 36 km and
// every ringlet was aliased in or out depending on where a sample happened to land.
const SAMPLES = 16384;

// A one-row half-float texture holding normal optical depth in R, single-scattering
// albedo in G and the opposition-surge amplitude in B, generated from RING_TABLE
// rather than shipped as an image so the numbers stay checkable in source. Half
// float keeps linear filtering available on plain WebGL2, and RGBA rather than RGB
// because three.js dropped the three-channel format.
export function createRingOpticalDepthTexture() {
  const data = new Uint16Array(SAMPLES * 4);
  for (let i = 0; i < SAMPLES; i++) {
    const radiusKm = RING_INNER_KM + ((i + 0.5) / SAMPLES) * (RING_OUTER_KM - RING_INNER_KM);
    data[i * 4] = THREE.DataUtils.toHalfFloat(opticalDepthAt(radiusKm));
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(albedoAt(radiusKm));
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(surgeAt(radiusKm));
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const texture = new THREE.DataTexture(data, SAMPLES, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  // Mipmaps matter here: the profile is flat within a ring and steps at every boundary,
  // so where the ring compresses on screen the un-filtered 2048 samples alias into hard
  // stair-stepped edges. They also make the explicit textureGrad footprints used by the
  // shadow lookup actually blur, which a base-level-only sampler silently ignores.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
