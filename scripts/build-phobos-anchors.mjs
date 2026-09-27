// Append only Phobos; preserve every other body's published boundary state.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { decodeEphemeris, evaluateEphemeris } from '../solar-system/src/physics/ephemeris.js';
import { physicalTime } from '../solar-system/src/physics/time.js';
import { orbitalElements } from '../solar-system/src/physics/kepler.js';
const path = new URL('../solar-system/src/physics/kepler-anchors.json',import.meta.url);
const data = JSON.parse(await readFile(path,'utf8'));
// gm_de440.tpc: Mars system GM, including the tiny satellite masses.
const gm = 42828.3758157561;
for (const [boundary,year] of [['first',1900],['last',2100]]) {
  const anchor = data.anchors[boundary];
  const raw = await readFile(new URL('../public/ephemeris/phobos/'+year+'.bin',import.meta.url));
  const bundle = decodeEphemeris(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  const t = physicalTime(new Date(anchor.date)).tdbSeconds;
  const relative = t => new Vector3().fromArray(evaluateEphemeris(bundle,401,4,t))
    .sub(new Vector3().fromArray(evaluateEphemeris(bundle,499,4,t)));
  anchor.elements.phobos = orbitalElements(relative(t).toArray(),relative(t+1).sub(relative(t-1)).multiplyScalar(.5).toArray(),gm,t);
  anchor.sourceSha256.phobos = createHash('sha256').update(raw).digest('hex');
}
if (!data.source.includes('MAR099')) data.source += '; Phobos: original MAR099 yearly records';
await writeFile(path,JSON.stringify(data,null,2)+'\n');
console.log('Appended MAR099 Phobos anchors; other elements preserved.');
