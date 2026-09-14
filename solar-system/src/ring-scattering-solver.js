import { RING_TABLE } from './ring-optical-depth.js';

// Multiple scattering in a plane-parallel particle slab.
//
// The solver half of the model: everything here is pure numerics and can run in a
// build script, a test or the browser. ring-multiple-scattering.js consumes the
// solved table and turns it into the texture the shader reads.
//
// The single-scattering formula alone is exact only for optically thin material.
// The B ring runs to tau ~ 3, where most of the emerging light has scattered more
// than once, and the single-scattering expression falls short by about an order of
// magnitude at the phase angles this scene is normally viewed at.
//
// This module solves the transfer equation for a homogeneous, isotropically
// scattering slab by discrete ordinates, then writes the emergent reflection in
// the form Chandrasekhar's exact solution takes for a finite atmosphere:
//
//   R(mu, mu0) = (w/4) * (mu0 / (mu + mu0)) * [ X(mu)X(mu0) - Y(mu)Y(mu0) ]
//
// X and Y stay implicit. The shader only needs the bracket, and any pair of
// functions related to the true X and Y by a common rotation reproduces it
// exactly, so the two non-zero terms of the spectral decomposition of
//
//   K(mu, mu0) = X(mu)X(mu0) - Y(mu)Y(mu0)
//
// are a complete representation at two numbers per angle instead of a square
// table. That the computed K really is rank two is checked in tests, because it is
// also the sharpest available test of the solver itself.
//
// Residual approximation, stated rather than hidden: the multiply-scattered orders
// are treated as isotropic, the standard isotropic multiple-scattering
// approximation. The first order keeps its real Henyey-Greenstein phase function,
// so only light that has scattered twice or more loses its angular anisotropy, and
// the loss is largest at backscatter where the single term dominates anyway.

// Directions over [-1, 1]. Even order, so no node sits at mu = 0.
const DIRECTIONS = 16;
// Optical-depth step of the discrete-ordinates grid. The grazing entries of the
// table need the cell to stay well inside the mean free path of the most oblique
// ray (mu = 0.5 / ANGLES), which is what fixes this value; tests compare the shipped
// table against a solve at half the step.
const TAU_STEP = 0.01;
// Angles in the stored lookup table. Texel centres are (k + 0.5) / ANGLES.
export const ANGLES = 24;
export const GRID = { tauStep: TAU_STEP, directions: DIRECTIONS };

function gaussLegendre(n) {
  const nodes = new Float64Array(n), weights = new Float64Array(n);
  const evaluate = (x) => {          // P_n(x) and (x^2 - 1) P_n'(x)
    let previous = 1, current = x;
    for (let k = 2; k <= n; k++) {
      const next = ((2 * k - 1) * x * current - (k - 1) * previous) / k;
      previous = current; current = next;
    }
    return { value: current, derivative: n * (x * current - previous) };
  };
  for (let i = 0; i < n; i++) {
    let x = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
    for (let iteration = 0; iteration < 100; iteration++) {
      const { value, derivative } = evaluate(x);
      const step = value * (x * x - 1) / derivative;
      x -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    const { derivative } = evaluate(x);
    nodes[i] = x;
    weights[i] = 2 * (1 - x * x) / (derivative * derivative);
  }
  return { nodes, weights };
}

// LU decomposition with partial pivoting, then solves against several right-hand
// sides, which is what the block sweep needs.
function decompose(matrix, size) {
  const lu = Float64Array.from(matrix);
  for (let column = 0; column < size; column++) {
    let best = column;
    for (let row = column + 1; row < size; row++)
      if (Math.abs(lu[row * size + column]) > Math.abs(lu[best * size + column])) best = row;
    if (best !== column)
      for (let k = 0; k < size; k++) {
        const swap = lu[column * size + k]; lu[column * size + k] = lu[best * size + k]; lu[best * size + k] = swap;
      }
    const pivot = lu[column * size + column];
    for (let row = column + 1; row < size; row++) {
      const factor = lu[row * size + column] / pivot;
      lu[row * size + column] = factor;
      for (let k = column + 1; k < size; k++) lu[row * size + k] -= factor * lu[column * size + k];
    }
  }
  return lu;
}

function solve(lu, size, rhs) {
  const values = Float64Array.from(rhs);
  for (let row = 1; row < size; row++) {
    let sum = values[row];
    for (let k = 0; k < row; k++) sum -= lu[row * size + k] * values[k];
    values[row] = sum;
  }
  for (let row = size - 1; row >= 0; row--) {
    let sum = values[row];
    for (let k = row + 1; k < size; k++) sum -= lu[row * size + k] * values[k];
    values[row] = sum / lu[row * size + row];
  }
  return values;
}

// Solves the slab once and returns the cell-average total source, which both the
// reflected and the transmitted intensities integrate against. Optical depth grows
// downward, so the transfer equation is
//   mu dI/dtau = -I + (w/2) Int I dmu' + (w/4) exp(-tau/mu0)
// and the scattering integral moves to the left with a minus sign.
function solveTotalSource(tau, albedo, mu0, tauStep, directions) {
  const { nodes, weights } = gaussLegendre(directions);
  const cells = Math.max(4, Math.ceil(tau / tauStep));
  const step = tau / cells;
  const size = directions;
  const scatter = albedo / 2;
  // Exact cell average of the attenuated beam. expm1 keeps a thin cell from
  // cancelling catastrophically.
  const beamSource = (top) => Math.exp(-top / mu0) * -Math.expm1(-step / mu0) * (albedo / 4) * mu0 / step;

  // Block tridiagonal system A_k x_(k-1) + B_k x_k + C_k x_(k+1) = b_k, where A and
  // C are diagonal: only the upwind face of each hemisphere couples to a neighbour.
  const A = new Float64Array(cells * size * size);
  const B = new Float64Array(cells * size * size);
  const C = new Float64Array(cells * size * size);
  const rhs = new Float64Array(cells * size);
  for (let k = 0; k < cells; k++) {
    const source = beamSource(k * step);
    for (let row = 0; row < size; row++) {
      const mu = nodes[row], magnitude = Math.abs(mu);
      for (let column = 0; column < size; column++)
        B[(k * size + row) * size + column] = -scatter * weights[column];
      B[(k * size + row) * size + row] += magnitude / step + 1;
      if (mu > 0) A[(k * size + row) * size + row] = -mu / step;
      else C[(k * size + row) * size + row] = mu / step;
      rhs[k * size + row] = source;
    }
  }

  // Block Thomas sweep. Cell 0 has no upper neighbour and the last cell has no
  // lower one; the diffuse intensity entering either face is zero, and the diagonal
  // entries for those directions stay zero, so those terms drop out.
  const inverse = new Float64Array(size * size);
  for (let k = 1; k < cells; k++) {
    const upper = k - 1;
    const lu = decompose(B.subarray(upper * size * size, (upper + 1) * size * size), size);
    // inverse = inv(B_(k-1)) * C_(k-1); C is diagonal so each column is one solve.
    for (let column = 0; column < size; column++) {
      const unit = new Float64Array(size);
      unit[column] = C[(upper * size + column) * size + column];
      if (unit[column] === 0) continue;
      const solved = solve(lu, size, unit);
      for (let row = 0; row < size; row++) inverse[row * size + column] = solved[row];
    }
    const previousRhs = solve(lu, size, rhs.subarray(upper * size, (upper + 1) * size));
    for (let row = 0; row < size; row++) {
      const factor = A[(k * size + row) * size + row];
      if (factor === 0) continue;
      for (let column = 0; column < size; column++) B[(k * size + row) * size + column] -= factor * inverse[row * size + column];
      rhs[k * size + row] -= factor * previousRhs[row];
    }
  }

  const solution = new Float64Array(cells * size);
  for (let k = cells - 1; k >= 0; k--) {
    const values = new Float64Array(size);
    for (let row = 0; row < size; row++) {
      let sum = rhs[k * size + row];
      if (k + 1 < cells)
        for (let column = 0; column < size; column++) sum -= C[(k * size + row) * size + column] * solution[(k + 1) * size + column];
      values[row] = sum;
    }
    const solved = solve(decompose(B.subarray(k * size * size, (k + 1) * size * size), size), size, values);
    for (let row = 0; row < size; row++) solution[k * size + row] = solved[row];
  }

  const totalSource = new Float64Array(cells);
  for (let k = 0; k < cells; k++) {
    let integrated = 0;
    for (let row = 0; row < size; row++) integrated += weights[row] * solution[k * size + row];
    totalSource[k] = scatter * integrated + beamSource(k * step);
  }
  return { totalSource, cells, step };
}

// Emergent upward intensity at the top of a slab of optical thickness `tau` and
// single-scattering albedo `albedo`, for a unit parallel beam at incidence mu0,
// evaluated at each angle in `mus`. Normalised so that the first order alone
// reproduces (w/4) * mu0/(mu+mu0) * (1 - exp(-tau (1/mu + 1/mu0))), which is the
// expression the renderer used before multiple scattering was added. The result is
// reciprocal in the sense mu * R(mu, mu0) = mu0 * R(mu0, mu).
export function slabReflectance(tau, albedo, mu0, mus, tauStep = TAU_STEP, directions = DIRECTIONS) {
  const { totalSource, cells, step } = solveTotalSource(tau, albedo, mu0, tauStep, directions);
  const reflectance = new Float64Array(mus.length);
  for (let index = 0; index < mus.length; index++) {
    // Each cell already contributes the path-length integral of exp(-t/mu) divided
    // by mu, which is exp(-t/mu) evaluated between the cell faces.
    const inverseMu = 1 / mus[index];
    let value = 0;
    for (let k = 0; k < cells; k++)
      value += totalSource[k] * (Math.exp(-k * step * inverseMu) - Math.exp(-(k + 1) * step * inverseMu));
    reflectance[index] = value;
  }
  return reflectance;
}

// Diffuse intensity leaving the bottom face, from the same solution. Used to close
// the energy budget: for a conservative slab the reflected, the transmitted and the
// direct beam have to add up to what came in, which no amount of internal
// consistency inside the reflection function can fake.
export function slabTransmittance(tau, albedo, mu0, mus, tauStep = TAU_STEP, directions = DIRECTIONS) {
  const { totalSource, cells, step } = solveTotalSource(tau, albedo, mu0, tauStep, directions);
  const transmittance = new Float64Array(mus.length);
  for (let index = 0; index < mus.length; index++) {
    const inverseMu = 1 / mus[index];
    let value = 0;
    for (let k = 0; k < cells; k++)
      value += totalSource[k] * Math.exp(-(tau - k * step) * inverseMu) * -Math.expm1(-step * inverseMu);
    transmittance[index] = value;
  }
  return transmittance;
}

// Angles the lookup table is sampled at.
export function tableAngles(count = ANGLES) {
  return Float64Array.from({ length: count }, (_, index) => (index + 0.5) / count);
}

// The two spectral factors of K on the angle grid, with the residual of the
// rank-two truncation relative to the largest entry of K. Jacobi rotations are used
// rather than power iteration: K has one positive and one negative eigenvalue whose
// magnitudes can differ by two orders, and deflation resolves the small one badly.
export function rankTwoFactors(matrix, count) {
  const a = Float64Array.from(matrix);
  const vectors = new Float64Array(count * count);
  for (let i = 0; i < count; i++) vectors[i * count + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let offDiagonal = 0;
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) offDiagonal += a[i * count + j] ** 2;
    if (offDiagonal < 1e-30) break;
    for (let p = 0; p < count; p++) for (let q = p + 1; q < count; q++) {
      const off = a[p * count + q];
      if (off === 0) continue;
      const theta = (a[q * count + q] - a[p * count + p]) / (2 * off);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c, tau = s / (1 + c);
      a[p * count + p] -= t * off;
      a[q * count + q] += t * off;
      a[p * count + q] = 0; a[q * count + p] = 0;
      for (let i = 0; i < count; i++) {
        if (i === p || i === q) continue;
        const left = a[i * count + p], right = a[i * count + q];
        a[i * count + p] = left - s * (right + tau * left);
        a[i * count + q] = right + s * (left - tau * right);
        a[p * count + i] = a[i * count + p];
        a[q * count + i] = a[i * count + q];
      }
      for (let i = 0; i < count; i++) {
        const left = vectors[i * count + p], right = vectors[i * count + q];
        vectors[i * count + p] = left - s * (right + tau * left);
        vectors[i * count + q] = right + s * (left - tau * right);
      }
    }
  }
  const pairs = Array.from({ length: count }, (_, i) => ({ value: a[i * count + i], index: i }));
  pairs.sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const positive = pairs[0].value > 0 ? pairs[0] : pairs[1];
  const negative = positive === pairs[0] ? pairs[1] : pairs[0];
  const factor = (pair) => {
    const values = Array.from({ length: count }, (_, row) => vectors[row * count + pair.index] * Math.sqrt(Math.abs(pair.value)));
    // Overall sign is free: the shader forms X(mu)X(mu0) - Y(mu)Y(mu0), which a common
    // sign flip leaves unchanged. Choose the branch that starts positive.
    const sign = values[0] < 0 ? -1 : 1;
    return values.map(value => sign * value);
  };
  const x = factor(positive), y = factor(negative);
  let residual = 0, magnitude = 0;
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
    residual = Math.max(residual, Math.abs(x[i] * x[j] - y[i] * y[j] - matrix[i * count + j]));
    magnitude = Math.max(magnitude, Math.abs(matrix[i * count + j]));
  }
  return { x, y, residual: magnitude > 0 ? residual / magnitude : 0 };
}

// K on the angle grid for one slab.
export function scatteringKernel(tau, albedo, angles = tableAngles()) {
  const count = angles.length;
  const matrix = new Float64Array(count * count);
  for (let column = 0; column < count; column++) {
    const reflectance = slabReflectance(tau, albedo, angles[column], angles);
    for (let row = 0; row < count; row++)
      matrix[row * count + column] = reflectance[row] * (angles[row] + angles[column]) / angles[column];
  }
  // K is symmetric for any exact solution; averaging removes the solver's small
  // asymmetry so the extracted pair is a real spectral decomposition.
  const symmetric = new Float64Array(count * count);
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++)
    symmetric[i * count + j] = (matrix[i * count + j] + matrix[j * count + i]) / 2;
  return symmetric;
}

export function ringScatteringFactors() {
  const angles = tableAngles();
  const rows = [];
  let worst = 0;
  for (const [, , , tau, albedo] of RING_TABLE) {
    const factors = rankTwoFactors(scatteringKernel(tau, albedo, angles), angles.length);
    worst = Math.max(worst, factors.residual);
    rows.push({ tau, albedo, ...factors });
  }
  return { angles, rows, worstResidual: worst };
}
