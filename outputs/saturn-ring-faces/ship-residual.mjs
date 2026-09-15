import { slabReflectance, slabTransmittance, tableAngles, shippedScatteringTable } from '../../solar-system/src/ring-multiple-scattering.js';
const table = shippedScatteringTable();
const angles = tableAngles();
const at = mu => angles.reduce((best, a) => Math.abs(a - mu) < Math.abs(best - mu) ? a : best, angles[0]);
const grid = [0.1, 0.2, 0.354, 0.5, 0.7, 0.9];
let worstThin = { err: 0 }, worstShare = { err: 0 }, worstAny = { err: 0 };
for (const system of Object.values(table.systems))
  for (const region of system.regions)
    for (const mu0 of grid) for (const mu of grid) {
      const exit = at(mu), incidence = at(mu0);
      if (exit === incidence) continue;
      const i = angles.indexOf(exit), j0 = angles.indexOf(incidence);
      const transmitted = slabTransmittance(region.tau, region.albedo, incidence, angles, 0.01)[i];
      const reflected = slabReflectance(region.tau, region.albedo, incidence, angles, 0.01)[i];
      const read = incidence / (exit - incidence) * (region.x[i] * region.y[j0] - region.y[i] * region.x[j0]);
      const rel = Math.abs(read - transmitted) / Math.max(transmitted, 1e-7);
      if (reflected > 1e-5) {
        const share = Math.abs(read - transmitted) / reflected;
        if (share > worstShare.err) worstShare = { err: share, tau: region.tau, mu0: incidence, mu: exit, transmitted, read, reflected };
      }
      if (rel > worstAny.err) worstAny = { err: rel, tau: region.tau, mu0: incidence, mu: exit, transmitted, read };
      if (region.tau <= 1 && rel > worstThin.err) worstThin = { err: rel, tau: region.tau, mu0: incidence, mu: exit, transmitted, read };
    }
const show = o => JSON.stringify(o, (k, v) => typeof v === 'number' ? Number(v.toPrecision(3)) : v);
console.log('tau<=1 worst relative:', show(worstThin));
console.log('worst relative anywhere:', show(worstAny));
console.log('worst as a share of the lit face:', show(worstShare));
