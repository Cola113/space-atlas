import { writeFile } from 'node:fs/promises';
import { RING_TABLE } from '../solar-system/src/ring-optical-depth.js';
import { ringScatteringFactors, ANGLES, GRID } from '../solar-system/src/ring-scattering-solver.js';

// Solves the multiple-scattering table the ring shader reads and writes it next to
// the source that consumes it. Run after any change to RING_TABLE:
//   npx tsx scripts/build-ring-scattering.mjs
const factors = ringScatteringFactors();
const target = new URL('../solar-system/src/ring-scattering.json', import.meta.url);
const round = (values) => values.map(value => Number(value.toPrecision(6)));

const table = {
  generated: '2026-09-15',
  method: 'discrete-ordinates solution of the transfer equation for a homogeneous, '
    + 'isotropically scattering slab, then the rank-two spectral factors of '
    + 'K(mu, mu0) = X(mu)X(mu0) - Y(mu)Y(mu0)',
  grid: { angles: ANGLES, tauStep: GRID.tauStep, directions: GRID.directions },
  rankTwoResidual: Number(factors.worstResidual.toPrecision(3)),
  source: 'ring-optical-depth.js RING_TABLE, one row per ring region in table order',
  regions: factors.rows.map((row, index) => ({
    region: index,
    name: RING_TABLE[index][0],
    tau: row.tau,
    albedo: row.albedo,
    x: round(row.x),
    y: round(row.y),
  })),
};

await writeFile(target, `${JSON.stringify(table, null, 1)}\n`);
console.log(`wrote ${table.regions.length} regions, worst rank-two residual ${table.rankTwoResidual}`);
