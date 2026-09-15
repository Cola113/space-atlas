// Characterise the Miranda site's seasons: is it lit at the app's default start date?
import { readFile } from 'node:fs/promises';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { landingSites, surfaceFrame, horizonAngles } from '../../solar-system/src/surface/geometry.js';
physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 400;
const site = landingSites.miranda;
const peak = (time, span) => {
  let best = -Infinity;
  for (let n = 0; n <= 24; n++) best = Math.max(best, horizonAngles(surfaceFrame(site, new Date(time + n * span * 3600000 / 24)).targets.Sun.direction).altitude);
  return best;
};
console.log('Miranda site (18S / 316E) peak solar altitude per year:');
let line = '';
for (let year = 1900; year <= 2100; year += 5) {
  try { await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['uranus'], { prefetch: false }); } catch { continue; }
  const value = peak(Date.parse(`${year}-08-01T00:00:00Z`), site.solarDay);
  line += `${year}:${value.toFixed(0).padStart(4)}°  `;
  if ((year - 1900) % 50 === 45) { console.log(' ', line); line = ''; }
}
console.log(' ', line);
await physicalState.ephemeris.ensure(new Date('1971-01-01T00:00:00Z'), ['uranus'], { prefetch: false });
console.log(`app start 1971-08-01: peak ${peak(Date.parse('1971-08-01T17:00:00Z'), site.solarDay).toFixed(1)}°`);
console.log(`app end   2100-08-01: peak ${peak(Date.parse('2100-08-01T00:00:00Z'), site.solarDay).toFixed(1)}°`);
