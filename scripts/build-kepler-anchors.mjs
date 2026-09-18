import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { decodeEphemeris, evaluateEphemeris } from '../solar-system/src/physics/ephemeris.js';
import { physicalTime } from '../solar-system/src/physics/time.js';
import { orbitalElements } from '../solar-system/src/physics/kepler.js';

const root = new URL('../public/ephemeris/', import.meta.url);
const GM = { sun:1.3271244004127942e11, saturn:3.793120623436167e7, uranus:5.793951256527211e6,
  enceladus:7.210366688598896, titan:8978.137095521046, miranda:4.3195168992321,
  pluto:869.6138177608748, charon:105.8799888601881, ceres:62.628888644409933 };
const result = { source:'JPL SAT441 / URA184 / PLU060 yearly polynomial bundles and the Horizons-generated Ceres bundle; see public/ephemeris/manifest.json',
  gmSource:'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc',
  frame:'J2000', units:'km, s', timescale:'TDB', derivative:'central difference at ±1 second',
  limitations:'Only outside 1900–2100: two-body extrapolation from the nearest range boundary; no perturbations, secular evolution or accuracy guarantee.',
  binaryPlutoFraction:GM.charon / (GM.pluto + GM.charon), anchors:{} };
for (const [boundary,date] of [['first','1900-01-01T00:00:00Z'],['last','2101-01-01T00:00:00Z']]) {
  const epoch = physicalTime(new Date(date)).tdbSeconds, year = boundary === 'first' ? 1900 : 2100;
  const bundles = {}, hashes = {};
  for (const system of ['saturn','uranus','pluto','ceres']) {
    const bytes = await readFile(new URL(`${system}/${year}.bin`,root));
    hashes[system] = createHash('sha256').update(bytes).digest('hex');
    bundles[system] = decodeEphemeris(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  }
  const vector = (system,target,center,t) => new Vector3().fromArray(evaluateEphemeris(bundles[system],target,center,t));
  const relative = (system,target,parent,center) => t => vector(system,target,center,t).sub(vector(system,parent,center,t));
  const tracks = {
    enceladus:[relative('saturn',602,699,6),GM.saturn+GM.enceladus],
    titan:[relative('saturn',606,699,6),GM.saturn+GM.titan],
    miranda:[relative('uranus',705,799,7),GM.uranus+GM.miranda],
    charon:[relative('pluto',901,999,9),GM.pluto+GM.charon],
    plutoBarycenter:[relative('pluto',9,10,0),GM.sun+GM.pluto+GM.charon],
    // Ceres is heliocentric, so its track is already the Sun-relative position.
    ceres:[t=>vector('ceres',20000001,10,t),GM.sun+GM.ceres],
  };
  const elements = {};
  for (const [id,[position,gm]] of Object.entries(tracks)) {
    const r = position(epoch), v = position(epoch+1).sub(position(epoch-1)).multiplyScalar(.5);
    elements[id] = orbitalElements(r.toArray(),v.toArray(),gm,epoch);
  }
  // Preserve the endpoint positions exactly; the mass ratio in a different GM
  // kernel can differ slightly from PLU060. Retain that small fixed residual.
  elements.plutoResidualKm = vector('pluto',999,9,epoch).addScaledVector(tracks.charon[0](epoch),result.binaryPlutoFraction).toArray();
  result.anchors[boundary] = { date, sourceSha256:hashes, elements };
}
await writeFile(new URL('../solar-system/src/physics/kepler-anchors.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('Wrote independently phased two-body anchors at both ephemeris boundaries.');
