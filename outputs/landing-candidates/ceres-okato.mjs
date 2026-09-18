// Ceres · Occator crater / Cerealia Facula sky geometry, recomputed from this
// project's own ephemeris and IAU attitude model. Read-only: it never touches the app.
//
//   npx tsx outputs/landing-candidates/ceres-okato.mjs
//
// Reports the Sun's altitude range over one rotation and candidate default dates
// whose solar altitude matches the site's reference. Occator is a near-equatorial
// feature, so unlike the polar sites there is no special geometry to work around —
// this script exists to pick a date rather than to discover a constraint, and to
// record the numbers the site card quotes.
import { readFile } from 'node:fs/promises';
import { MathUtils } from 'three';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { physicalData } from '../../solar-system/src/physical-scale.js';
import { surfaceFrame, horizonAngles, angularDiameter } from '../../solar-system/src/surface/geometry.js';

// Read the published year bundles straight from disk; the script never starts a browser.
physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 64;

const deg = MathUtils.radToDeg;
const ROTATION_HOURS = 9.074170; // sidereal rotation period, hours
// NASA/JPL PIA21924 places Cerealia Facula at about 19.7°N, 239.6°E; Occator itself
// is centred at 20°N, 239°E (PIA21906).
const SITE = { id: 'ceres', parent: 'Sun', latitude: 19.7, longitude: 239.6,
  radiusKm: physicalData.ceres.radiusKm, parentRadiusKm: physicalData.sun.radiusKm };

const range = values => [Math.min(...values), Math.max(...values)];
const f = (values, digits = 2) => range(values).map(v => v.toFixed(digits)).join(' .. ');
const sampleDay = (startMs, count = 49) => {
  const sunAlt = [], sunSize = [], sunAz = [];
  for (let n = 0; n < count; n++) {
    const frame = surfaceFrame(SITE, new Date(startMs + n * ROTATION_HOURS * 3600000 / (count - 1)));
    const sun = frame.targets.Sun, angles = horizonAngles(sun.direction);
    sunAlt.push(angles.altitude); sunAz.push(angles.azimuth);
    sunSize.push(deg(angularDiameter(SITE.parentRadiusKm, sun.distanceKm)));
  }
  return { sunAlt, sunSize, sunAz };
};

// surfaceFrame is synchronous, so every year this script touches must be resident first.
for (const year of [2026, 2027]) {
  await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['ceres'], { prefetch: false });
}

console.log('谷神星 · 奥卡托撞击坑（19.8°N / 239.6°E）\n');
console.log('太阳几何（每行覆盖一个 9.0742 地球日的自转周期）\n');
for (const date of ['2026-09-18', '2026-12-21', '2027-03-21']) {
  const { sunAlt, sunSize, sunAz } = sampleDay(Date.parse(`${date}T00:00:00Z`));
  console.log(date, '| 高度角', f(sunAlt), '| 视直径', f(sunSize, 3),
    '| 方位角跨度', (Math.max(...sunAz) - Math.min(...sunAz)).toFixed(1) + '°');
}

// The site card quotes a solar altitude; pick dates whose local value is close to it.
console.log('\n一个自转周期内太阳高度角最接近 22° 的时刻（默认资料时刻候选）\n');
for (const date of ['2026-09-18', '2026-12-21', '2027-03-21']) {
  const start = Date.parse(`${date}T00:00:00Z`);
  let best = { t: start, delta: Infinity, alt: 0 };
  for (let n = 0; n <= 400; n++) {
    const t = start + n * ROTATION_HOURS * 3600000 / 400;
    const frame = surfaceFrame(SITE, new Date(t));
    const alt = horizonAngles(frame.targets.Sun.direction).altitude;
    const delta = Math.abs((alt <= 0 ? -alt * 100 : alt) - 22);
    if (delta < best.delta) best = { t, delta, alt };
  }
  console.log(date, '->', new Date(best.t).toISOString(), '高度角', best.alt.toFixed(2) + '°');
}

// Ceres' parent is the Sun, so there is no parent to eclipse it; the only body that
// could stand in front is another body of the catalogue, all of which are far away.
const frame = surfaceFrame(SITE, new Date('2026-09-18T00:00:00Z'));
const resolvable = [];
for (const [id, target] of Object.entries(frame.targets)) {
  const size = deg(angularDiameter(target.radiusKm, target.distanceKm));
  if (size >= 0.05) resolvable.push(`${id} ${size.toFixed(3)}° 高度角 ${horizonAngles(target.direction).altitude.toFixed(1)}°`);
}
console.log('\n可分辨的其它天体（视直径 ≥ 0.05°）:', resolvable.length ? resolvable.join('   |   ') : '（除太阳外无可分辨天体）');
console.log('太阳在谷神星的视直径约', deg(angularDiameter(SITE.parentRadiusKm, frame.targets.Sun.distanceKm)).toFixed(3) + '°，约为地球所见（0.533°）的',
  (deg(angularDiameter(SITE.parentRadiusKm, frame.targets.Sun.distanceKm)) / 0.533).toFixed(2), '倍');

// Every site in the catalogue is compared on the same numbers. The Saturn, Uranus and
// Pluto systems need their own year bundles, so those are loaded first.
const { landingSites } = await import('../../solar-system/src/surface/geometry.js');
const neededYears = new Set(Object.values(landingSites).map(site => new Date(site.date).getUTCFullYear()));
for (const year of neededYears) {
  await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`),
    ['saturn', 'uranus', 'pluto', 'ceres'], { prefetch: false });
}
console.log('\n现有十八个落点（同一方法，便于比较）\n');
for (const [id, site] of Object.entries(landingSites)) {
  const fr = surfaceFrame(site, new Date(site.date));
  console.log(String(id).padEnd(20), String(`${site.latitude} / ${site.longitude}`).padEnd(18),
    `太阳高度角 ${horizonAngles(fr.targets.Sun.direction).altitude.toFixed(1).padStart(6)}°`);
}
