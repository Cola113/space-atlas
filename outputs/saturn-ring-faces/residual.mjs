// Numbers for the test bounds: how well the shipped pair's antisymmetric combination
// reproduces the solver's transmittance, per optical-depth band.
import { slabReflectance, slabTransmittance, tableAngles } from './helpers.mjs';
import { readFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(new URL('../../solar-system/src/ring-scattering.json', import.meta.url), 'utf8'));
const angles = tableAngles();
const grid = [0.1, 0.2, 0.354, 0.5, 0.7, 0.9];
const buckets = new Map();
let worstRel = { err: 0 }, worstAbs = { err: 0 };
for (const region of table.systems.saturn.regions) {
  for (const mu0 of grid) for (const mu of grid) {
    const i = angles.indexOf(angles.reduce((b, a) => Math.abs(a - mu) < Math.abs(b - mu) ? a : b, angles[0]));
    const j0 = angles.indexOf(angles.reduce((b, a) => Math.abs(a - mu0) < Math.abs(b - mu0) ? a : b, angles[0]));
    if (i === j0) continue;
    const truth = slabTransmittance(region.tau, region.albedo, angles[j0], angles, 0.01)[i];
    const lit = slabReflectance(region.tau, region.albedo, angles[j0], angles, 0.01)[i];
    const pair = angles[j0] / (angles[i] - angles[j0]) * (region.x[i] * region.y[j0] - region.y[i] * region.x[j0]);
    const rel = Math.abs(pair - truth) / Math.max(truth, 1e-7);
    const abs = lit > 1e-5 ? Math.abs(pair - truth) / lit : 0;
    const key = region.tau <= 0.3 ? 'tau<=0.3' : region.tau <= 1 ? '0.3-1' : region.tau <= 3 ? '1-3' : '>3';
    const b = buckets.get(key) ?? { n: 0, worstRel: 0, worstAbs: 0 };
    b.n++; b.worstRel = Math.max(b.worstRel, rel); b.worstAbs = Math.max(b.worstAbs, abs);
    buckets.set(key, b);
    if (region.tau <= 3 && rel > worstRel.err) worstRel = { err: rel, tau: region.tau, mu0: angles[j0], mu: angles[i] };
    if (abs > worstAbs.err) worstAbs = { err: abs, tau: region.tau, mu0: angles[j0], mu: angles[i], truth, pair, lit };
  }
}
for (const [key, b] of buckets) console.log(`${key.padEnd(8)} n=${String(b.n).padStart(5)}  worst relative ${b.worstRel.toFixed(3)}  worst |err|/lit ${(100 * b.worstAbs).toFixed(2)}%`);
console.log('worst relative for tau<=3:', JSON.stringify(worstRel, (k, v) => typeof v === 'number' ? Number(v.toPrecision(3)) : v));
console.log('worst |err| as a fraction of the lit face:', JSON.stringify(worstAbs, (k, v) => typeof v === 'number' ? Number(v.toPrecision(3)) : v));
