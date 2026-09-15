// Absolute radiance of the two faces over the real region list, from the solver: what the
// lit face gives, what the unlit face gives, and how much of the lit face that is. Also
// the shipped table's own read of the unlit face, at a sun angle and a view angle that
// differ (mu = mu0 is the guarded singularity and is not evaluated here).
import { slabReflectance, slabTransmittance, tableAngles } from './helpers.mjs';
import { readFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(new URL('../../solar-system/src/ring-scattering.json', import.meta.url), 'utf8'));
const angles = tableAngles();
const byTau = [...table.systems.saturn.regions].sort((a, b) => a.tau - b.tau);
const picks = [0, 40, 120, 200, 260, 320, 360, 400].map(index => byTau[index]);
const mu0 = angles[14];        // the sun
const mu = angles[8];          // the view, on the other face
console.log(`sun mu0 = ${mu0.toFixed(3)}, view mu = ${mu.toFixed(3)}`);
const i = angles.indexOf(mu), j0 = angles.indexOf(mu0);
for (const region of picks) {
  const lit = slabReflectance(region.tau, region.albedo, mu0, angles, 0.01)[i];
  const truth = slabTransmittance(region.tau, region.albedo, mu0, angles, 0.01)[i];
  const read = mu0 / (mu - mu0) * (region.x[i] * region.y[j0] - region.y[i] * region.x[j0]);
  console.log(`tau ${region.tau.toFixed(4).padStart(8)}  w ${region.albedo}  lit ${lit.toFixed(4)}` +
    `  unlit solver ${truth.toExponential(2)} (${(100 * truth / lit).toFixed(2)}% of lit)` +
    `  read from the shipped pair ${read.toExponential(2)} (${(100 * read / lit).toFixed(2)}%)`);
}
