import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import { readFileSync } from 'node:fs';
import {
  RING_TABLE, RING_INNER_KM, RING_OUTER_KM, RING_INNER, RING_OUTER,
  SATURN_EQUATORIAL_KM, opticalDepthAt, ringUvAtRatio, ringRadiusUnit,
  createRingOpticalDepthTexture, albedoAt, surgeAt, RING_PHASE_G,
  RING_SURGE_HWHM_DEG, RING_SURGE_SCALE_RAD, RING_COLOUR_RATIO, particleColour,
  RING_TAU_PROFILE, MEASURED_FROM_KM,
} from '../src/ring-optical-depth.js';

// The PDS vital-statistics table lists a range per feature; the module stores the
// midpoint, so values are checked to fall inside the published range instead of
// against a hand-copied number.
const PDS_RANGE = {
  'D ring': [1e-5, 1e-3], 'C ring': [0.05, 0.35],
  // Named ringlets, from the PDS Atmospheres ring table. These are the fine structure
  // the ring averages hide, so their values must come from that table and not from the
  // surrounding ring, which the test would otherwise accept.
  'Titan Ringlet': [3.6, 4.4], 'Maxwell Ringlet': [1, 3], 'Bond Ringlet': [0.9, 1.1],
  'Dawes Ringlet': [0.2, 1], 'Huygens Ringlet': [1, 2], 'Herschel Ringlet': [0.08, 0.12],
  'Laplace Ringlet': [0.9, 1.1],
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

test('optical depth is read from the measured profile and is zero outside the ring system', () => {
  assert.equal(opticalDepthAt(RING_INNER_KM - 1), 0);
  assert.equal(opticalDepthAt(RING_OUTER_KM + 1), 0);
  // Every radius inside the measured span must come back as the profile sample for that
  // kilometre, not as a region average; that is the whole point of the profile.
  const sample = km => RING_TAU_PROFILE.tau[Math.round(km - MEASURED_FROM_KM)] / RING_TAU_PROFILE.scale;
  for (const km of [80000, 100000, 110000, 119000, 133500, 140000]) {
    assert.equal(opticalDepthAt(km), sample(km), `${km} km did not read the profile`);
    assert.equal(opticalDepthAt(km + 0.4), sample(km), `${km + 0.4} km did not round to its kilometre`);
  }
  // The D ring keeps its published anchor: no full-coverage occultation resolves it.
  assert.equal(opticalDepthAt(70000), RING_TABLE[0][3], 'the D ring must keep its published value');
  assert.equal(RING_TABLE[0][0], 'D ring');
  // The named gaps must still read far below their neighbours or the shadow loses its
  // banding, and the profile has to agree with the published structure.
  assert.ok(opticalDepthAt(133500) < opticalDepthAt(130000) / 10, 'the Encke gap is not a gap in the profile');
  assert.ok(opticalDepthAt(136500) < opticalDepthAt(135000) / 5, 'the Keeler gap is not a gap in the profile');
  assert.ok(opticalDepthAt(119000) < opticalDepthAt(125000) / 3, 'the Cassini Division is not a gap in the profile');
  // Named ringlets have to stand out from the ring they sit in, or the kilometre-scale
  // profile is not resolving them.
  for (const [name, inner, outer, surrounding] of [
    ['Titan Ringlet', 77869, 77894, 77500],
    ['Maxwell Ringlet', 87499, 87519, 87348],
    ['Huygens Ringlet', 117790, 117820, 117541],
    ['Laplace Ringlet', 120050, 120070, 119900],
  ]) {
    const peak = Math.max(...Array.from({ length: outer - inner + 1 }, (_, i) => opticalDepthAt(inner + i)));
    assert.ok(peak > opticalDepthAt(surrounding) * 3,
      `${name}: peak ${peak.toFixed(3)} against ${opticalDepthAt(surrounding).toFixed(3)} in the surrounding ring`);
  }
});

test('the shipped profile is the occultation it claims to be', () => {
  const source = RING_TAU_PROFILE.source;
  assert.ok(source.url.includes('COUVIS_8001'), 'the profile must name its data set');
  assert.equal(source.retrieved, '2026-09-15');
  assert.equal(source.product, RING_TAU_PROFILE.source.product);
  assert.ok(source.url.endsWith(source.product), 'the product name and the URL must agree');
  assert.equal(source.radialResolutionKm, 1, 'the source is a 1 km profile');
  assert.ok(source.ringEventElevationDeg > 60, 'the profile must be the steepest available, see the build script');
  assert.equal(RING_TAU_PROFILE.stepKm, 1);
  assert.equal(RING_TAU_PROFILE.samples, RING_OUTER_KM - RING_INNER_KM + 1 - (MEASURED_FROM_KM - RING_INNER_KM));
  // Undefined samples are interpolated, so the count is recorded rather than hidden.
  assert.ok(RING_TAU_PROFILE.interpolatedSamples > 0);
  assert.ok(RING_TAU_PROFILE.interpolatedSamples < RING_TAU_PROFILE.samples * .05,
    `${RING_TAU_PROFILE.interpolatedSamples} of ${RING_TAU_PROFILE.samples} samples are interpolated`);
  const tau = RING_TAU_PROFILE.tau;
  assert.ok(tau.every(value => value >= 0 && value < 20000), 'the profile carries an impossible optical depth');
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

  // Particle colour is a measured red-to-blue ratio per ring region, not a flat tint.
  // Lumme, Irvine & Esposito 1983 give the B ring particles' geometric albedo at red and
  // blue wavelengths as 0.61 and 0.41, a ratio of 1.49.
  assert.ok(Math.abs(RING_COLOUR_RATIO - 0.61 / 0.41) < 1e-12);
  const colour = particleColour(RING_COLOUR_RATIO);
  assert.equal(colour[0], 1, 'normalised to the red channel');
  assert.ok(colour[2] < colour[1] && colour[1] < colour[0], 'redder than blue');
  assert.ok(Math.abs(colour[0] / colour[2] - RING_COLOUR_RATIO) < 1e-12, 'the ratio must survive the construction');
  assert.deepEqual(particleColour(1), [1, 1, 1], 'a neutral ratio must give a neutral colour');
});

test('the colour ratio follows the measured ordering of the rings', () => {
  // Measured: the B ring anchors the value, the A ring is at least as red, and the C
  // ring and Cassini Division are the least red (Estrada & Cuzzi 1996, restated in the
  // 2002 erratum). The table has to keep that ordering or the render is not using it.
  const ratio = (km) => {
    const row = RING_TABLE.find(([, inner, outer]) => km >= inner && km < outer);
    return row?.[6];
  };
  assert.equal(ratio(100000), 1.49, 'B ring');
  assert.equal(ratio(76000), 1.0, 'C ring');
  assert.equal(ratio(128000), 1.49, 'A ring');
  assert.equal(ratio(119000), 1.0, 'Cassini Division');
  assert.ok(ratio(100000) > ratio(76000), 'the B ring must be redder than the C ring');
  assert.ok(ratio(128000) >= ratio(100000), 'the A ring must not be less red than the B ring');
  for (const [, inner, outer, , , , value] of RING_TABLE) {
    assert.ok(inner < outer && value >= 1 && value <= 2, 'colour ratio out of range');
  }
  // The generated kilometre-scale regions inherit it from the anchor they fall inside.
  const regions = JSON.parse(readFileSync(new URL('../src/ring-regions.json', import.meta.url), 'utf8')).regions;
  const regionRatio = (km) => regions.find(([, inner, outer]) => km >= inner && km < outer)?.[6];
  assert.equal(regionRatio(100000), 1.49, 'a measured B-ring region must keep the ratio');
  assert.equal(regionRatio(80000), 1.0, 'a C-ring region must keep the ratio');
  assert.equal(regionRatio(128000), 1.49, 'an A-ring region must keep the ratio');
  assert.equal(regions[0][6], 1.0, 'the D ring takes the C ring value');
});

test('every kilometre-scale region carries the mean of the profile it was cut from', () => {
  // The build script derives each region's optical depth as the mean of the profile over
  // its span. Nothing else re-derives that, so a bug in the cutting step would ship
  // regions that no longer describe the measurement.
  const regions = JSON.parse(readFileSync(new URL('../src/ring-regions.json', import.meta.url), 'utf8')).regions;
  const profile = RING_TAU_PROFILE, scale = profile.scale, start = profile.startKm;
  let measured = 0;
  for (const [name, inner, outer, value] of regions) {
    if (inner < MEASURED_FROM_KM) continue;          // the D ring keeps its published anchor
    const from = inner - start, to = outer - start;
    assert.ok(from >= 0 && to <= profile.samples, `${name} ${inner}-${outer}: outside the measured profile`);
    let sum = 0;
    for (let index = from; index < to; index++) sum += profile.tau[index] / scale;
    const mean = sum / (to - from);
    // The shipped value is rounded to four decimals by the build script.
    assert.ok(Math.abs(mean - value) <= 5e-4, `${name} ${inner}-${outer}: region says ${value}, profile mean is ${mean.toFixed(4)}`);
    measured++;
  }
  assert.equal(measured, regions.length - 1, 'every region but the D ring must come from the profile');
  // And the regions must tile the measured span without gaps or overlaps.
  const sorted = regions.slice(1).sort((left, right) => left[1] - right[1]);
  assert.equal(sorted[0][1], MEASURED_FROM_KM, 'the regions must start at the measured edge');
  assert.equal(sorted.at(-1)[2], RING_OUTER_KM, 'the regions must reach the outer edge');
  for (let index = 1; index < sorted.length; index++)
    assert.equal(sorted[index][1], sorted[index - 1][2], `gap or overlap at ${sorted[index][1]} km`);
});

test('the generated profile texture matches the profile it is built from', () => {
  const texture = createRingOpticalDepthTexture();
  assert.equal(texture.image.width, 16384);
  assert.equal(texture.image.height, 1);
  const samples = texture.image.data;
  const span = RING_OUTER_KM - RING_INNER_KM;
  // A texel samples the profile at its own centre, so the comparison has to use that
  // radius rather than the row midpoint: at 4.5 km per texel the difference matters
  // inside a ringlet that is only twenty kilometres wide.
  const step = span / (samples.length / 4);
  const texel = (km) => {
    const index = Math.min(samples.length / 4 - 1, Math.max(0, Math.floor((km - RING_INNER_KM) / step)));
    return { value: DataUtils.fromHalfFloat(samples[index * 4]), radiusKm: RING_INNER_KM + (index + 0.5) * step };
  };
  for (const [name, inner, outer, tau] of RING_TABLE) {
    const { value, radiusKm } = texel((inner + outer) / 2);
    const expected = MEASURED_FROM_KM <= radiusKm ? opticalDepthAt(radiusKm) : tau;
    assert.ok(Math.abs(value - expected) <= Math.max(expected * .05, .002),
      `${name}: texel ${value} at ${radiusKm.toFixed(1)} km drifted from ${expected}`);
  }
  const ringlet = Math.max(...Array.from({ length: 25 }, (_, i) => texel(77870 + i).value));
  assert.ok(ringlet > 1, `the Titan ringlet came through the texture at only ${ringlet}`);
  // The C ring and the B ring have to stay distinguishable: a profile that flattened
  // everywhere would pass every check above.
  assert.ok(texel(105000).value > texel(85000).value * 10, 'the B ring is not denser than the C ring');
  texture.dispose();
});
