// Operational check: is each landing site lit at its own default date?
import { readFile } from 'node:fs/promises';
import { MathUtils } from 'three';
import { physicalState } from '../../solar-system/src/physics/state.js';
import { surfaceFrame, horizonAngles, angularDiameter, landingSites } from '../../solar-system/src/surface/geometry.js';

physicalState.ephemeris.fetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`, import.meta.url));
  return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
};
physicalState.ephemeris.maxEntries = 64;
for (const year of [2008, 2019, 2026]) await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`), ['saturn', 'uranus', 'pluto'], { prefetch: false });

const pad = (value, width) => String(value).padEnd(width);
console.log(pad('site', 20), pad('body', 10), pad('date', 12), pad('sun alt', 16), pad('parent alt', 14), 'parent size');
for (const [siteId, site] of Object.entries(landingSites)) {
  const start = Date.parse(site.date), span = (site.solarDay || 1) * 86400000;
  const sun = [], parentAlt = [], parentSize = [];
  for (let n = 0; n < 25; n++) {
    const frame = surfaceFrame(site, new Date(start + n * span / 24));
    sun.push(horizonAngles(frame.targets.Sun.direction).altitude);
    const parent = frame.targets[site.parent];
    parentAlt.push(horizonAngles(parent.direction).altitude);
    parentSize.push(MathUtils.radToDeg(angularDiameter(site.parentRadiusKm, parent.distanceKm)));
  }
  const r = (a, d = 1) => `${Math.min(...a).toFixed(d)} .. ${Math.max(...a).toFixed(d)}`;
  console.log(pad(siteId, 20), pad(site.id, 10), pad(site.date.slice(0, 10), 12), pad(r(sun), 16), pad(r(parentAlt), 14), r(parentSize, 2));
}
