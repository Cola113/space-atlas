// Append only Triton; preserve every other body's published boundary state.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { decodeEphemeris, evaluateEphemeris } from '../solar-system/src/physics/ephemeris.js';
import { physicalTime } from '../solar-system/src/physics/time.js';
import { orbitalElements } from '../solar-system/src/physics/kepler.js';
const path = new URL('../solar-system/src/physics/kepler-anchors.json', import.meta.url);
const data = JSON.parse(await readFile(path, 'utf8'));
// gm_de440.tpc: BODY899_GM + BODY801_GM (Neptune + Triton).
const gm = 6.835103145462294e6 + 1.428495462910464e3;
for (const [boundary, year] of [['first', 1900], ['last', 2100]]) {
  const anchor = data.anchors[boundary];
  const raw = await readFile(new URL(`../public/ephemeris/neptune/${year}.bin`, import.meta.url));
  const bundle = decodeEphemeris(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const t = physicalTime(new Date(anchor.date)).tdbSeconds;
  const relative = tdb => new Vector3().fromArray(evaluateEphemeris(bundle, 801, 8, tdb))
    .sub(new Vector3().fromArray(evaluateEphemeris(bundle, 899, 8, tdb)));
  anchor.elements.triton = orbitalElements(
    relative(t).toArray(),
    relative(t + 1).sub(relative(t - 1)).multiplyScalar(0.5).toArray(),
    gm,
    t,
  );
  anchor.sourceSha256.neptune = createHash('sha256').update(raw).digest('hex');
}
data.source = data.source.replace(/; Triton: original NEP097 yearly records/g, '');
if (!data.source.includes('NEP098')) data.source += '; Triton: original NEP098 yearly records';
await writeFile(path, JSON.stringify(data, null, 2) + '\n');
console.log('Appended NEP098 Triton anchors; other elements preserved.');
