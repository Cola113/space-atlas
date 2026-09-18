import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { Rotation_EQJ_ECL } from 'astronomy-engine';
import { Matrix3, MathUtils } from 'three';
import { meanMotion, meanOrbitBasis, meanElements } from '../src/physics/mean-motion.js';
import { physicalDefinitions } from '../src/physics/definitions.js';
import { physicalTime } from '../src/physics/time.js';
import { bodyOrientation } from '../src/physics/orientation.js';

function atTdb(id, seconds) {
  return meanMotion(id,{tdbSeconds:seconds,tdbDays:seconds/86400});
}

test('all adopted mean ellipses agree with independent CSPICE conics across periods and historical boundaries',async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL('mean-reference.json',import.meta.url),'utf8'));
  // Ceres left this set on 2026-09-18 when its Horizons bundle was published: it now
  // supplies dated states like the Pluto system, so asserting a fixed ellipse for it
  // would be asserting the model the project deliberately replaced.
  assert.equal(new Set(fixtures.map(f=>f.id)).size,38);
  assert.ok(!fixtures.some(f=>f.id==='ceres'),'ceres is no longer a fixed mean ellipse');
  assert.equal(Object.keys(meanElements.bodies).length,38,'mean-element registry matches the fixtures');
  let directionError=0,relativePositionError=0;
  for(const f of fixtures){
    const actual=atTdb(f.id,f.tdbSeconds),expected=new Vector3().fromArray(f.positionKm);
    const error=actual.relativeKm.distanceTo(expected)/expected.length();
    relativePositionError=Math.max(relativePositionError,error);
    directionError=Math.max(directionError,actual.relativeKm.angleTo(expected));
    assert.ok(error<1e-8,`${f.id} position ${error}`);
    assert.ok(actual.relativeVelocityKmS.distanceTo(new Vector3().fromArray(f.velocityKmS))<1e-7,`${f.id} velocity`);
  }
  console.log('Mean conic coordinate/propagation errors:',{relativePositionError,directionError});
});

test('Haumea satellite positions and mutual plane angle match published 2009 state vectors',()=>{
  // Independent values from Ragozzine & Brown (2009), Tables 2–3. Published
  // angles are rounded; this is a check at the stated HJD, not a UTC prediction.
  const rotation=new Matrix3().fromArray(Rotation_EQJ_ECL().rot.flat());
  for(const [id,expected] of [
    ['hiiaka',[-18879.430,-36260.639,-32433.454]],
    ['namaka',[-28830.795,-13957.217,-1073.907]],
  ]){
    const p=atTdb(id,(2454615-2451545)*86400).relativeKm.applyMatrix3(rotation);
    assert.ok(p.distanceTo(new Vector3().fromArray(expected))<70,`${id} rounded Table 2 vs Table 3: ${p.toArray()}`);
  }
  const degrees=meanOrbitBasis('hiiaka').north.angleTo(meanOrbitBasis('namaka').north)*180/Math.PI;
  assert.ok(Math.abs(degrees-13.41)<.08,`mutual inclination ${degrees}`);
});

test('retrograde orbital motion is independent of IAU spin',()=>{
  const time=physicalTime(new Date('2000-01-01T12:00:00Z'));
  for(const id of ['phoebe','triton','phobos','vesta']){
    const state=meanMotion(id,time),orientation=bodyOrientation(id,time);
    assert.ok(state.orientation.quaternion.angleTo(orientation.quaternion)<1e-7,id);
  }
  // Ceres kept its IAU attitude when its orbit moved to the dated bundle, so its spin
  // must still come from the PCK polynomial rather than from where the orbit happens
  // to be. Compare against the published pole, not against the ecliptic normal: the
  // real pole is 23.2 degrees off it, so "far from the ecliptic normal" is not a test.
  const ceres=bodyOrientation('ceres',time);
  assert.equal(physicalDefinitions.bodies.ceres.rotation.provider,'iau-pck');
  assert.equal(ceres.model,'IAU PCK00011');
  const [poleRa,poleDec]=[291.418,66.764].map(MathUtils.degToRad);
  const expected=new Vector3(Math.cos(poleDec)*Math.cos(poleRa),Math.cos(poleDec)*Math.sin(poleRa),Math.sin(poleDec));
  assert.ok(ceres.north.angleTo(expected)*180/Math.PI<.1,'Ceres pole follows PCK00011');
  const phoebe=meanMotion('phoebe',time),spinNorth=phoebe.orientation.north;
  assert.ok(phoebe.relativeKm.clone().cross(phoebe.relativeVelocityKmS).dot(spinNorth)<0,
    'Phoebe retrograde orbit must not force retrograde spin about its IAU north pole');
});

test('radius definitions distinguish adopted, inferred, arithmetic and radiometric quantities',()=>{
  const b=physicalDefinitions.bodies;
  assert.equal(b.earth.radius.type,'arithmetic-mean');
  assert.ok(Math.abs(b.earth.radius.value-(2*6378.1366+6356.7519)/3)<.0001);
  assert.equal(b.hiiaka.radius.value,370/2);
  assert.equal(b.hiiaka.radius.uncertainty,20/2);
  assert.equal(b.vesta.radius.value,522.77/2);
  assert.ok(Math.abs(b.haumea.radius.value-Math.cbrt(1161*852*513))<1e-10);
  assert.equal(b.dysnomia.radius.type,'radiometric-effective');
  for(const [id,body] of Object.entries(b)){
    assert.ok(physicalDefinitions.sources[body.radius.source]?.url,id);
    assert.equal(body.radius.unit,'km');
    assert.ok(Object.hasOwn(body.radius,'epoch'),id);
    assert.ok(body.radius.validity&&body.orbit.validity&&body.rotation.validity,id);
  }
});
