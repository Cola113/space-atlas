import * as THREE from 'three';
import { RING_TABLE, SATURN_EQUATORIAL_KM, RING_PARTICLE_COLOR, RING_PHASE_G } from './ring-optical-depth.js';

// Declared ring systems, one entry per body, in the same shape Saturn's optical-depth
// table already had: named regions with an inner and outer radius in kilometres, a
// normal optical depth and a single-scattering albedo, plus the opposition-surge
// amplitude relative to the broad phase curve. Any body may be given one; the mesh,
// the reflectance and the scattering table all read this list and nothing else.
//
// Columns are [name, inner km, outer km, tau, albedo, surge amplitude]. The Saturn
// row set is re-used from ring-optical-depth.js so the drawn rings, the profile the
// planet's ring shadow samples and the reflectance cannot disagree about where a ring
// sits or how opaque it is.

// Uranus, 13 named rings. Radii are the PDS Ring-Moon Systems Node table's middle
// boundary and width, published as mid +- width/2 at the 1987-01-01 ring-fit epoch;
// the source publishes no epoch on the vital-statistics page itself, and the modern
// French fit agrees with these centres to under 0.5 km. Optical depths are the table's
// listed values; the epsilon ring is quoted as a range 0.5-2.3 and the midpoint is
// used. The three broad dust rings (zeta, nu, mu) are optically thin to the point of
// being invisible individually.
const URANUS_EQUATORIAL_KM = 25559;
const URANUS = [
  ['zeta',   37850,  41350,   0.0045,   0.015, 0.4],
  ['6',      41837.2, 41838.8, 0.3,     0.015, 0.4],
  ['5',      42232.9, 42235.1, 0.5,     0.015, 0.4],
  ['4',      42569.8, 42572.2, 0.3,     0.015, 0.4],
  ['alpha',  44713.8, 44722.2, 0.4,     0.015, 0.4],
  ['beta',   45656.3, 45665.7, 0.3,     0.015, 0.4],
  ['eta',    47175.2, 47176.8, 0.4,     0.015, 0.4],
  ['gamma',  47625.9, 47628.1, 0.3,     0.015, 0.4],
  ['delta',  48297.7, 48302.3, 0.5,     0.015, 0.4],
  ['lambda', 50022.9, 50025.2, 0.1,     0.015, 0.4],
  ['epsilon', 51120.0, 51178.1, 1.4,    0.018, 0.4],
  ['nu',     65400,  69200,   5.6e-6,   0.004, 0.4],
  ['mu',     89200, 106200,   8.5e-6,   0.004, 0.4],
];

// Neptune, the five named rings. The Galle, Le Verrier and Lassell radii are the PDS
// middle boundary and width; the source gives Le Verrier a width of "under 100 km" and
// Lassell's own row puts its inner edge inside Le Verrier, so Lassell's inner edge is
// snapped to Le Verrier's outer edge instead of drawing the same annulus twice. Arago
// has no published width or optical depth: it is described as a brightness enhancement
// at the outer edge of Lassell, so it is drawn from Lassell's outer edge to the IAU
// radius for Arago and inherits the surrounding opacity. The unnamed dust ring in
// Galatea's orbit is not declared at all, because no source gives it a width. The Le
// Verrier optical depth is quoted as 0.003 by PDS and about 0.01 by the NASA fact
// sheet; the PDS value is used.
const NEPTUNE_EQUATORIAL_KM = 24764;
const NEPTUNE = [
  ['Galle',      41000,   43000,   0.0001,  0.015, 0.4],
  ['Le Verrier', 53150,   53250,   0.003,   0.015, 0.4],
  ['Lassell',    53250,   57200,   0.0001,  0.015, 0.4],
  ['Arago',      57200,   57600,   0.0001,  0.015, 0.4],
  ['Adams',      62925.5, 62940.5, 0.0515,  0.015, 0.4],
];

// Jupiter: halo, main ring and the two gossamer rings. These are broad and extremely
// optically thin, the opposite extreme from the Uranian rings. The source gives both
// gossamer rings the same inner edge as the main ring, because they overlap radially
// and are told apart by vertical extent, which this renderer does not model; their
// inner edges are therefore snapped to the main ring's outer edge and the overlap is
// not reproduced. The halo is quoted as ten thousand kilometres thick and is drawn
// flat like every other ring here.
const JUPITER_EQUATORIAL_KM = 71492;
const JUPITER = [
  ['halo',              100000, 122400, 1e-6,  0.015, 0.4],
  ['main ring',         122400, 129100, 8e-6,  0.015, 0.4],
  ['Amalthea gossamer', 129100, 181350, 5e-7,  0.015, 0.4],
  ['Thebe gossamer',    181350, 221900, 1e-7,  0.015, 0.4],
  ['Thebe extension',   221900, 270000, 1e-8,  0.015, 0.4],
];

export const ringSystems = {
  saturn: {
    equatorialKm: SATURN_EQUATORIAL_KM,
    regions: RING_TABLE.map(([name, inner, outer, tau, albedo, surge]) => [name, inner, outer, tau, albedo, surge]),
    particleColor: RING_PARTICLE_COLOR,
    phaseG: RING_PHASE_G,
    // The ring shadow is solved from the optical-depth profile, so only the system the
    // planet shader knows how to shadow carries this flag.
    castsShadow: true,
  },
  uranus: { equatorialKm: URANUS_EQUATORIAL_KM, regions: URANUS },
  neptune: { equatorialKm: NEPTUNE_EQUATORIAL_KM, regions: NEPTUNE },
  jupiter: { equatorialKm: JUPITER_EQUATORIAL_KM, regions: JUPITER },
};

// Defaults for the systems that have no measured phase function of their own. Uranus
// and Neptune's rings are as dark as Saturn's C ring and their particles are described
// as similarly neutral to reddish; Jupiter's ring particles are described as the
// darkest and reddest in the solar system. Using Saturn's measured values everywhere
// is an assumption, not a measurement, and BODY_MODELS.md says so.
const DEFAULT_PHASE_G = RING_PHASE_G;
const DEFAULT_COLOR = RING_PARTICLE_COLOR;

export function ringSystemFor(id) {
  const system = ringSystems[id];
  if (!system) return null;
  return {
    ...system,
    phaseG: system.phaseG ?? DEFAULT_PHASE_G,
    particleColor: system.particleColor ?? DEFAULT_COLOR,
  };
}

// Ring radii as fractions of the equatorial radius, which is what the mesh and the
// camera framing both need.
export function ringSpan(system) {
  return {
    inner: system.regions[0][1] / system.equatorialKm,
    outer: system.regions[system.regions.length - 1][2] / system.equatorialKm,
  };
}

// One geometry holding every declared region as its own annulus, with the optical
// depth, albedo, surge amplitude and region index carried per vertex. Drawing each
// ring at its measured width is what makes a two-kilometre Uranian ring a two
// kilometre ring; a radial profile texture would have to sample 68,000 km of radial
// extent finely enough to keep them, and would lose them.
export function createRingSystemGeometry(system, segments = 256) {
  const positions = [], profiles = [], regions = [], uvs = [], indices = [];
  system.regions.forEach(([, innerKm, outerKm, tau, albedo, surge], index) => {
    const inner = innerKm / system.equatorialKm, outer = outerKm / system.equatorialKm;
    const base = positions.length / 3;
    for (const radius of [inner, outer])
      for (let step = 0; step <= segments; step++) {
        const angle = (step / segments) * Math.PI * 2;
        // Built in the XY plane, so the ring normal is the mesh's local +Z; the mesh
        // is then tipped into the equatorial plane exactly as the Saturn-only path
        // used to be.
        positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        profiles.push(tau, albedo, surge);
        regions.push(index);
        uvs.push(radius, 0.5);
      }
    const ring = segments + 1;
    for (let step = 0; step < segments; step++) {
      const a = base + step, b = a + 1, c = a + ring, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRingProfile', new THREE.Float32BufferAttribute(profiles, 3));
  geometry.setAttribute('aRingRegion', new THREE.Float32BufferAttribute(regions, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
