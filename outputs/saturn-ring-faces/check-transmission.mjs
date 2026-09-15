// Does the shipped table's rank-two pair reproduce the solver's transmittance?
//
// The table stores the rank-two pair of K(mu,mu0) = X(mu)X(mu0) - Y(mu)Y(mu0), with the
// reflection R = mu0/(mu+mu0) K. Chandrasekhar's finite-atmosphere solution gives the
// transmission from the same pair, T = mu0/(mu0-mu) [X(mu)Y(mu0) - Y(mu)X(mu0)]. If that
// identity holds against slabTransmittance, the renderer can read the dark face out of
// the very same texture, with no extra table and no new solve.
import { slabTransmittance, tableAngles, scatteringFactorsFor } from '../../solar-system/src/ring-scattering-solver.js';
const angles = tableAngles();
for (const [tau, albedo] of [[0.1, 0.2], [0.6, 0.6], [2, 0.6], [4.5, 0.6]]) {
  const { rows } = scatteringFactorsFor([['x', 0, 0, tau, albedo, 0]]);
  const { x, y, residual } = rows[0];
  for (const j0 of [6, 14, 22]) {
    const mu0 = angles[j0];
    const truth = slabTransmittance(tau, albedo, mu0, angles, 0.005);
    const parts = [];
    for (const i of [4, 8, 11, 14, 18, 21]) {
      if (Math.abs(angles[i] - mu0) < 1e-3) continue;
      const pred = mu0 / (mu0 - angles[i]) * (x[i] * y[j0] - y[i] * x[j0]);
      parts.push(`mu=${angles[i].toFixed(2)} ${truth[i].toExponential(2)}/${pred.toExponential(2)} (${(pred / truth[i]).toFixed(3)})`);
    }
    console.log(`tau=${tau} w=${albedo} mu0=${mu0.toFixed(3)} rank2=${(residual * 100).toFixed(2)}%  ${parts.join('  ')}`);
  }
}
