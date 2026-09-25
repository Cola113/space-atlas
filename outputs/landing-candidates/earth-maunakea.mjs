// 复算冒纳凯阿（Mauna Kea）落点的月亮几何：本项目星历 + IAU 姿态，独立于提示与展示层。
// npx tsx outputs/landing-candidates/earth-maunakea.mjs
// 落点未登记前先在这里用同一套 surfaceFrame 计算；登记后 landingSites.earth 与这些数一致。
import { readFile } from 'node:fs/promises';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { physicalData } from '../../solar-system/src/physical-scale.js';
import { surfaceFrame, horizonAngles } from '../../solar-system/src/surface/geometry.js';

physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 64;

// Puʻu Wekiu（冒纳凯阿山顶），19.8207°N / 155.4681°W → IAU 东经 204.5319°。
const site = {
  id: 'earth', parent: 'Sun', latitude: 19.8207, longitude: 204.5319,
  radiusKm: physicalData.earth.radiusKm, parentRadiusKm: physicalData.sun.radiusKm,
  date: '2026-09-27T05:30:00Z',
};

const sample = date => {
  const frame = surfaceFrame(site, date);
  const moon = horizonAngles(frame.targets.Moon.direction);
  const sun = horizonAngles(frame.targets.Sun.direction);
  const elongation = frame.targets.Moon.direction.angleTo(frame.targets.Sun.direction) * 180 / Math.PI;
  return { moon, sun, elongation,
    diameter: frame.targets.Moon.angularDiameter * 180 / Math.PI,
    illumination: (1 - Math.cos(frame.targets.Moon.direction.angleTo(frame.targets.Sun.direction))) / 2 };
};
const range = values => `${Math.min(...values).toFixed(1)}° .. ${Math.max(...values).toFixed(1)}°`;

// 交点周期（约 18.6 年）6 小时粗扫只用于确认天顶级最大值——6h 步长会错过中天，
// "每日最高"的极小值不可信；最低中天改用大摆动年（δ 最负的夏季）20 分钟细扫。
{
  const altitudes = [];
  for (let t = Date.parse('2007-10-01T00:00:00Z'); t <= Date.parse('2026-06-01T00:00:00Z'); t += 6 * 3600000)
    altitudes.push(sample(new Date(t)).moon.altitude);
  console.log(`交点周期粗扫最高（2007-10 至 2026-06，6h 步长，${altitudes.length} 帧）${Math.max(...altitudes).toFixed(1)}°`);
  const fine = [];
  for (let t = Date.parse('2025-06-01T00:00:00Z'); t <= Date.parse('2025-09-05T00:00:00Z'); t += 20 * 60000) {
    const s = sample(new Date(t));
    fine.push({ t, altitude: s.moon.altitude });
  }
  const perDay = 72;
  const dailyMax = fine.slice(0, fine.length - perDay)
    .map((_, i) => Math.max(...fine.slice(i, i + perDay + 1).map(f => f.altitude)));
  console.log(`大摆动夏季最低中天（2025-06 至 2025-09，20min 步长）${Math.min(...dailyMax).toFixed(1)}°`);
}

// 满月（亮度比例升穿 99.5%）前后 13 小时内的最高高度角：满月中天高度的近年分布。
{
  const start = Date.parse('2025-01-01T00:00:00Z'), end = Date.parse('2027-12-31T00:00:00Z');
  const grid = [];
  for (let t = start; t <= end; t += 3600000) grid.push({ t, ...sample(new Date(t)) });
  const full = [];
  for (let i = 1; i < grid.length; i++)
    if (grid[i - 1].illumination < .995 && grid[i].illumination >= .995) {
      const around = grid.filter(g => Math.abs(g.t - grid[i].t) <= 13 * 3600000).map(g => g.moon.altitude);
      full.push({ t: grid[i].t, culmination: Math.max(...around) });
    }
  console.log(`满月中天高度（2025-2027，${full.length} 次）${range(full.map(f => f.culmination))}`);
  const zenith = full.filter(f => f.culmination > 84);
  console.log(`满月中天过 84° 的日期：${zenith.map(f => new Date(f.t).toISOString().slice(0, 10)).join('、') || '无'}`);
}

// 默认资料时刻候选：中秋满月窗口，夏威夷当地 9 月 26 日傍晚到夜里。
for (const utc of ['2026-09-27T04:30:00Z', '2026-09-27T05:30:00Z', '2026-09-27T06:30:00Z', '2026-09-27T07:30:00Z']) {
  const s = sample(new Date(Date.parse(utc)));
  console.log(`${utc}（夏威夷 ${new Date(Date.parse(utc) - 10 * 3600000).toISOString().slice(11, 16)}）` +
    ` 月亮 高度 ${s.moon.altitude.toFixed(1)}° 方位 ${s.moon.azimuth.toFixed(1)}° 视直径 ${(s.diameter * 60).toFixed(1)}′ 亮度比例 ${(s.illumination * 100).toFixed(1)}%` +
    ` | 太阳 高度 ${s.sun.altitude.toFixed(1)}°`);
}

// 月亮视直径的极端值（2026-2027 超级月亮窗口内每 6 小时）。
{
  const diameters = [];
  for (let t = Date.parse('2026-01-01T00:00:00Z'); t <= Date.parse('2027-12-31T00:00:00Z'); t += 6 * 3600000)
    diameters.push(sample(new Date(t)).diameter);
  console.log(`月亮视直径（2026-2027，6h 步长）${(Math.min(...diameters) * 60).toFixed(2)}′ .. ${(Math.max(...diameters) * 60).toFixed(2)}′`);
}
