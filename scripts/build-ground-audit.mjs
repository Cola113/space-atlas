// Independent solar/parent geometry and illumination for every landing site.
// One body can carry several sites, so samples are keyed by siteId and the body id is kept
// separately: the independent positions are per body, the observer geometry is per site.
// Run: npx tsx scripts/build-ground-audit.mjs [--download]
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { landingSites } from '../solar-system/src/surface/geometry.js';
import { physicalTime } from '../solar-system/src/physics/time.js';
import { physicalDefinitions } from '../solar-system/src/physics/definitions.js';

const requests = [];
for (const [siteId, site] of Object.entries(landingSites)) {
  // Pluto's observer rotation repeats on the Charon orbit, not its solar year.
  const cycle = physicalDefinitions.bodies[site.id === 'pluto' ? 'charon' : site.id].orbit.periodDays;
  const dates = new Set(['1900-01-01T00:00:00Z', '1900-12-31T23:59:59Z',
    '1971-08-01T17:00:00Z', '2000-01-01T12:00:00Z', '2100-12-31T23:59:59Z', site.date]);
  for (let step = 0; step <= 32; step++) {
    dates.add(new Date(Date.parse(site.date) + step * cycle / 8 * 86400000).toISOString());
  }
  for (const date of dates) requests.push({siteId, id:site.id, parent:site.parent.toLowerCase(), date,
    tdbSeconds:physicalTime(new Date(date)).tdbSeconds, latitude:site.latitude, longitude:site.longitude,
    radiusKm:site.radiusKm, parentRadiusKm:site.parentRadiusKm});
}
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(root + 'data/science-audit', {recursive:true});
await writeFile(root + 'data/science-audit/ground-input.json', JSON.stringify(requests));
const result = spawnSync(root + 'data/ephemeris-tools/Scripts/python.exe',
  ['scripts/build-ground-audit.py', ...process.argv.slice(2)], {cwd:root, stdio:'inherit'});
if (result.status !== 0) process.exit(result.status || 1);
