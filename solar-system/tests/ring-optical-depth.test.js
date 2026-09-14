import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import {
  RING_TABLE, RING_INNER_KM, RING_OUTER_KM, RING_INNER, RING_OUTER,
  SATURN_EQUATORIAL_KM, opticalDepthAt, ringUvAtRatio, ringRadiusUnit,
  createRingOpticalDepthTexture, albedoAt, RING_PHASE_G,
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

test('ring albedo follows the measured anchors and the particles backscatter', () => {
  // French et al. 2007 (PASP 119, 623) put the single-scattering albedo at 0.1 for the
  // C ring rising to 0.6 for the B ring; Doyle et al. 1989 (Icarus 80, 104) give a
  // Bond albedo near 0.5 for the A ring, which should land between the two anchors.
  assert.equal(albedoAt(80000), 0.1, 'C ring albedo');
  assert.equal(albedoAt(100000), 0.6, 'B ring albedo');
  assert.ok(albedoAt(128000) > albedoAt(80000) && albedoAt(128000) < albedoAt(100000),
    'A ring albedo must sit between the C and B ring anchors');
  assert.equal(albedoAt(RING_INNER_KM - 1), 0, 'outside the ring system');

  // Backscattering means g < 0, so the phase function peaks where the observer looks
  // along the incoming sunlight rather than away from it.
  assert.ok(RING_PHASE_G < 0, 'ring particles must backscatter');
  const g2 = RING_PHASE_G ** 2;
  const phase = (cos) => (1 - g2) / (1 + g2 + 2 * RING_PHASE_G * cos) ** 1.5;
  assert.ok(phase(1) > phase(0) && phase(0) > phase(-1), 'phase function must peak at backscatter');
  assert.ok(phase(1) / phase(-1) > 10, 'the backscatter peak must be strong');
});

test('the generated profile texture matches the table it is built from', () => {
  const texture = createRingOpticalDepthTexture();
  assert.equal(texture.image.width, 2048);
  assert.equal(texture.image.height, 1);
  const samples = texture.image.data;
  const span = RING_OUTER_KM - RING_INNER_KM;
  for (const [name, inner, outer, tau, albedo] of RING_TABLE) {
    const middle = (inner + outer) / 2;
    const index = Math.floor(((middle - RING_INNER_KM) / span) * (samples.length / 2));
    // Optical depth sits in R and albedo in G; half float carries about three
    // decimal digits, so the comparison is loose but a wrong region or a shifted
    // sample would still fail by a wide margin.
    const decodedTau = DataUtils.fromHalfFloat(samples[index * 2]);
    const decodedAlbedo = DataUtils.fromHalfFloat(samples[index * 2 + 1]);
    assert.ok(Math.abs(decodedTau - tau) <= tau * 1e-3,
      `${name}: profile sample ${decodedTau} drifted from ${tau}`);
    assert.ok(Math.abs(decodedAlbedo - albedo) <= albedo * 1e-3,
      `${name}: albedo sample ${decodedAlbedo} drifted from ${albedo}`);
  }
  texture.dispose();
});
