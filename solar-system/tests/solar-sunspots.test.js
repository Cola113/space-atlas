import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARRINGTON_SIDEREAL_DEG_PER_DAY,
  SOLAR_DIFF_ROTATION,
  MAX_SUNSPOT_GROUPS,
  solarRotationRateDegPerDay,
  solarRotationPeriodDays,
  solarDifferentialDriftDegPerDay,
  schematicSolarCycleActivity,
  evaluateSunspots,
  primarySunspotAnchor,
  createSolarSunspotUniforms,
  updateSolarSunspotUniforms,
} from '../src/solar-sunspots.js';

function angularDiffDeg(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return d;
}

test('Snodgrass & Ulrich (1990) differential rotation profile matches published sidereal periods and monotonicity', () => {
  const eqRate = solarRotationRateDegPerDay(0);
  assert.equal(eqRate, SOLAR_DIFF_ROTATION.A);
  assert.ok(Math.abs(solarRotationPeriodDays(0) - 24.468) < 0.01, `equatorial period ${solarRotationPeriodDays(0)}`);
  assert.ok(solarDifferentialDriftDegPerDay(0) > 0.5, 'equator must rotate faster than Carrington frame');

  // Carrington reference (~25.38 d) sits around mid-low latitude (~27 deg for magnetic tracers).
  assert.ok(Math.abs(360 / CARRINGTON_SIDEREAL_DEG_PER_DAY - 25.38) < 0.01);
  assert.ok(solarRotationPeriodDays(30) > 25.5 && solarRotationPeriodDays(30) < 26.0);
  assert.ok(solarRotationPeriodDays(45) > 27.3 && solarRotationPeriodDays(45) < 27.8);
  assert.ok(solarRotationPeriodDays(90) > 34.0 && solarRotationPeriodDays(90) < 34.5);

  // Strictly decreasing from equator to pole, symmetric across N/S hemispheres.
  let prev = Infinity;
  for (let lat = 0; lat <= 90; lat += 5) {
    const rate = solarRotationRateDegPerDay(lat);
    assert.ok(rate < prev, `rate must decrease at ${lat} deg`);
    assert.ok(Math.abs(rate - solarRotationRateDegPerDay(-lat)) < 1e-12, `hemisphere symmetry at ${lat} deg`);
    prev = rate;
  }
});

test('active sunspot groups drift in Carrington longitude by exact differential shear and rewind deterministically', () => {
  const t0 = Date.UTC(2025, 6, 1, 12, 0, 0);
  const dtDays = 6;
  const t1 = t0 + dtDays * 86400000;

  const g0 = evaluateSunspots(t0);
  const g1 = evaluateSunspots(t1);
  assert.ok(g0.length >= 4, `expected active groups near solar max, got ${g0.length}`);

  const shared = [];
  for (const a of g0) {
    const b = g1.find((entry) => entry.slot === a.slot && entry.epochIndex === a.epochIndex);
    if (!b) continue;
    shared.push([a, b]);
    assert.equal(a.latitudeDeg, b.latitudeDeg);
    const expectedShift = solarDifferentialDriftDegPerDay(a.latitudeDeg) * dtDays;
    const actualShift = angularDiffDeg(b.longitudeDeg, a.longitudeDeg);
    assert.ok(Math.abs(actualShift - expectedShift) < 1e-9,
      `slot ${a.slot} at ${a.latitudeDeg.toFixed(1)} deg: shifted ${actualShift}, expected ${expectedShift}`);
  }
  assert.ok(shared.length >= 2, 'need at least two surviving groups to check relative shear');

  // Relative longitudinal separation between two groups at different latitudes changes by (omega1 - omega2) * dt.
  const sortedByAbsLat = [...shared].sort((x, y) => Math.abs(x[0].latitudeDeg) - Math.abs(y[0].latitudeDeg));
  const [low0, low1] = sortedByAbsLat[0];
  const [high0, high1] = sortedByAbsLat.at(-1);
  if (Math.abs(Math.abs(high0.latitudeDeg) - Math.abs(low0.latitudeDeg)) > 1) {
    const deltaLow = angularDiffDeg(low1.longitudeDeg, low0.longitudeDeg);
    const deltaHigh = angularDiffDeg(high1.longitudeDeg, high0.longitudeDeg);
    assert.ok(deltaLow > deltaHigh,
      `lower latitude (${low0.latitudeDeg.toFixed(1)} deg) must outrun higher latitude (${high0.latitudeDeg.toFixed(1)} deg)`);
  }

  // Pause & rewind determinism.
  assert.deepEqual(evaluateSunspots(t0), g0);
});

test('sunspots stay inside active latitude belts, follow schematic cycle envelope, and clear cleanly when disabled', () => {
  const maxActivity = schematicSolarCycleActivity('2024-08-01T00:00:00Z');
  const minActivity = schematicSolarCycleActivity('2019-12-15T00:00:00Z');
  assert.ok(maxActivity > 0.85 && minActivity < 0.25, `cycle contrast max=${maxActivity}, min=${minActivity}`);

  for (const year of [1905, 1971, 2019, 2025, 2077, 2099]) {
    const groups = evaluateSunspots(Date.UTC(year, 5, 15));
    assert.ok(groups.length <= MAX_SUNSPOT_GROUPS);
    for (const g of groups) {
      assert.ok(Math.abs(g.latitudeDeg) >= 5 && Math.abs(g.latitudeDeg) <= 40,
        `sunspot outside active belt in ${year}: ${g.latitudeDeg}`);
      assert.ok(g.strength > 0 && g.strength <= 1);
      assert.ok(g.radiusRad > 0 && g.radiusRad < 0.16);
    }
  }

  const anchor = primarySunspotAnchor('2025-07-01T12:00:00Z');
  assert.ok(anchor);
  assert.ok(Math.abs(anchor.viewDirection.length() - 1) < 1e-12);
  assert.ok(Math.abs(anchor.point.length() - 1.018) < 1e-12);

  const uniforms = createSolarSunspotUniforms();
  const activeGroups = updateSolarSunspotUniforms(uniforms, '2025-07-01T12:00:00Z', true);
  assert.equal(uniforms.uSunspotCount.value, activeGroups.length);
  assert.ok(uniforms.uSunspotCount.value > 0);
  updateSolarSunspotUniforms(uniforms, '2025-07-01T12:00:00Z', false);
  assert.equal(uniforms.uSunspotCount.value, 0);
  assert.equal(uniforms.uSunspotMeta.value[0].x, 0);
});
