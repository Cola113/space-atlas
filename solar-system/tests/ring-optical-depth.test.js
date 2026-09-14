import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import {
  RING_TABLE, RING_INNER_KM, RING_OUTER_KM, RING_INNER, RING_OUTER,
  SATURN_EQUATORIAL_KM, opticalDepthAt, ringUvAtRatio, ringRadiusUnit,
  createRingOpticalDepthTexture, albedoAt, surgeAt, RING_PHASE_G,
  RING_SURGE_HWHM_DEG, RING_SURGE_SCALE_RAD, RING_PARTICLE_COLOR,
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
  // The value has to stay in the visible-light range. The far-ultraviolet |g| of
  // 0.63-0.78 that this used to carry describes grains at 155-180 nm, and swapping it
  // back in would push the ratio below this bound.
  assert.ok(Math.abs(RING_PHASE_G) < .5, 'the asymmetry must be the visible particle value, not the FUV one');
  assert.ok(phase(1) / phase(-1) > 4, 'the backscatter peak must be clear');
});

test('the opposition surge is narrow and per-region, and the particle colour is measured', () => {
  // Half width at half maximum near 0.1 degrees at BVRI wavelengths.
  assert.equal(RING_SURGE_HWHM_DEG, 0.1);
  const surge = (alphaDeg, amplitude) => 1 + amplitude * Math.exp(-(alphaDeg * Math.PI / 180) / RING_SURGE_SCALE_RAD);
  for (const amplitude of [0.4, 0.7]) {
    // By construction the exponential is at half height at the half width.
    assert.ok(Math.abs(surge(0.1, amplitude) - (1 + amplitude / 2)) < 1e-12, 'wrong surge half width');
    // And it must be gone long before the phase angles the scene is normally viewed at.
    assert.ok(surge(2, amplitude) - 1 < 1e-5, 'the surge should not reach a few degrees');
    assert.ok(surge(0, amplitude) > surge(0.05, amplitude), 'the surge must fall with phase angle');
  }
  // The measured amplitudes: C ring strongest, outer A ring strongest of all per
  // French et al. 2007, B ring weakest. Interpolated regions stay between the anchors.
  assert.equal(surgeAt(80000), 0.6, 'C ring');
  assert.equal(surgeAt(100000), 0.4, 'B ring');
  assert.equal(surgeAt(128000), 0.4, 'inner A ring');
  assert.equal(surgeAt(135000), 0.7, 'outer A ring');
  assert.equal(surgeAt(119000), 0.5, 'Cassini Division sits between its neighbours');
  assert.equal(surgeAt(RING_INNER_KM - 1), 0, 'outside the ring system');
  assert.ok(surgeAt(100000) < surgeAt(80000) && surgeAt(80000) < surgeAt(135000),
    'the measured ordering of the surge amplitudes must survive');

  // Particle colour: red over blue from the measured B-ring geometric albedos
  // 0.61 and 0.41. Green is an interpolation, so only the endpoints are checked.
  assert.ok(Math.abs(RING_PARTICLE_COLOR[0] / RING_PARTICLE_COLOR[2] - 0.61 / 0.41) < 1e-12);
  assert.ok(RING_PARTICLE_COLOR[0] === 1 && RING_PARTICLE_COLOR[2] < 1, 'normalised to the red channel');
  assert.ok(RING_PARTICLE_COLOR[2] < RING_PARTICLE_COLOR[1] && RING_PARTICLE_COLOR[1] < RING_PARTICLE_COLOR[0],
    'the particles are redder than they are blue');
});

test('the generated profile texture matches the table it is built from', () => {
  const texture = createRingOpticalDepthTexture();
  assert.equal(texture.image.width, 2048);
  assert.equal(texture.image.height, 1);
  const samples = texture.image.data;
  const span = RING_OUTER_KM - RING_INNER_KM;
  for (const [name, inner, outer, tau, albedo, surge] of RING_TABLE) {
    const middle = (inner + outer) / 2;
    const index = Math.floor(((middle - RING_INNER_KM) / span) * (samples.length / 4));
    // Optical depth sits in R, albedo in G and the surge amplitude in B; half float
    // carries about three decimal digits, so the comparison is loose but a wrong
    // region or a shifted sample would still fail by a wide margin.
    const decodedTau = DataUtils.fromHalfFloat(samples[index * 4]);
    const decodedAlbedo = DataUtils.fromHalfFloat(samples[index * 4 + 1]);
    const decodedSurge = DataUtils.fromHalfFloat(samples[index * 4 + 2]);
    assert.ok(Math.abs(decodedTau - tau) <= tau * 1e-3,
      `${name}: profile sample ${decodedTau} drifted from ${tau}`);
    assert.ok(Math.abs(decodedAlbedo - albedo) <= albedo * 1e-3,
      `${name}: albedo sample ${decodedAlbedo} drifted from ${albedo}`);
    assert.ok(Math.abs(decodedSurge - surge) <= surge * 1e-3,
      `${name}: surge sample ${decodedSurge} drifted from ${surge}`);
  }
  texture.dispose();
});
