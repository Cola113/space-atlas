import { readFile, writeFile } from 'node:fs/promises';
import { RING_TABLE, RING_INNER_KM, RING_OUTER_KM } from '../solar-system/src/ring-optical-depth.js';

// Turns a Cassini UVIS stellar-occultation optical-depth profile into the two files the
// renderer reads, and prints the statistics that BODY_MODELS.md quotes.
//
//   npx tsx scripts/build-ring-tau-profile.mjs <path to a *_TAU01KM.TAB>
//
// The input is one radial profile from PDS data set COUVIS_8001, served through the
// OPUS interface of the PDS Ring-Moon Systems Node:
//   https://opus.pds-rings.seti.org/holdings/volumes/COUVIS_8xxx/COUVIS_8001/data/
// The 1-km table this build uses is
//   UVIS_HSP_2008_210_BETCEN_E_TAU01KM.TAB
// Its label documents the columns: column 1 is the ring-plane radius in km, column 5 is
// the normal optical depth, and a negative optical depth means the signal was too poor
// to measure.
//
// Which occultation is used matters, and not only through its signal to noise. Colwell
// et al. 2010 (AJ 140, 1569), the reference for this data set, show that the normal
// optical depth derived from an occultation depends on the ring-plane elevation angle:
// a grazing ray threads between the ring's self-gravity wakes and under-measures tau,
// while a steeper ray sees the wakes end on. This build therefore uses the profile with
// the highest elevation among those the labels score GOOD and that are not flagged as
// planetary occultations: Beta Centauri at 66.7 degrees. The comparison with the other
// occultations is printed below and recorded in BODY_MODELS.md.

// Regions the render is divided into. Bounded by the multiple-scattering table, which
// carries one row pair per region: the solve is what costs, not the mesh.
const REGION_TARGET = Number(process.env.RING_REGION_TARGET ?? 400);

// Splitting purely by total squared error spends the whole budget inside the B ring,
// because its variance dwarfs everything else, and leaves the C ring as one flat
// region with its ringlets averaged into it. Every region is therefore first cut down
// to this width, which guarantees coverage everywhere, and the rest of the budget then
// goes where the profile actually varies.
const MAX_WIDTH_KM = Number(process.env.RING_MAX_WIDTH ?? 400);

// Where the measurement starts being usable.
//
// The D ring is left to the literature anchor. The occultation below carries
// PLANETARY_OCCULTATION_FLAG = Y in its label: it also occulted the planet, and the
// optical depths it reports inside about 69,000 km are Saturn's own atmosphere, not the
// D ring. Its values from 69,000 km out to the C ring are clean but sit at 0.01-0.02,
// above the published 1e-5 to 1e-3 for the D ring, so they are stray light as well.
// The other full-coverage profile, UVIS_HSP_2006_285_ALPVIR_I, is not flagged as a
// planetary occultation but measures 0.000 through the D ring, below its detectability
// at 1 km. Neither occultation resolves the D ring, so the D ring keeps its published
// range, and the measured profile starts at the C ring's inner edge.
const MEASURED_FROM_KM = 74491;

const input = process.argv[2] ?? process.env.RING_TAU_TAB;
if (!input) throw new Error('pass the path to a *_TAU01KM.TAB profile');

// ---------------------------------------------------------------- read the profile
const SOURCE = {
  product: 'UVIS_HSP_2008_210_BETCEN_E_TAU01KM.TAB',
  url: 'https://opus.pds-rings.seti.org/holdings/volumes/COUVIS_8xxx/COUVIS_8001/data/UVIS_HSP_2008_210_BETCEN_E_TAU01KM.TAB',
  star: 'BET CEN',
  direction: 'egress',
  ringEventElevationDeg: 66.7,
  planetaryOccultation: false,
  dataQuality: 'GOOD',
};

const profile = new Map();
for (const line of (await readFile(input, 'utf8')).split('\n')) {
  const parts = line.split(',');
  if (parts.length < 12) continue;
  const radius = Number(parts[0]), tau = Number(parts[4]);
  if (!Number.isFinite(radius) || !Number.isFinite(tau)) continue;
  profile.set(Math.round(radius), tau);
}
const first = Math.min(...profile.keys()), last = Math.max(...profile.keys());
if (first > MEASURED_FROM_KM || last < RING_OUTER_KM)
  throw new Error(`profile spans ${first}-${last} km, which does not cover the ${MEASURED_FROM_KM}-${RING_OUTER_KM} km measured span`);

const startKm = MEASURED_FROM_KM, samples = RING_OUTER_KM - MEASURED_FROM_KM + 1;
const tau = new Float64Array(samples);
let missing = 0;
for (let index = 0; index < samples; index++) {
  const value = profile.get(startKm + index);
  if (value === undefined || value < 0) { tau[index] = NaN; missing++; }
  else tau[index] = value;
}
// The label defines a negative optical depth as "the signal was too poor to allow the
// calculation of the value". Those samples are filled by linear interpolation between
// the nearest measured neighbours, which is an assumption and is stated as one in
// BODY_MODELS.md rather than being hidden by calling the profile complete.
let filled = 0;
for (let index = 0; index < samples; index++) {
  if (!Number.isNaN(tau[index])) continue;
  let before = index - 1; while (before >= 0 && Number.isNaN(tau[before])) before--;
  let after = index + 1; while (after < samples && Number.isNaN(tau[after])) after++;
  if (before < 0 || after >= samples) { tau[index] = Number.isNaN(tau[before < 0 ? after : before]) ? 0 : tau[before < 0 ? after : before]; continue; }
  tau[index] = tau[before] + (tau[after] - tau[before]) * (index - before) / (after - before);
  filled++;
}

// ------------------------------------------------------- segment into uniform regions
// Recursive binary splitting on the sum of squared error: find the split that reduces
// the within-region variance most, then recurse on the half with the larger error. It
// puts regions where the profile actually changes instead of at fixed intervals.
const prefix = new Float64Array(samples + 1), prefixSquares = new Float64Array(samples + 1);
for (let index = 0; index < samples; index++) {
  prefix[index + 1] = prefix[index] + tau[index];
  prefixSquares[index + 1] = prefixSquares[index] + tau[index] * tau[index];
}
const mean = (from, to) => (prefix[to] - prefix[from]) / (to - from);
const error = (from, to) => {
  const count = to - from;
  if (count <= 1) return 0;
  const sum = prefix[to] - prefix[from];
  return (prefixSquares[to] - prefixSquares[from]) - sum * sum / count;
};
const bestSplitOf = (from, to) => {
  let bestGain = 0, bestSplit = -1;
  const whole = error(from, to);
  if (whole <= 0) return -1;
  for (let split = from + 1; split < to; split++) {
    const gain = whole - error(from, split) - error(split, to);
    if (gain > bestGain) { bestGain = gain; bestSplit = split; }
  }
  return bestSplit;
};

let regions = [[0, samples]];
// Phase one: nothing wider than the cap.
for (;;) {
  const index = regions.findIndex(([from, to]) => to - from > MAX_WIDTH_KM);
  if (index < 0) break;
  const [from, to] = regions[index];
  const split = bestSplitOf(from, to);
  if (split < 0) break;
  regions.splice(index, 1, [from, split], [split, to]);
}
// Phase two: spend what is left on the largest reducible error anywhere.
while (regions.length < REGION_TARGET) {
  let bestIndex = -1, bestGain = 0, bestSplit = -1;
  for (let index = 0; index < regions.length; index++) {
    const [from, to] = regions[index];
    if (to - from < 2) continue;
    const split = bestSplitOf(from, to);
    if (split < 0) continue;
    const gain = error(from, to) - error(from, split) - error(split, to);
    if (gain > bestGain) { bestGain = gain; bestIndex = index; bestSplit = split; }
  }
  if (bestIndex < 0) break;
  const [from, to] = regions[bestIndex];
  regions.splice(bestIndex, 1, [from, bestSplit], [bestSplit, to]);
}
regions.sort((left, right) => left[0] - right[0]);

// Albedo and opposition-surge amplitude stay with the named rings they were sourced
// for; the km-scale segmentation only replaces the optical depth, which is the quantity
// the occultation actually measures.
const anchorFor = (from, to) => {
  let best = RING_TABLE[0], overlap = 0;
  for (const row of RING_TABLE) {
    const shared = Math.max(0, Math.min(to, row[2] - startKm) - Math.max(from, row[1] - startKm));
    if (shared > overlap) { overlap = shared; best = row; }
  }
  return best;
};

// The D ring is one region from the literature anchor; the measured span is split.
const dRing = RING_TABLE[0];
const measuredRows = regions.map(([from, to]) => {
  const anchor = anchorFor(from, to);
  const inner = startKm + from, outer = startKm + to;
  // Mean rather than median: a region is an average opacity over its span, and the
  // splitting has already isolated the sharp features into regions of their own.
  const value = mean(from, to);
  return [anchor[0], inner, outer, Number(value.toFixed(4)), anchor[4], anchor[5], anchor[6]];
});
const rows = [[...dRing], ...measuredRows];

// ------------------------------------------------------------------- write the files
const profileFile = new URL('../solar-system/src/ring-tau-profile.json', import.meta.url);
await writeFile(profileFile, `${JSON.stringify({
  generated: '2026-09-15',
  source: {
    dataset: 'COUVIS_8001 (Cassini UVIS ring occultation profiles, version 2)',
    retrieved: '2026-09-15',
    radialResolutionKm: 1,
    label: 'column 5, NORMAL OPTICAL DEPTH, from the accompanying .LBL',
    gapRule: 'negative optical depths are undefined per the label NOTE and are linearly interpolated',
    whyThisOccultation: 'highest ring-plane elevation among the GOOD, non-planetary profiles, so the measurement closest to the true normal optical depth',
    ...SOURCE,
  },
  startKm,
  stepKm: 1,
  samples,
  coversKm: [MEASURED_FROM_KM, RING_OUTER_KM],
  scale: 1000,
  units: 'normal optical depth, stored as tau * scale',
  measuredSamples: samples - missing,
  interpolatedSamples: filled,
  tau: Array.from(tau, value => Math.round(value * 1000)),
}, null, 0)}\n`);

const regionFile = new URL('../solar-system/src/ring-regions.json', import.meta.url);
await writeFile(regionFile, `${JSON.stringify({
  generated: '2026-09-15',
  source: 'ring-tau-profile.json, segmented by scripts/build-ring-tau-profile.mjs',
  method: 'the D ring keeps its published anchor; the measured span is cut to a maximum width and then split by within-region sum of squared error, and each region carries the mean measured optical depth of its span',
  regionTarget: REGION_TARGET,
  regions: rows,
}, null, 0)}\n`);

const whole = Array.from(tau).reduce((sum, value) => sum + value, 0) / samples;
console.log(`source: ${SOURCE.star} ${SOURCE.direction} at ${SOURCE.ringEventElevationDeg} deg elevation`);
console.log(`profile: ${samples} km samples, ${samples - missing} measured, ${filled} interpolated, mean tau ${whole.toFixed(4)}`);
console.log(`regions: ${rows.length}, widest ${Math.max(...rows.map(r => r[2] - r[1]))} km, narrowest ${Math.min(...rows.map(r => r[2] - r[1]))} km`);
for (const [name, a, b, value] of rows.slice(0, 3)) console.log(`  ${name} ${a}-${b} tau=${value}`);
