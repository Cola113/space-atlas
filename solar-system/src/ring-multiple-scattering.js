import * as THREE from 'three';
import table from './ring-scattering.json';
import { ANGLES } from './ring-scattering-solver.js';

export {
  slabReflectance, slabTransmittance, tableAngles, rankTwoFactors, scatteringKernel,
  ringScatteringFactors, scatteringFactorsFor, ANGLES, GRID,
} from './ring-scattering-solver.js';

// Multiple scattering in a ring slab, as the renderer consumes it.
//
// The solver in ring-scattering-solver.js provides the reflection of a homogeneous,
// isotropically scattering slab in Chandrasekhar's finite-atmosphere form,
//   R(mu, mu0) = (w/4) * (mu0 / (mu + mu0)) * [ X(mu)X(mu0) - Y(mu)Y(mu0) ],
// reduced to the rank-two spectral factors of K(mu, mu0) = X X0 - Y Y0. They are
// solved offline by scripts/build-ring-scattering.mjs, because the grazing entries of
// the table need an optical-depth step small enough to make the solve cost more than a
// frame budget, and a regression test re-solves and compares.
//
// Every declared ring system is stacked into one texture. Region r of a system whose
// base row is B occupies texel rows B + 2r and B + 2r + 1, which the shader samples at
// the exact texel centre, so a filtered read never mixes two regions or the two
// factors.
//
// Residual approximation, stated rather than hidden: the multiply-scattered orders are
// treated as isotropic, the standard isotropic multiple-scattering approximation. The
// first order keeps its real Henyey-Greenstein phase function, so only light that has
// scattered twice or more loses its angular anisotropy.
export const shippedScatteringTable = () => table;

const systemIds = Object.keys(table.systems);

// Base row per system, so a shader can be told where its own rows start.
export const SCATTERING_ROW_BASE = Object.fromEntries(
  systemIds.reduce((entries, id) => {
    entries.push([id, entries.length ? entries[entries.length - 1][1] + 2 * table.systems[entries[entries.length - 1][0]].regions.length : 0]);
    return entries;
  }, []),
);

export const scatteringRegions = id => table.systems[id]?.regions.length ?? 0;

export function createRingScatteringTexture(source = table) {
  const ids = Object.keys(source.systems);
  const rowCount = ids.reduce((total, id) => total + 2 * source.systems[id].regions.length, 0);
  const data = new Uint16Array(ANGLES * rowCount * 2);
  let row = 0;
  for (const id of ids)
    for (const region of source.systems[id].regions) {
      for (let angle = 0; angle < ANGLES; angle++)
        for (const offset of [0, 1]) {
          const base = ((row + offset) * ANGLES + angle) * 2;
          data[base] = THREE.DataUtils.toHalfFloat(region.x[angle]);
          data[base + 1] = THREE.DataUtils.toHalfFloat(region.y[angle]);
        }
      row += 2;
    }
  const texture = new THREE.DataTexture(data, ANGLES, rowCount, THREE.RGFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, table: source };
}
