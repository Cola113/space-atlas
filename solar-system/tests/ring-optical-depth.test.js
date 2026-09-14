import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import {
  RING_TABLE, RING_INNER_KM, RING_OUTER_KM, RING_INNER, RING_OUTER,
  SATURN_EQUATORIAL_KM, opticalDepthAt, ringUvAtRatio, ringRadiusUnit,
  createRingOpticalDepthTexture,
} from '../src/ring-optical-depth.js';

// The PDS vital-statistics table lists a range per feature; the module stores the
// midpoint, so values are checked to fall inside the published range instead of
// against a hand-copied number.
const PDS_RANGE = {
  'D ring': [1e-5, 1e-3], 'C ring': [0.05, 0.35],
  'B ring B1': [1.1, 1.5], 'B ring B2': [1.5, 5], 'B ring B3': [1, 5],
  'B ring B4': [2, 3], 'B ring B5': [0.5, 5],
  'Cassini Division': [0, 0.2], 'A ring': [0.4, 1], 'A ring outer': [0.4, 1],
  'A ring edge': [0.4, 1], 'F ring': [0.01, 0.2],
};

test('the ring table is ordered, contiguous and inside the published ranges', () => {
  assert.equal(RING_TABLE[0][1], RING_INNER_KM);
  assert.equal(RING_TABLE[RING_TABLE.length - 1][2], RING_OUTER_KM);
  let previousOuter = null;
  for (const [name, inner, outer, tau] of RING_TABLE) {
    assert.ok(inner < outer, `${name}: inverted bounds`);
    assert.ok(Number.isFinite(tau) && tau > 0, `${name}: bad optical depth`);
    if (previousOuter !== null) assert.equal(inner, previousOuter, `${name}: gap or overlap at ${inner} km`);
    previousOuter = outer;
    const range = PDS_RANGE[name];
    if (range) assert.ok(tau >= range[0] && tau <= range[1], `${name}: ${tau} outside the PDS range`);
  }
});

test('optical depth is read by radius and is zero outside the ring system', () => {
  assert.equal(opticalDepthAt(RING_INNER_KM - 1), 0);
  assert.equal(opticalDepthAt(RING_OUTER_KM + 1), 0);
  assert.equal(opticalDepthAt(100000), 2.2, 'mid B ring');
  assert.equal(opticalDepthAt(119000), 0.08, 'Cassini Division');
  assert.equal(opticalDepthAt(133500), 0.02, 'Encke gap');
  // The gaps must read far below their neighbours or the shadow loses its banding.
  assert.ok(opticalDepthAt(133500) < opticalDepthAt(130000) / 10);
  assert.ok(opticalDepthAt(119000) < opticalDepthAt(125000) / 5);
});

test('ring radii and the shadow lookup share one normalised coordinate', () => {
  assert.ok(Math.abs(RING_INNER - 66900 / SATURN_EQUATORIAL_KM) < 1e-12);
  assert.ok(Math.abs(RING_OUTER - 140612 / SATURN_EQUATORIAL_KM) < 1e-12);
  assert.equal(ringUvAtRatio(RING_INNER), 0);
  assert.equal(ringUvAtRatio(RING_OUTER), 1);
  assert.equal(ringRadiusUnit(RING_INNER_KM), 0);
  assert.equal(ringRadiusUnit(RING_OUTER_KM), 1);
  // A radius given in Saturn radii must land on the same coordinate as the same
  // radius given in kilometres, or the shadow and the mesh would disagree.
  for (const km of [70000, 91975, 117500, 136770, 140000]) {
    assert.ok(Math.abs(ringRadiusUnit(km) - ringUvAtRatio(km / SATURN_EQUATORIAL_KM)) < 1e-12);
  }
});

test('the generated profile texture matches the table it is built from', () => {
  const texture = createRingOpticalDepthTexture();
  assert.equal(texture.image.width, 2048);
  assert.equal(texture.image.height, 1);
  const samples = texture.image.data;
  const span = RING_OUTER_KM - RING_INNER_KM;
  for (const [name, inner, outer, tau] of RING_TABLE) {
    const middle = (inner + outer) / 2;
    const index = Math.floor(((middle - RING_INNER_KM) / span) * samples.length);
    const decoded = DataUtils.fromHalfFloat(samples[index]);
    // Half float carries about three decimal digits; the profile is compared loosely
    // but a wrong region or a shifted sample would still fail by a wide margin.
    assert.ok(Math.abs(decoded - tau) <= tau * 1e-3,
      `${name}: profile sample ${decoded} drifted from ${tau}`);
  }
  texture.dispose();
});
