import { writeFile } from 'node:fs/promises';
import { ringSystems } from '../solar-system/src/ring-systems.js';
import { scatteringFactorsFor, ANGLES, GRID } from '../solar-system/src/ring-scattering-solver.js';

// Solves the multiple-scattering table every ring shader reads and writes it next to
// the source that consumes it. Run after any change to a ring system's region list:
//   npx tsx scripts/build-ring-scattering.mjs
const target = new URL('../solar-system/src/ring-scattering.json', import.meta.url);
const round = (values) => values.map(value => Number(value.toPrecision(6)));

const systems = {};
let worstResidual = 0;
for (const [id, system] of Object.entries(ringSystems)) {
  const factors = scatteringFactorsFor(system.regions);
  worstResidual = Math.max(worstResidual, factors.worstResidual);
  systems[id] = {
    equatorialKm: system.equatorialKm,
    rankTwoResidual: Number(factors.worstResidual.toPrecision(3)),
    regions: factors.rows.map((row, index) => ({
      region: index,
      name: row.name,
      tau: row.tau,
      albedo: row.albedo,
      x: round(row.x),
      y: round(row.y),
    })),
  };
}

const table = {
  generated: '2026-09-15',
  method: 'discrete-ordinates solution of the transfer equation for a homogeneous, '
    + 'isotropically scattering slab, then the rank-two spectral factors of '
    + 'K(mu, mu0) = X(mu)X(mu0) - Y(mu)Y(mu0)',
  grid: { angles: ANGLES, tauStep: GRID.tauStep, directions: GRID.directions },
  rankTwoResidual: Number(worstResidual.toPrecision(3)),
  source: 'ring-systems.js region lists, one row pair per region in declaration order',
  systems,
};

await writeFile(target, `${JSON.stringify(table, null, 1)}\n`);
console.log(`wrote ${Object.keys(systems).length} systems, worst rank-two residual ${table.rankTwoResidual}`);
