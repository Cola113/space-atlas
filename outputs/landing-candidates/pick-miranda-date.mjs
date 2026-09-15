// Miranda's seasons last 21 years: the shipped default date leaves its 18S site in
// permanent night. Find a season where the site is actually lit.
import { readFile } from 'node:fs/promises';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { landingSites, surfaceFrame, horizonAngles, nextDaylight } from '../../solar-system/src/surface/geometry.js';
physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 400;
const site = landingSites.miranda;
const load = async year => { try { await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['uranus'], { prefetch: false }); return true; } catch (error) { console.log(' ', year, 'load failed:', error.message); return false; } };
const peakIn = (start, span) => {
  let peak = { altitude: -Infinity };
  for (let n = 0; n <= 48; n++) {
    const time = start + n * span * 86400000 / 48;
    const altitude = horizonAngles(surfaceFrame(site, new Date(time)).targets.Sun.direction).altitude;
    if (altitude > peak.altitude) peak = { altitude, time };
  }
  return peak;
};
let best = { altitude: -Infinity };
for (let year = 1980; year <= 1992; year += 1) {
  if (!await load(year)) continue;
  const peak = peakIn(Date.parse(`${year}-01-01T00:00:00Z`), site.solarDay * 4);
  if (peak.altitude > best.altitude) best = { ...peak, year };
}
console.log('best epoch:', best.year, 'peak sun', best.altitude.toFixed(1) + '°');
for (const year of [1985, 1986, 2085, 2026]) {
  if (!await load(year)) continue;
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  const peak = peakIn(start, site.solarDay);
  const jump = nextDaylight(site, start);
  console.log(`  ${year}: peak ${peak.altitude.toFixed(1)}° @ ${new Date(peak.time).toISOString()}  日照跳转 -> ${jump ? new Date(jump).toISOString() : '无'}`);
}
