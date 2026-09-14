import * as THREE from 'three';

// Normal optical depth of Saturn's rings, kept separate from the display mesh so the
// same numbers drive both the ring opacity and the ring shadow.
//
// Source: NASA PDS Ring-Moon Systems Node, "Vital Statistics for Saturn's Rings",
// https://pds-rings.seti.org/saturn/saturn_rings_table.html (retrieved 2026-09-15).
// The table lists a boundary pair and an optical-depth *range* per named feature;
// `tau` below is the midpoint of that range, which is an approximation stated per
// region. Sub-ring optical depths are not measured here — individual density waves
// and ringlets are finer than this table.
export const RING_TABLE = [
  // name,             inner km,  outer km,  tau,   albedo
  ['D ring',            66900,     74491,   0.0005, 0.1],
  ['C ring',            74491,     91975,   0.2,    0.1],
  ['B ring B1',         91975,     99000,   1.3,    0.6],
  ['B ring B2',         99000,    104000,   2.2,    0.6],
  ['B ring B3',        104000,    110000,   3.0,    0.6],
  ['B ring B4',        110000,    116500,   2.5,    0.6],
  ['B ring B5',        116500,    117500,   2.0,    0.6],
  ['Cassini Division', 117500,    122050,   0.08,   0.2],
  ['A ring',           122050,    133423,   0.6,    0.5],
  ['Encke Gap',        133423,    133745,   0.02,   0.5],
  ['A ring outer',     133745,    136487,   0.6,    0.5],
  ['Keeler Gap',       136487,    136522,   0.02,   0.5],
  ['A ring edge',      136522,    136770,   0.6,    0.5],
  ['Roche Division',   136770,    139826,   0.002,  0.4],
  ['F ring',           139826,    140612,   0.1,    0.4],
];

// Single-scattering albedo, from French et al. 2007 (PASP 119, 623), who put it at
// 0.1 for the C ring rising to 0.6 for the B ring, and Doyle et al. 1989 (Icarus 80,
// 104), who give a Bond albedo near 0.5 for the A ring. Only the C, B and (loosely)
// A ring values are measured; the tenuous ring and gap values are interpolated
// between those anchors, and the narrow gaps inherit their surroundings.
export const RING_PHASE_G = -0.6;

export const RING_INNER_KM = RING_TABLE[0][1];
export const RING_OUTER_KM = RING_TABLE[RING_TABLE.length - 1][2];

// Saturn's equatorial radius, so one ring unit equals one body radius.
export const SATURN_EQUATORIAL_KM = 60268;

export const RING_INNER = RING_INNER_KM / SATURN_EQUATORIAL_KM;
export const RING_OUTER = RING_OUTER_KM / SATURN_EQUATORIAL_KM;

export function opticalDepthAt(radiusKm) {
  if (radiusKm <= RING_INNER_KM || radiusKm >= RING_OUTER_KM) return 0;
  for (const [, inner, outer, tau] of RING_TABLE) {
    if (radiusKm >= inner && radiusKm < outer) return tau;
  }
  return 0;
}

export function albedoAt(radiusKm) {
  if (radiusKm <= RING_INNER_KM || radiusKm >= RING_OUTER_KM) return 0;
  for (const [, inner, outer, , albedo] of RING_TABLE) {
    if (radiusKm >= inner && radiusKm < outer) return albedo;
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

// Normalised radius of every shared boundary between table rows, so a shader can
// name the region a fragment falls in without a second texture to read.
export const RING_REGION_SEAMS = RING_TABLE.slice(0, -1).map(([, , outer]) => ringRadiusUnit(outer));

const SAMPLES = 2048;

// A one-row half-float texture holding normal optical depth in R and single-scattering
// albedo in G, generated from RING_TABLE rather than shipped as an image so the
// numbers stay checkable in source. Half float keeps linear filtering available on
// plain WebGL2.
export function createRingOpticalDepthTexture() {
  const data = new Uint16Array(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) {
    const radiusKm = RING_INNER_KM + ((i + 0.5) / SAMPLES) * (RING_OUTER_KM - RING_INNER_KM);
    data[i * 2] = THREE.DataUtils.toHalfFloat(opticalDepthAt(radiusKm));
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(albedoAt(radiusKm));
  }
  const texture = new THREE.DataTexture(data, SAMPLES, 1, THREE.RGFormat, THREE.HalfFloatType);
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
