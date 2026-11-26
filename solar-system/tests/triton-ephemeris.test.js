import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { localPhysics } from './physical-fixture.js';
import { evaluateEphemeris, MissingEphemerisError } from '../src/physics/ephemeris.js';
import { meanElements, physicalDefinitions } from '../src/physics/definitions.js';
import { bodyOrientation } from '../src/physics/orientation.js';

test('Triton NEP098 published yearly bundles match independent JPL Horizons state vectors across 1900–2100', async () => {
  const ref = JSON.parse(await readFile(new URL('./triton-reference.json', import.meta.url), 'utf8'));
  assert.equal(ref.horizons.length, 16);
  const provider = localPhysics();
  let maxPosKm = 0;
  let maxVelKmS = 0;
  for (const sample of ref.horizons) {
    const year = Math.max(1900, Math.min(2100, new Date(Date.UTC(2000, 0, 1, 12) + sample.tdbSeconds * 1000).getUTCFullYear()));
    const bundle = await provider.ephemeris.load('neptune', year);
    const relAt = t => new Vector3().fromArray(evaluateEphemeris(bundle, 801, 8, t))
      .sub(new Vector3().fromArray(evaluateEphemeris(bundle, 899, 8, t)));
    const actualPos = relAt(sample.tdbSeconds);
    const actualVel = relAt(sample.tdbSeconds + 1).sub(relAt(sample.tdbSeconds - 1)).multiplyScalar(0.5);
    const posErr = actualPos.distanceTo(new Vector3().fromArray(sample.positionKm));
    const velErr = actualVel.distanceTo(new Vector3().fromArray(sample.velocityKmS));
    maxPosKm = Math.max(maxPosKm, posErr);
    maxVelKmS = Math.max(maxVelKmS, velErr);
    assert.ok(posErr < 0.025, `${sample.tdbCalendar}: posErr ${posErr} km`);
    // ±1 s finite difference across Float32 12-hour Chebyshev record seams (~0.015 km step / 2 s) stays < 0.015 km/s;
    // interior points agree within < 0.0001 km/s.
    assert.ok(velErr < 0.015, `${sample.tdbCalendar}: velErr ${velErr} km/s`);
    assert.ok(sample.jplephemDifferenceKm < 0.001, `${sample.tdbCalendar}: Horizons vs jplephem ${sample.jplephemDifferenceKm} km`);
  }
  console.log('Triton Horizons reference checks:', { samples: ref.horizons.length, maxPosKm, maxVelKmS });
  provider.dispose();
});

test('Triton NEP098 availability, Neptune translation, IAU attitude, retrograde orbit, and boundaries stay consistent', async () => {
  const provider = localPhysics();
  const date = new Date('2026-09-26T00:00:00Z');
  const before = provider.frame(date);
  assert.equal(before.bodies.has('triton'), false);
  assert.throws(() => provider.frame(date, { required: ['triton'] }), MissingEphemerisError);

  await provider.ensure(date, ['triton'], { prefetch: false });
  const after = provider.frame(date);
  const triton = after.bodies.get('triton');
  const neptune = after.bodies.get('neptune');
  assert.deepEqual(neptune, before.bodies.get('neptune'), 'loading Triton must not change Neptune');
  assert.deepEqual(triton.positionKm, neptune.positionKm.clone().add(triton.relativeKm));
  assert.match(triton.model, /NEP098/);
  assert.equal(triton.parent, 'neptune');
  assert.equal(meanElements.bodies.triton, undefined);
  assert.equal(physicalDefinitions.bodies.triton.rotation.provider, 'iau-pck');
  assert.ok(triton.orientation.quaternion.angleTo(bodyOrientation('triton', date).quaternion) < 1e-7);

  // Retrograde motion relative to Neptune's north pole.
  const angularMomentum = triton.relativeKm.clone().cross(triton.relativeVelocityKmS);
  assert.ok(angularMomentum.dot(neptune.orientation.north) < 0, 'Triton orbit must be retrograde about Neptune north');

  // Smooth continuity across 1900 and 2100 range boundaries to two-body extrapolation.
  for (const boundary of ['1900-01-01T00:00:00Z', '2101-01-01T00:00:00Z']) {
    const t = Date.parse(boundary);
    const first = boundary.startsWith('1900');
    const inside = new Date(t + (first ? 0 : -1));
    const outside = new Date(t + (first ? -1 : 0));
    await provider.ensure(inside, ['triton'], { prefetch: false });
    const a = provider.frame(inside).bodies.get('triton');
    const b = provider.frame(outside).bodies.get('triton');
    assert.ok(a.relativeKm.distanceTo(b.relativeKm) < 0.03, `${boundary}: boundary jump ${a.relativeKm.distanceTo(b.relativeKm)} km`);
    assert.match(b.model, /二体轨道外推/);
  }
  provider.dispose();
});
