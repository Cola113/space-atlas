import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DataUtils } from 'three';
import { RING_TABLE, ringRadiusUnit, RING_INNER_KM, RING_OUTER_KM } from '../src/ring-optical-depth.js';
import {
  slabReflectance, slabTransmittance, tableAngles, scatteringKernel, rankTwoFactors, ringScatteringFactors, scatteringFactorsFor,
  createRingScatteringTexture, shippedScatteringTable, scatteringRegions,
  SCATTERING_ROW_BASE, ANGLES,
} from '../src/ring-multiple-scattering.js';
import { ringSystems, ringSpan, createRingSystemGeometry } from '../src/ring-systems.js';

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

test('the shipped table is the solve of the current ring region lists', () => {
  const table = shippedScatteringTable();
  assert.deepEqual(Object.keys(table.systems), Object.keys(ringSystems));
  assert.equal(table.grid.angles, ANGLES);
  const fresh = {};
  for (const [id, system] of Object.entries(ringSystems)) fresh[id] = scatteringFactorsFor(system.regions);
  for (const [id, shipped] of Object.entries(table.systems)) {
    const regions = ringSystems[id].regions;
    assert.equal(shipped.regions.length, regions.length, `${id}: region count drifted`);
    // Every region's provenance is checked, but only a sample is re-solved: Saturn now
    // has four hundred regions and re-solving all of them takes most of a minute.
    for (const [index, region] of shipped.regions.entries()) {
      const [name, , , tau, albedo] = regions[index];
      assert.equal(region.name, name, `${id}/${name}: region order drifted`);
      assert.equal(region.tau, tau, `${id}/${name}: optical depth drifted`);
      assert.equal(region.albedo, albedo, `${id}/${name}: albedo drifted`);
      if (index % 17 !== 0 && index !== regions.length - 1) continue;
      const solved = fresh[id].rows[index];
      for (let angle = 0; angle < ANGLES; angle++)
        for (const key of ['x', 'y']) {
          const stored = region[key][angle], recomputed = solved[key][angle];
          const scale = Math.max(Math.abs(recomputed), 1e-6);
          assert.ok(Math.abs(stored - recomputed) / scale < 1e-4,
            `${id} ${name} ${key}[${angle}]: shipped ${stored} against solved ${recomputed}`);
        }
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

test('the scattering texture carries every system, one row pair per region', () => {
  const { texture, table } = createRingScatteringTexture();
  const rowCount = Object.values(table.systems).reduce((total, system) => total + 2 * system.regions.length, 0);
  assert.equal(texture.image.width, ANGLES);
  assert.equal(texture.image.height, rowCount);
  const data = texture.image.data;
  for (const [id, system] of Object.entries(table.systems)) {
    const base = SCATTERING_ROW_BASE[id];
    for (let region = 0; region < system.regions.length; region++)
      for (let angle = 0; angle < ANGLES; angle += 3) {
        // The texture is a stack, so a base row that drifted would silently give one
        // system another system's reflectance.
        const offset = ((base + region * 2) * ANGLES + angle) * 2;
        const expected = system.regions[region];
        // The half-float floor matters for the Jovian rings: their bracket is around
        // 1e-10 and underflows to zero, which is 1% of a ring already at optical depth
        // 1e-8. The absolute bound states that rather than hiding it behind a loose
        // relative one.
        const close = (stored, expected) => Math.abs(stored - expected) <= Math.max(Math.abs(expected) * 1e-3, 1e-5);
        assert.ok(close(DataUtils.fromHalfFloat(data[offset]), expected.x[angle]),
          `${id} region ${region} angle ${angle}: X drifted through the texture`);
        assert.ok(close(DataUtils.fromHalfFloat(data[offset + 1]), expected.y[angle]),
          `${id} region ${region} angle ${angle}: Y drifted through the texture`);
      }
    assert.equal(scatteringRegions(id), system.regions.length);
  }
  texture.dispose();
});

test('the ring mesh tells the shader each annulus edge and its true width', () => {
  // The vertex shader widens a sub-pixel annulus outwards from aRingEdge and takes the
  // light back out with aRingHalfWidth, so both have to describe the annulus the region
  // declares. A wrong half width would scale the wrong amount of light away.
  const segments = 256;
  let regions = 0;
  for (const [id, system] of Object.entries(ringSystems)) {
    const geometry = createRingSystemGeometry(system, segments);
    for (const name of ['aRingEdge', 'aRingHalfWidth', 'aRingProfile', 'aRingRegion'])
      assert.ok(geometry.attributes[name], `${id}: missing ${name}`);
    assert.equal(geometry.attributes.position.count, system.regions.length * 2 * (segments + 1),
      `${id}: vertex count does not match the region list`);
    const edge = geometry.attributes.aRingEdge, halfWidth = geometry.attributes.aRingHalfWidth;
    const perRegion = segments + 1;
    system.regions.forEach((region, index) => {
      const [, innerKm, outerKm] = region;
      const base = index * 2 * perRegion;
      for (let vertex = 0; vertex < perRegion; vertex++) {
        assert.equal(edge.getX(base + vertex), -1, `${id}/${innerKm}: the inner row must be the inward edge`);
        assert.equal(edge.getX(base + perRegion + vertex), 1, `${id}/${outerKm}: the outer row must be the outward edge`);
      }
      const expected = (Math.min(outerKm, Infinity) - innerKm) / 2 / system.equatorialKm;
      // The attribute is a float32 buffer, so the comparison is to its own precision.
      assert.ok(Math.abs(halfWidth.getX(base) - expected) <= Math.max(1, expected) * 1e-7,
        `${id} region ${index}: half width ${halfWidth.getX(base)} against ${expected}`);
      assert.ok(expected > 0, `${id} region ${index}: an annulus of no width cannot be widened`);
      regions++;
    });
    geometry.dispose();
  }
  assert.ok(regions > 200, `only ${regions} annuli checked`);
});

test('every declared ring system is ordered, self-consistent and inside its planet', () => {
  for (const [id, system] of Object.entries(ringSystems)) {
    assert.ok(system.equatorialKm > 0, `${id}: no equatorial radius`);
    let previousOuter = null;
    for (const [name, inner, outer, tau, albedo, surge] of system.regions) {
      assert.ok(inner < outer, `${id}/${name}: inverted bounds`);
      assert.ok(tau > 0 && Number.isFinite(tau), `${id}/${name}: bad optical depth`);
      assert.ok(albedo > 0 && albedo <= 1, `${id}/${name}: bad albedo`);
      assert.ok(surge >= 0 && surge <= 1, `${id}/${name}: bad surge amplitude`);
      // Rings that overlap or leave a gap would be drawn on top of each other or as a
      // hole that no source describes.
      if (previousOuter !== null) assert.ok(inner >= previousOuter, `${id}/${name}: overlaps the previous region`);
      previousOuter = outer;
    }
    const span = ringSpan(system);
    assert.ok(span.inner > 1, `${id}: rings must start outside the planet`);
    // Uranus's narrow rings are genuinely a few kilometres wide; the mesh has to be
    // able to draw them, which is why regions are separate annuli.
    const narrowest = Math.min(...system.regions.map(([, inner, outer]) => outer - inner));
    assert.ok(narrowest < system.regions[0][1] * 0.001 || system.regions.length > 3,
      `${id}: no narrow rings found, the region list looks wrong`);
  }
  // Saturn's regions come from the measured profile rather than from named spans, so
  // this is the check that the generated list still describes the ring system.
  for (const [name, inner, outer] of [['D ring', 66900, 74491], ['B ring', 91975, 117500], ['A ring', 122050, 133423], ['F ring', 139826, 140612]]) {
    const covered = ringSystems.saturn.regions.filter(([, a, b]) => b > inner && a < outer);
    const span = covered.reduce((total, [, a, b]) => total + Math.min(b, outer) - Math.max(a, inner), 0);
    assert.ok(span > (outer - inner) * .99, `${name}: the measured regions cover only ${span} of ${outer - inner} km`);
  }
  assert.ok(ringSystems.saturn.regions.length > 300, 'the kilometre-scale segmentation collapsed');
  assert.ok(ringSystems.uranus.regions.length === 13, 'the Uranian ring system has 13 named rings');
  assert.ok(ringSystems.neptune.regions.length >= 5, 'the Neptunian ring system has at least five rings');
  assert.ok(ringSystems.jupiter.regions.length >= 3, 'the Jovian ring system has at least three components');
});
