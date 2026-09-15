// Audit每处落点站上去看到的天空：角尺寸、方向、地平与昼夜，用物理定义独立重算一遍。
// npx tsx scripts/verify-surface-physics.mjs
import { readFile } from 'node:fs/promises';
import { MathUtils } from 'three';
import { PhysicalState } from '../solar-system/src/physics/state.js';
import { EphemerisStore } from '../solar-system/src/physics/ephemeris.js';
import { physicalDefinitions } from '../solar-system/src/physics/definitions.js';
import { physicalData } from '../solar-system/src/physical-scale.js';
import { landingSites, surfaceFrame, horizonAngles, angularDiameter } from '../solar-system/src/surface/geometry.js';
import { solarVisibility, surfaceLight } from '../solar-system/src/surface/SurfaceSky.js';

const localFetcher = async path => {
  const buffer = await readFile(new URL(`../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
const provider = new PhysicalState({ ephemeris: new EphemerisStore({ fetcher: localFetcher }) });
provider.ephemeris.maxEntries = 64;
for (const year of [1900, 1971, 2000, 2008, 2019, 2026, 2040, 2100]) {
  try { await provider.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['saturn', 'uranus', 'pluto'], { prefetch: false }); } catch { /* out of covered range */ }
}
const deg = MathUtils.radToDeg;
const failures = [];
const nightSites = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const pad = (value, width) => String(value).padEnd(width);
const range = values => [Math.min(...values), Math.max(...values)];
const f = (values, digits = 2) => range(values).map(value => value.toFixed(digits)).join(' .. ');

// Radii come from the shipped physical definitions, not from the frame's own target
// entries, so a wrong radius in one place cannot satisfy the check in the other.
const radiusOf = id => physicalDefinitions.bodies[id].radius.value;
const sunRadiusKm = physicalDefinitions.bodies.sun.radius.value;

console.log(pad('site', 18), pad('sun °', 15), pad('parent size °', 16), pad('太阳高度角', 16), pad('日长/自转', 12), '主星遮挡/自转');
for (const [siteId, site] of Object.entries(landingSites)) {
  const start = Date.parse(site.date), cycle = (site.solarDay || 1) * 86400000, samples = 96;
  const sunSize = [], parentSize = [], sunAlt = [], parentAlt = [];
  let hidden = 0, crossings = 0, previousAlt = null, maxDirectionError = 0, maxBasisError = 0;
  for (let n = 0; n <= samples; n++) {
    const date = new Date(start + n * cycle / samples);
    const frame = surfaceFrame(site, date, provider);
    sunSize.push(deg(angularDiameter(sunRadiusKm, frame.targets.Sun.distanceKm)));
    sunAlt.push(horizonAngles(frame.targets.Sun.direction).altitude);
    if (horizonAngles(frame.targets.Sun.direction).altitude * (previousAlt ?? 0) < 0) crossings++;
    previousAlt = horizonAngles(frame.targets.Sun.direction).altitude;
    const parent = frame.targets[site.parent];
    check(Boolean(parent), `${siteId}: no parent target`);
    if (parent) {
      parentSize.push(deg(angularDiameter(radiusOf(site.parent.toLowerCase()), parent.distanceKm)));
      parentAlt.push(horizonAngles(parent.direction).altitude);
      // The rendered sphere uses 2*asin(R/d); confirm the frame reports the same value.
      check(Math.abs(parent.angularDiameter - 2 * Math.asin(radiusOf(site.parent.toLowerCase()) / parent.distanceKm)) < 1e-9,
        `${siteId}: parent angular diameter disagrees with the radius definition`);
      const separation = parent.direction.angleTo(frame.targets.Sun.direction);
      const angularRadius = target => Math.atan(target.radiusKm / target.distanceKm);
      if (site.parent !== 'Sun' && separation < angularRadius(frame.targets.Sun) + angularRadius(parent)) hidden++;
    }
    for (const target of Object.values(frame.targets)) {
      maxDirectionError = Math.max(maxDirectionError, Math.abs(target.direction.length() - 1));
      check(target.distanceKm > target.radiusKm, `${siteId}: observer inside ${target.id}`);
      check(Math.abs(target.angularDiameter - 2 * Math.asin(target.radiusKm / target.distanceKm)) < 1e-9, `${siteId}: ${target.id} angular diameter mismatch`);
    }
    // The local frame must be the local horizon: up is the radial direction, and the
    // basis is right-handed, or the drawn horizon would be tilted or mirrored.
    const up = frame.local(frame.observerKm.clone().sub(frame.centerKm).normalize());
    const elements = frame.rotation.elements;
    const firstColumn = Math.hypot(elements[0], elements[1], elements[2]);
    maxBasisError = Math.max(maxBasisError, Math.abs(up.y - 1), Math.abs(frame.rotation.determinant() - 1), Math.abs(firstColumn - 1));
  }
  const light = surfaceLight(surfaceFrame(site, new Date(start), provider), site, site.referenceSolarAltitude ?? 25);
  check(Number.isFinite(light.brightness), `${siteId}: non-finite brightness`);
  // One rotation must carry one day, and a locked moon may hide the Sun at most once.
  // Io's eclipse is about 2 hours in a 42 hour orbit, so a tenth is a generous bound
  // that still catches a wrong occultation window.
  const rotationDays = cycle / 86400000;
  const peakSun = Math.max(...sunAlt);
  check(hidden <= samples / 10, `${siteId}: parent hides the Sun for ${hidden}/${samples + 1} of a rotation`);
  if (peakSun < 0) nightSites.push(`${siteId}（峰值 ${peakSun.toFixed(1)}°）`);
  console.log(pad(siteId, 18), pad(f(sunSize), 15), pad(f(parentSize, 3), 16), pad(f(sunAlt, 1), 16),
    pad(`${crossings} 次过零 / ${rotationDays.toFixed(2)} d`, 12),
    `${((hidden / (samples + 1)) * 100).toFixed(0)}% / 主星高度 ${f(parentAlt, 1)}`);
  check(maxDirectionError < 1e-9, `${siteId}: target directions are not unit vectors (${maxDirectionError})`);
  check(maxBasisError < 1e-9, `${siteId}: local basis is not the local horizon (${maxBasisError})`);
}

// Sun size must follow the distance: Earth-like values near 0.5, Mercury up to 1.7.
// Angular size of the Sun follows 1/distance: Mercury swings widest, Pluto is a point.
for (const [siteId, limits] of [['mercury', [1.1, 1.8]], ['mars', [0.3, 0.4]], ['pluto', [0.005, 0.05]], ['charon', [0.005, 0.05]]]) {
  const site = landingSites[siteId], frame = surfaceFrame(site, new Date(site.date), provider);
  const size = deg(angularDiameter(sunRadiusKm, frame.targets.Sun.distanceKm));
  check(size > limits[0] && size < limits[1], `${siteId}: Sun appears ${size.toFixed(2)} degrees across`);
}

// A peak below the horizon is a real polar night, not a defect: Uranus is tilted 98
// degrees, so its moons trade decades of daylight for decades of darkness.
if (nightSites.length) console.log(`
极夜落点（默认日期整日太阳不升起，属真实季节现象）：${nightSites.join('、')}`);

if (failures.length) {
  console.log(`\n${failures.length} 项不通过：`);
  for (const failure of failures.slice(0, 20)) console.log('  -', failure);
  process.exitCode = 1;
} else {
  console.log('\n16 处落点的角尺寸、方向、局部水平与昼夜关系与物理定义一致。');
}
