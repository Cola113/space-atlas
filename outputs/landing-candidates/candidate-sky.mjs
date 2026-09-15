// Sky geometry at candidate landing positions, recomputed from this project's own
// ephemeris and IAU attitude model. Read-only: it never touches the app.
//
//   npx tsx outputs/landing-candidates/candidate-sky.mjs
//
// Reports, per position: the parent's altitude range and apparent diameter over one
// rotation, the Sun's altitude range, and Earth/Jupiter altitude where relevant.
// Saturnian positions additionally get the ring opening angle, which decides whether
// the rings can be seen open at all from that moon.
import { readFile } from 'node:fs/promises';
import { MathUtils } from 'three';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { physicalData } from '../../solar-system/src/physical-scale.js';
import { surfaceFrame, horizonAngles, angularDiameter, landingSites } from '../../solar-system/src/surface/geometry.js';

const localFetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.fetcher = localFetcher;
physicalState.ephemeris.maxEntries = 64;
const deg = MathUtils.radToDeg;

// Averaged models for the outer systems are stored per year and fetched on demand.
const site = (body, parent, latitude, longitude, date, span) => ({
  id: body, parent, latitude, longitude, date, span,
  radiusKm: physicalData[body].radiusKm, parentRadiusKm: physicalData[parent.toLowerCase()].radiusKm,
});
const candidates = [
  ['月球 · 阿波罗 11 静海基地（现可降落以外的近侧样例）', site('moon', 'Earth', 0.67408, 23.47297, '1969-07-20T20:17:40Z', 29.53)],
  ['月球 · 嫦娥四号天河基地（背面）', site('moon', 'Earth', -45.4446, 177.5991, '2019-01-03T02:26:00Z', 29.53)],
  ['火星 · 毅力号耶泽罗坑', site('mars', 'Sun', 18.4447, 77.4508, '2021-02-18T20:55:00Z', 1.02749)],
  ['火星 · 凤凰号北极', site('mars', 'Sun', 68.2188, 234.2477, '2008-05-25T23:53:00Z', 1.02749)],
  ['火卫一 · 次火星点', site('phobos', 'Mars', 1, 60, '2026-09-15T00:00:00Z', 0.31891)],
  ['火卫一 · 火星压地平线', site('phobos', 'Mars', 1, 150, '2026-09-15T00:00:00Z', 0.31891)],
  ['火卫一 · 斯蒂克尼坑 49°W', site('phobos', 'Mars', 1, 311, '2026-09-15T00:00:00Z', 0.31891)],
  ['冥王星 · 朝冥卫一（现落点为背侧）', site('pluto', 'Charon', 0, 0, '2026-09-15T00:00:00Z', 6.3872)],
  ['冥卫一 · 朝冥王星侧', site('charon', 'Pluto', 0, 0, '2026-09-15T00:00:00Z', 6.3872)],
  ['海卫一 · 南半球高纬', site('triton', 'Neptune', -70, 0, '2026-09-15T00:00:00Z', 5.877)],
  ['水星 · 北极', site('mercury', 'Sun', 88, 0, '2026-09-15T00:00:00Z', 175.94)],
  ['土卫八 · 次土星点', site('iapetus', 'Saturn', 0, 210, '2026-09-15T00:00:00Z', 79.33)],
  ['谷神星 · 奥卡托撞击坑', site('ceres', 'Sun', 19.8, 239.6, '2026-09-15T00:00:00Z', 0.3781)],
  ['木卫一 · 次木星点', site('io', 'Jupiter', 0, 0, '2026-09-15T00:00:00Z', 1.769)],
  ['木卫二 · 次木星点', site('europa', 'Jupiter', 0, 0, '2026-09-15T00:00:00Z', 3.551)],
];

for (const year of new Set(candidates.map(([, s]) => new Date(s.date).getUTCFullYear()).concat(2026))) {
  await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['saturn', 'uranus', 'pluto'], { prefetch: false });
}

const range = values => [Math.min(...values), Math.max(...values)];
const pad = (value, width) => String(value).padEnd(width);

console.log('主星与太阳几何（每行覆盖一个自转周期；月球取朔望月，以包含天平动）\n');
console.log(pad('落点', 34), pad('主星', 9), pad('主星高度角', 16), pad('主星视直径', 15), pad('主星距离 km', 20), '太阳高度角');
for (const [label, s] of candidates) {
  const start = Date.parse(s.date), parentAlt = [], parentSize = [], parentDistance = [], sunAlt = [];
  for (let n = 0; n < 25; n++) {
    const frame = surfaceFrame(s, new Date(start + n * s.span * 86400000 / 24));
    const parent = frame.targets[s.parent];
    parentAlt.push(horizonAngles(parent.direction).altitude);
    parentSize.push(deg(angularDiameter(s.parentRadiusKm, parent.distanceKm)));
    parentDistance.push(parent.distanceKm);
    sunAlt.push(horizonAngles(frame.targets.Sun.direction).altitude);
  }
  const f = (values, digits = 1) => range(values).map(v => v.toFixed(digits)).join(' .. ');
  console.log(pad(label, 34), pad(s.parent, 9), pad(f(parentAlt), 16), pad(f(parentSize, 2), 15),
    pad(f(parentDistance, 0), 20), f(sunAlt));
}

// Earth is the parent of the Moon, so a far-side site is where the two disagree most:
// optical libration still moves Earth, but it can never carry it over the horizon.
console.log('\n地球可见性（月球落点，一个朔望月）\n');
for (const [label, s] of candidates.filter(([, s]) => s.id === 'moon')) {
  const start = Date.parse(s.date), alt = [], az = [];
  for (let n = 0; n < 60; n++) {
    const frame = surfaceFrame(s, new Date(start + n * 29.53 * 86400000 / 59));
    const angles = horizonAngles(frame.targets.Earth.direction);
    alt.push(angles.altitude); az.push(angles.azimuth);
  }
  console.log(pad(label, 34), `高度角 ${range(alt).map(v => v.toFixed(1)).join(' .. ')}°`,
    `  方位角跨度 ${Math.abs(Math.max(...az) - Math.min(...az)).toFixed(1)}°`);
}

console.log('\n可分辨的其它天体（视直径 ≥ 0.05°，同一自转周期窗口）\n');
for (const [label, s] of candidates) {
  const start = Date.parse(s.date), resolvable = new Map();
  for (let n = 0; n < 25; n++) {
    const frame = surfaceFrame(s, new Date(start + n * s.span * 86400000 / 24));
    for (const [id, target] of Object.entries(frame.targets)) {
      const size = deg(angularDiameter(target.radiusKm, target.distanceKm));
      if (size < 0.05) continue;
      const angles = horizonAngles(target.direction);
      const seen = resolvable.get(id) || { size: [Infinity, -Infinity], altitude: [Infinity, -Infinity] };
      seen.size = [Math.min(seen.size[0], size), Math.max(seen.size[1], size)];
      seen.altitude = [Math.min(seen.altitude[0], angles.altitude), Math.max(seen.altitude[1], angles.altitude)];
      resolvable.set(id, seen);
    }
  }
  const f = values => range(values).map(v => v.toFixed(2)).join(' .. ');
  const parts = [...resolvable].map(([id, seen]) => `${id} ${f(seen.size)}° 高度角 ${f(seen.altitude)}°`);
  console.log(pad(label, 34), parts.length ? parts.join('   |   ') : '（除太阳外无可分辨天体）');
}

// The rings lie in Saturn's equatorial plane, so a moon orbiting in that plane sees them
// edge-on no matter where the observer stands. Only an inclined orbit opens them up.
console.log('\n环面张开角（土星卫星，按历元各采样一个轨道周期）\n');
for (const epoch of ['2026-09-15', '2033-01-01', '2040-01-01', '2050-01-01']) {
  const s = site('iapetus', 'Saturn', 0, 210, `${epoch}T00:00:00Z`, 79.33);
  const start = Date.parse(s.date);
  const opening = [], litOpening = [];
  let lit = 0;
  for (let n = 0; n <= 96; n++) {
    const frame = surfaceFrame(s, new Date(start + n * 79.33 * 86400000 / 48));
    const saturn = frame.targets.Saturn;
    const lineOfSight = saturn.positionKm.clone().sub(frame.observerKm).normalize();
    // Positive B turns the northern face of the ring plane toward the observer.
    const B = -deg(Math.asin(MathUtils.clamp(lineOfSight.dot(saturn.orientation.north), -1, 1)));
    const sunAlt = horizonAngles(frame.targets.Sun.direction).altitude;
    opening.push(B);
    if (sunAlt > 5) { lit++; litOpening.push(B); }
  }
  const f = values => range(values).map(v => v.toFixed(1)).join(' .. ');
  console.log(pad(`土卫八 次土星点 ${epoch}`, 34), `张开角 ${f(opening)}°`,
    `  受光采样 ${lit}/97  受光时张开角 ${f(litOpening)}°`);
}

// The sub-parent point is the highest ground for the parent, and it is what a
// "facing the planet" site actually means. Sweep longitude to locate it: on a
// synchronously rotating moon the parent stays put, so this is a fixed spot.
console.log('\n次主星经度扫描（赤道，单一日期的瞬时值）\n');
for (const [label, s] of [
  ['火卫一', site('phobos', 'Mars', 0, 0, '2026-09-15T00:00:00Z', 0.31891)],
  ['土卫八', site('iapetus', 'Saturn', 0, 0, '2026-09-15T00:00:00Z', 79.33)],
  ['冥卫一', site('charon', 'Pluto', 0, 0, '2026-09-15T00:00:00Z', 6.3872)],
  ['冥王星', site('pluto', 'Charon', 0, 0, '2026-09-15T00:00:00Z', 6.3872)],
  ['海卫一', site('triton', 'Neptune', 0, 0, '2026-09-15T00:00:00Z', 5.877)],
  ['木卫一', site('io', 'Jupiter', 0, 0, '2026-09-15T00:00:00Z', 1.769)],
  ['木卫二', site('europa', 'Jupiter', 0, 0, '2026-09-15T00:00:00Z', 3.551)],
]) {
  const cells = [];
  let best = { longitude: 0, altitude: -Infinity };
  for (let longitude = 0; longitude < 360; longitude += 30) {
    const frame = surfaceFrame({ ...s, longitude }, new Date(s.date));
    const altitude = horizonAngles(frame.targets[s.parent].direction).altitude;
    if (altitude > best.altitude) best = { longitude, altitude };
    cells.push(`${String(longitude).padStart(3)}°E ${altitude.toFixed(0).padStart(4)}°`);
  }
  console.log(pad(label, 8), pad(`最高 ${best.longitude}°E ${best.altitude.toFixed(1)}°`, 24), cells.join('  '));
}

console.log('\n现有九个落点（同一方法，便于比较）\n');
for (const [id, s] of Object.entries(landingSites)) {
  const frame = surfaceFrame(s, new Date(s.date));
  const parent = frame.targets[s.parent];
  if (!parent) { console.log(pad(id, 12), '无主星目标'); continue; }
  console.log(pad(id, 12), pad(`${s.latitude} / ${s.longitude}`, 18), pad(s.parent, 9),
    `高度角 ${horizonAngles(parent.direction).altitude.toFixed(1).padStart(6)}°`,
    `视直径 ${deg(angularDiameter(s.parentRadiusKm, parent.distanceKm)).toFixed(2).padStart(6)}°`,
    `太阳高度角 ${horizonAngles(frame.targets.Sun.direction).altitude.toFixed(1).padStart(6)}°`);
}
