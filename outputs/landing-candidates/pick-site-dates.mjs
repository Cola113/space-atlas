// Pick a default instant per site whose ground is actually lit when the user arrives.
import { readFile } from 'node:fs/promises';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { surfaceFrame, horizonAngles, landingSites } from '../../solar-system/src/surface/geometry.js';

physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 64;
for (const year of [2008, 2019, 2026, 2027]) {
  try { await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['saturn', 'uranus', 'pluto'], { prefetch: false }); } catch {}
}
const pad = (v, w) => String(v).padEnd(w);
console.log(pad('site', 20), pad('date set', 22), pad('sun now', 9), pad('best', 26), 'target met');
for (const [siteId, site] of Object.entries(landingSites)) {
  if (!['moon-farside', 'mars-phoenix', 'io-subjovian', 'europa-subjovian', 'mercury-pole', 'pluto-charonface', 'charon'].includes(siteId)) continue;
  const start = Date.parse(site.date), span = (site.solarDay || 1) * 86400000;
  const now = horizonAngles(surfaceFrame(site, new Date(start)).targets.Sun.direction).altitude;
  let best = { altitude: -Infinity };
  for (let n = 0; n <= 400; n++) {
    const time = start + n * span / 400;
    const altitude = horizonAngles(surfaceFrame(site, new Date(time)).targets.Sun.direction).altitude;
    // Prefer the sun near 22 degrees so the ground reads clearly on arrival.
    const score = -Math.abs(altitude - 22);
    if (score > best.score || best.score === undefined) best = { score, altitude, time };
    if (best.score === undefined) best.score = score;
  }
  console.log(pad(siteId, 20), pad(site.date, 22), pad(now.toFixed(1) + '°', 9),
    pad(`${best.altitude.toFixed(1)}° @ ${new Date(best.time).toISOString()}`, 26), best.altitude > 12 ? 'yes' : 'closest available');
}
