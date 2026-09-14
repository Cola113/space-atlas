import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DataUtils } from 'three';
import { RING_TABLE, RING_REGION_SEAMS, ringRadiusUnit, RING_INNER_KM, RING_OUTER_KM } from '../src/ring-optical-depth.js';
import {
  slabReflectance, slabTransmittance, tableAngles, scatteringKernel, rankTwoFactors, ringScatteringFactors,
  createRingScatteringTexture, shippedScatteringTable, SCATTERING_REGIONS, ANGLES,
} from '../src/ring-multiple-scattering.js';

// Gauss-Legendre nodes and weights on [0, 1], for the angular integrals the energy
// budget needs. Nothing here shares code with the discrete-ordinates solver.
function gaussAngles(count) {
  const nodes = new Float64Array(count), weights = new Float64Array(count);
  const evaluate = (x) => {
    let previous = 1, current = x;
    for (let k = 2; k <= count; k++) {
      const next = ((2 * k - 1) * x * current - (k - 1) * previous) / k;
      previous = current; current = next;
    }
    return { value: current, derivative: count * (x * current - previous) };
  };
  for (let i = 0; i < count; i++) {
    let x = Math.cos(Math.PI * (i + 0.75) / (count + 0.5));
    for (let iteration = 0; iteration < 100; iteration++) {
      const { value, derivative } = evaluate(x);
      const step = value * (x * x - 1) / derivative;
      x -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    const { derivative } = evaluate(x);
    nodes[i] = (x + 1) / 2;
    weights[i] = (1 - x * x) / (derivative * derivative);
  }
  return { nodes, weights };
}

test('the slab solver reproduces single scattering when the slab is optically thin', () => {
  const angles = tableAngles();
  const [tau, albedo, mu0] = [0.01, 0.5, 0.7];
  const computed = slabReflectance(tau, albedo, mu0, angles);
  for (let i = 0; i < angles.length; i++) {
    const mu = angles[i];
    const firstOrder = 0.25 * albedo * (mu0 / (mu + mu0)) * (1 - Math.exp(-tau * (1 / mu + 1 / mu0)));
    // The excess over the first order is the second-order term, which is O(tau), so
    // a few percent is the physics and not an error.
    assert.ok(Math.abs(computed[i] / firstOrder - 1) < .03,
      `mu=${mu.toFixed(3)}: solver ${computed[i]} against first order ${firstOrder}`);
  }
});

test("a thick conservative slab reproduces Chandrasekhar's published normal-incidence value", () => {
  // H(1) = 2.90781 for conservative isotropic scattering, and a semi-infinite
  // atmosphere reflects I/F = (w/4) * (mu0/(mu+mu0)) * H(mu)H(mu0) = H(1)^2/8 at
  // normal incidence and normal emergence. This is the one point of the solution
  // that can be checked against a number published outside this repository.
  const expected = 2.90781 ** 2 / 8;
  const computed = slabReflectance(600, 1, 1, Float64Array.from([1]), 0.05)[0];
  assert.ok(Math.abs(computed / expected - 1) < .03,
    `thick conservative slab reflected ${computed.toFixed(5)} against the published ${expected.toFixed(5)}`);
});

test('a conservative slab conserves energy across reflection, transmission and the direct beam', () => {
  const { nodes, weights } = gaussAngles(24);
  for (const [tau, mu0] of [[0.4, 0.6], [2, 0.6], [2, 1]]) {
    const mus = Float64Array.from(nodes);
    const reflected = slabReflectance(tau, 1, mu0, mus, 0.01);
    const transmitted = slabTransmittance(tau, 1, mu0, mus, 0.01);
    let budget = Math.exp(-tau / mu0);
    for (let i = 0; i < nodes.length; i++)
      budget += 2 * weights[i] * (reflected[i] + transmitted[i]) * nodes[i] / mu0;
    // The upwind sweep loses a little flux: halving the step moves the budget from
    // 0.987 towards 1, so this bound tracks the discretisation, not a physics error.
    assert.ok(budget <= 1.002, `tau=${tau} mu0=${mu0}: conservative slab gained flux, budget ${budget.toFixed(5)}`);
    assert.ok(budget > .985,
      `tau=${tau} mu0=${mu0}: reflected + transmitted + direct = ${budget.toFixed(5)}`);
  }
});

test('the slab is reciprocal: mu R(mu, mu0) equals mu0 R(mu0, mu)', () => {
  for (const [tau, albedo] of [[0.6, 0.5], [2.2, 0.6]]) {
    for (const [mu, mu0] of [[0.3, 0.8], [0.1, 0.5], [0.45, 0.95]]) {
      const direct = slabReflectance(tau, albedo, mu0, Float64Array.from([mu]))[0] * mu;
      const swapped = slabReflectance(tau, albedo, mu, Float64Array.from([mu0]))[0] * mu0;
      assert.ok(Math.abs(direct - swapped) < 1e-9 * Math.max(direct, swapped),
        `tau=${tau}: mu R(mu,mu0) = ${direct} against mu0 R(mu0,mu) = ${swapped}`);
    }
  }
});

test('the isotropic bracket really is rank two, which is what the table stores', () => {
  const angles = tableAngles();
  for (const [tau, albedo] of [[0.0005, 0.1], [0.2, 0.1], [0.6, 0.5], [1.3, 0.6], [2.2, 0.6], [3, 0.6]]) {
    const factors = rankTwoFactors(scatteringKernel(tau, albedo, angles), angles.length);
    assert.ok(factors.residual < .02,
      `tau=${tau} w=${albedo}: rank-two truncation residual ${factors.residual}`);
  }
});

test('a thick conservative slab reflects all of the light and then no more', () => {
  const { nodes, weights } = gaussAngles(16);
  for (const mu0 of [0.4, 1]) {
    const reflected = slabReflectance(200, 1, mu0, Float64Array.from(nodes), 0.05);
    let albedo = 0;
    for (let i = 0; i < nodes.length; i++) albedo += 2 * weights[i] * reflected[i] * nodes[i] / mu0;
    assert.ok(albedo <= 1.005, `mu0=${mu0}: conservative slab reflects ${albedo.toFixed(4)} of the incident light`);
    assert.ok(albedo > .97, `mu0=${mu0}: a thick conservative slab should reflect nearly everything, got ${albedo.toFixed(4)}`);
  }
});

test('the shipped table is the solve of the current ring table', async () => {
  const table = shippedScatteringTable();
  assert.equal(table.regions.length, RING_TABLE.length);
  assert.equal(table.grid.angles, ANGLES);
  // Re-solving at the shipped grid is the only check that ties the numbers back to
  // RING_TABLE; a stale file or an edited optical depth would fail here.
  const fresh = ringScatteringFactors();
  for (const [index, region] of table.regions.entries()) {
    const [name, , , tau, albedo] = RING_TABLE[index];
    assert.equal(region.name, name, `${name}: region order drifted`);
    assert.equal(region.tau, tau, `${name}: optical depth drifted`);
    assert.equal(region.albedo, albedo, `${name}: albedo drifted`);
    const solved = fresh.rows[index];
    for (let angle = 0; angle < ANGLES; angle++)
      for (const key of ['x', 'y']) {
        const stored = region[key][angle], recomputed = solved[key][angle];
        const scale = Math.max(Math.abs(recomputed), 1e-6);
        assert.ok(Math.abs(stored - recomputed) / scale < 1e-4,
          `${name} ${key}[${angle}]: shipped ${stored} against solved ${recomputed}`);
      }
  }
});

test('the ring shader reads the solved table instead of a display exposure factor', async () => {
  const source = await readFile(new URL('../src/dynamics.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('uRingExposure'), 'the ring shader still carries a display exposure factor');
  assert.ok(source.includes('uRingScattering'), 'the ring shader no longer reads the scattering table');
  // The reflectance must not be scaled by any hand-set constant.
  const body = source.slice(source.indexOf('float ringSlabReflectance('));
  const expression = body.slice(body.indexOf('return'), body.indexOf('}', body.indexOf('return')));
  assert.ok(!/\d+\.\d*\s*\*/.test(expression.replace(/0\.25/g, '')),
    `the reflectance expression carries an unexplained constant: ${expression.trim()}`);
});

test('multiple scattering lifts the optically thick rings well above single scattering', () => {
  // Where the app looks at the rings most of the time. The single-scattering term is
  // the whole of the old model, so this is the shortfall that the removed exposure
  // factor used to paper over.
  const [mu, mu0] = [0.62, 0.62];
  const angles = Float64Array.from([mu]);
  for (const [tau, albedo] of [[2.2, 0.6], [3, 0.6], [0.6, 0.5]]) {
    const solved = slabReflectance(tau, albedo, mu0, angles)[0];
    const single = 0.25 * albedo * (mu0 / (mu + mu0)) * (1 - Math.exp(-tau * (1 / mu + 1 / mu0)));
    assert.ok(solved > single * 1.3,
      `tau=${tau}: multiple scattering only adds ${(solved / single - 1).toFixed(3)} over single scattering`);
  }
  // And on the thin C ring it must stay a small correction rather than a rescaling.
  const thin = slabReflectance(0.2, 0.1, mu0, angles)[0];
  const thinSingle = 0.25 * 0.1 * (mu0 / (mu + mu0)) * (1 - Math.exp(-0.2 * (1 / mu + 1 / mu0)));
  assert.ok(thin / thinSingle < 1.1, `C ring gained ${(thin / thinSingle - 1).toFixed(3)} from multiple scattering`);
});

test('the scattering texture carries the table, one row pair per region', () => {
  const { texture, table } = createRingScatteringTexture();
  assert.equal(texture.image.width, ANGLES);
  assert.equal(texture.image.height, 2 * SCATTERING_REGIONS);
  const data = texture.image.data;
  for (let region = 0; region < SCATTERING_REGIONS; region++)
    for (let angle = 0; angle < ANGLES; angle += 3) {
      const base = ((region * 2) * ANGLES + angle) * 2;
      assert.ok(Math.abs(DataUtils.fromHalfFloat(data[base]) - table.regions[region].x[angle]) <= Math.abs(table.regions[region].x[angle]) * 1e-3,
        `region ${region} angle ${angle}: X drifted through the texture`);
      assert.ok(Math.abs(DataUtils.fromHalfFloat(data[base + 1]) - table.regions[region].y[angle]) <= Math.max(Math.abs(table.regions[region].y[angle]), 1e-3) * 2e-2,
        `region ${region} angle ${angle}: Y drifted through the texture`);
    }
  texture.dispose();
});

test('every region seam falls inside the ring system and is ordered', () => {
  assert.equal(RING_REGION_SEAMS.length, RING_TABLE.length - 1);
  for (const [index, seam] of RING_REGION_SEAMS.entries()) {
    // The seam is the shared boundary of two rows: if the table ever gains a gap or
    // an overlap, the shader's region index would silently pick the wrong row.
    assert.equal(RING_TABLE[index][2], RING_TABLE[index + 1][1], `seam ${index} is not shared`);
    assert.ok(seam > 0 && seam < 1, `seam ${index} left the ring system`);
    if (index > 0) assert.ok(seam > RING_REGION_SEAMS[index - 1], `seam ${index} is out of order`);
    assert.ok(Math.abs(seam - ringRadiusUnit(RING_TABLE[index][2])) < 1e-12);
  }
  assert.equal(ringRadiusUnit(RING_INNER_KM), 0);
  assert.equal(ringRadiusUnit(RING_OUTER_KM), 1);
});
