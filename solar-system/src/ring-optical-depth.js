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
  // name,             inner km,  outer km,  tau
  ['D ring',            66900,     74491,   0.0005],
  ['C ring',            74491,     91975,   0.2],
  ['B ring B1',         91975,     99000,   1.3],
  ['B ring B2',         99000,    104000,   2.2],
  ['B ring B3',        104000,    110000,   3.0],
  ['B ring B4',        110000,    116500,   2.5],
  ['B ring B5',        116500,    117500,   2.0],
  ['Cassini Division', 117500,    122050,   0.08],
  ['A ring',           122050,    133423,   0.6],
  ['Encke Gap',        133423,    133745,   0.02],
  ['A ring outer',     133745,    136487,   0.6],
  ['Keeler Gap',       136487,    136522,   0.02],
  ['A ring edge',      136522,    136770,   0.6],
  ['Roche Division',   136770,    139826,   0.002],
  ['F ring',           139826,    140612,   0.1],
];

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

// Normalised radius across the ring system: 0 at the D ring inner edge, 1 at the F
// ring outer edge. Both the mesh UVs and the shadow lookup use this one mapping.
export const ringRadiusUnit = (radiusKm) =>
  (radiusKm - RING_INNER_KM) / (RING_OUTER_KM - RING_INNER_KM);

// Same coordinate, for a radius already expressed in Saturn equatorial radii.
export const ringUvAtRatio = (ratio) =>
  (ratio - RING_INNER) / (RING_OUTER - RING_INNER);

const SAMPLES = 2048;

// A one-row half-float texture of optical depth against normalised radius. Generated
// from RING_TABLE rather than shipped as an image so the numbers stay checkable in
// source, and half float keeps linear filtering available on plain WebGL2.
export function createRingOpticalDepthTexture() {
  const data = new Uint16Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const radiusKm = RING_INNER_KM + ((i + 0.5) / SAMPLES) * (RING_OUTER_KM - RING_INNER_KM);
    data[i] = THREE.DataUtils.toHalfFloat(opticalDepthAt(radiusKm));
  }
  const texture = new THREE.DataTexture(data, SAMPLES, 1, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
