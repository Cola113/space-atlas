import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { localPhysics } from './physical-fixture.js';
import { evaluateEphemeris, MissingEphemerisError } from '../src/physics/ephemeris.js';
import { meanElements, physicalDefinitions } from '../src/physics/definitions.js';
import { bodyOrientation } from '../src/physics/orientation.js';

test('Iapetus SAT441 published yearly bundles match independent JPL Horizons state vectors across 1900–2100', async () => {
  const ref = JSON.parse(await readFile(new URL('./iapetus-reference.json', import.meta.url), 'utf8'));
  assert.equal(ref.horizons.length, 16);
  const provider = localPhysics();
  let maxPosKm = 0;
  let maxVelKmS = 0;
  for (const sample of ref.horizons) {
    const year = Math.max(1900, Math.min(2100, new Date(Date.UTC(2000, 0, 1, 12) + sample.tdbSeconds * 1000).getUTCFullYear()));
    const bundle = await provider.ephemeris.load('saturn', year);
    const relAt = t => new Vector3().fromArray(evaluateEphemeris(bundle, 608, 6, t))
      .sub(new Vector3().fromArray(evaluateEphemeris(bundle, 699, 6, t)));
    const actualPos = relAt(sample.tdbSeconds);
    const actualVel = relAt(sample.tdbSeconds + 1).sub(relAt(sample.tdbSeconds - 1)).multiplyScalar(0.5);
    const posErr = actualPos.distanceTo(new Vector3().fromArray(sample.positionKm));
    const velErr = actualVel.distanceTo(new Vector3().fromArray(sample.velocityKmS));
    maxPosKm = Math.max(maxPosKm, posErr);
    maxVelKmS = Math.max(maxVelKmS, velErr);
    assert.ok(posErr < 0.05, `${sample.tdbCalendar}: posErr ${posErr} km`);
    assert.ok(velErr < 0.005, `${sample.tdbCalendar}: velErr ${velErr} km/s`);
    assert.ok(sample.jplephemDifferenceKm < 0.001, `${sample.tdbCalendar}: Horizons vs jplephem ${sample.jplephemDifferenceKm} km`);
  }
  console.log('Iapetus Horizons reference checks:', { samples: ref.horizons.length, maxPosKm, maxVelKmS });
  provider.dispose();
});

test('Iapetus SAT441 availability, Saturn translation, IAU attitude, and boundaries stay consistent', async () => {
  const provider = localPhysics();
  const date = new Date('2033-01-01T00:00:00Z');
  const before = provider.frame(date);
  assert.equal(before.bodies.has('iapetus'), false);
  assert.throws(() => provider.frame(date, { required: ['iapetus'] }), MissingEphemerisError);

  await provider.ensure(date, ['iapetus'], { prefetch: false });
  const after = provider.frame(date);
  const iapetus = after.bodies.get('iapetus');
  const saturn = after.bodies.get('saturn');
  assert.deepEqual(saturn, before.bodies.get('saturn'), 'loading Iapetus must not change Saturn');
  assert.deepEqual(iapetus.positionKm, saturn.positionKm.clone().add(iapetus.relativeKm));
  assert.match(iapetus.model, /SAT441/);
  assert.equal(iapetus.parent, 'saturn');
  assert.equal(meanElements.bodies.iapetus, undefined);
  assert.equal(physicalDefinitions.bodies.iapetus.rotation.provider, 'iau-pck');
  assert.ok(iapetus.orientation.quaternion.angleTo(bodyOrientation('iapetus', date).quaternion) < 1e-7);

  for (const boundary of ['1900-01-01T00:00:00Z', '2101-01-01T00:00:00Z']) {
    const t = Date.parse(boundary);
    const first = boundary.startsWith('1900');
    const inside = new Date(t + (first ? 0 : -1));
    const outside = new Date(t + (first ? -1 : 0));
    await provider.ensure(inside, ['iapetus'], { prefetch: false });
    const a = provider.frame(inside).bodies.get('iapetus');
    const b = provider.frame(outside).bodies.get('iapetus');
    assert.ok(a.relativeKm.distanceTo(b.relativeKm) < 0.05, `${boundary}: boundary jump ${a.relativeKm.distanceTo(b.relativeKm)} km`);
    assert.match(b.model, /二体轨道外推/);
  }
  provider.dispose();
});
