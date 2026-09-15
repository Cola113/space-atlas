// Parent occultation at each site's default instant, and a lit uneclipsed alternative.
import { readFile } from 'node:fs/promises';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { surfaceFrame, horizonAngles, landingSites } from '../../solar-system/src/surface/geometry.js';
import { solarVisibility, surfaceLight } from '../../solar-system/src/surface/SurfaceSky.js';

physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 64;
for (const year of [2008, 2019, 2026, 2027]) await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['saturn', 'uranus', 'pluto'], { prefetch: false });
const pad = (v, w) => String(v).padEnd(w);
console.log(pad('site', 20), pad('sun now', 9), pad('eclipse now', 12), pad('best lit+clear', 30), 'alt/clr');
for (const [siteId, site] of Object.entries(landingSites)) {
  const start = Date.parse(site.date), span = (site.solarDay || 1) * 86400000;
  const nowFrame = surfaceFrame(site, new Date(start));
  const nowAlt = horizonAngles(nowFrame.targets.Sun.direction).altitude;
  const nowEclipse = solarVisibility(nowFrame, site.parentRadiusKm, site.parent);
  const samples = [];
  for (let n = 0; n <= 240; n++) {
    const time = start + n * span / 240, frame = surfaceFrame(site, new Date(time));
    const altitude = horizonAngles(frame.targets.Sun.direction).altitude;
    const eclipse = solarVisibility(frame, site.parentRadiusKm, site.parent);
    samples.push({ time, altitude, eclipse, brightness: surfaceLight(frame, site, site.referenceSolarAltitude ?? 25).brightness });
  }
  const best = samples.filter(s => s.altitude > 12 && s.eclipse > .95).sort((a, b) => Math.abs(a.altitude - 22) - Math.abs(b.altitude - 22))[0];
  const eclipsedShare = samples.filter(s => s.eclipse < .5).length / samples.length;
  console.log(pad(siteId, 20), pad(nowAlt.toFixed(1) + '°', 9), pad(nowEclipse.toFixed(2), 12),
    pad(best ? new Date(best.time).toISOString() : 'none', 30), best ? `${best.altitude.toFixed(0)}°/${best.eclipse.toFixed(2)} ecl=${(eclipsedShare * 100).toFixed(0)}%` : '');
}
