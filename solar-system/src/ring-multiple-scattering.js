import * as THREE from 'three';
import table from './ring-scattering.json';
import { ANGLES } from './ring-scattering-solver.js';

export {
  slabReflectance, slabTransmittance, tableAngles, rankTwoFactors, scatteringKernel,
  ringScatteringFactors, ANGLES, GRID,
} from './ring-scattering-solver.js';

// Multiple scattering in Saturn's ring slab, as the renderer consumes it.
//
// The solver in ring-scattering-solver.js provides the reflection of a homogeneous,
// isotropically scattering slab in Chandrasekhar's finite-atmosphere form,
//   R(mu, mu0) = (w/4) * (mu0 / (mu + mu0)) * [ X(mu)X(mu0) - Y(mu)Y(mu0) ],
// reduced to the rank-two spectral factors of K(mu, mu0) = X X0 - Y Y0. Those are
// solved offline by scripts/build-ring-scattering.mjs, because the grazing entries
// of the table need an optical-depth step small enough to make the solve cost more
// than a frame budget. The regression test re-solves and compares.
//
// Residual approximation, stated rather than hidden: the multiply-scattered orders
// are treated as isotropic, the standard isotropic multiple-scattering
// approximation. The first order keeps its real Henyey-Greenstein phase function,
// so only light that has scattered twice or more loses its angular anisotropy.
// The table is solved offline by scripts/build-ring-scattering.mjs and shipped, so
// the first frame does not wait on a radiative-transfer solve. The regression test
// re-solves and compares, which is what keeps the shipped numbers tied to the
// optical-depth table rather than to a moment in time.
export const shippedScatteringTable = () => table;
export const SCATTERING_REGIONS = table.regions.length;

export function createRingScatteringTexture(source = table) {
  const regions = source.regions.length;
  const data = new Uint16Array(ANGLES * regions * 2 * 2);
  source.regions.forEach((row, region) => {
    for (let angle = 0; angle < ANGLES; angle++)
      for (const offset of [0, 1]) {
        const base = ((region * 2 + offset) * ANGLES + angle) * 2;
        data[base] = THREE.DataUtils.toHalfFloat(row.x[angle]);
        data[base + 1] = THREE.DataUtils.toHalfFloat(row.y[angle]);
      }
  });
  const texture = new THREE.DataTexture(data, ANGLES, regions * 2, THREE.RGFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, table: source };
}
