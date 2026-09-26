import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPhobosReference } from '../../scripts/verify-phobos-reference.mjs';
import { localPhysics } from './physical-fixture.js';
import { MissingEphemerisError } from '../src/physics/ephemeris.js';
import { meanElements,physicalDefinitions } from '../src/physics/definitions.js';
import { bodyOrientation } from '../src/physics/orientation.js';
import { landingSites } from '../src/surface/geometry.js';
test('Phobos MAR099 year records and three unregistered candidate skies agree with CSPICE and Horizons',async()=>{
  const r=await verifyPhobosReference();
  assert.equal(r.cspiceEpochs,854); assert.equal(r.surfaceSamples,150); assert.equal(r.horizonsSamples,12);
  assert.ok(r.relativeKm<.002,JSON.stringify(r)); assert.ok(r.horizonsKm<.002,JSON.stringify(r));
  assert.ok(r.velocityKmS<.001,JSON.stringify(r)); assert.ok(r.surfaceDirectionArcmin<.001,JSON.stringify(r));
  assert.ok(r.surfaceDistanceKm<.002); assert.ok(r.surfaceDiameterArcsec<.1,JSON.stringify(r));
  console.log('Phobos independent reference differences:',JSON.stringify(r));
});
test('Phobos availability, Mars translation and IAU attitude remain separate; no landing is registered',async()=>{
  const p=localPhysics(),date=new Date('2026-09-26T00:00:00Z');
  const before=p.frame(date); assert.equal(before.bodies.has('phobos'),false);
  assert.throws(()=>p.frame(date,{required:['phobos']}),MissingEphemerisError);
  await p.ensure(date,['phobos'],{prefetch:false});
  const after=p.frame(date),b=after.bodies.get('phobos'),mars=after.bodies.get('mars');
  assert.deepEqual(mars,before.bodies.get('mars'),'loading a satellite must not change Mars');
  assert.deepEqual(b.positionKm,mars.positionKm.clone().add(b.relativeKm));
  assert.match(b.model,/MAR099/); assert.equal(b.parent,'mars');
  assert.equal(meanElements.bodies.phobos,undefined); assert.equal(physicalDefinitions.bodies.phobos.rotation.provider,'iau-pck');
  assert.ok(b.orientation.quaternion.angleTo(bodyOrientation('phobos',date).quaternion)<1e-7);
  assert.ok(!Object.values(landingSites).some(s=>s.id==='phobos'));
  for(const boundary of ['1900-01-01T00:00:00Z','2101-01-01T00:00:00Z']) {
    const t=Date.parse(boundary),first=boundary.startsWith('1900');
    const inside=new Date(t+(first?0:-1)),outside=new Date(t+(first?-1:0));
    await p.ensure(inside,['phobos'],{prefetch:false});
    const a=p.frame(inside).bodies.get('phobos'),b=p.frame(outside).bodies.get('phobos');
    assert.ok(a.relativeKm.distanceTo(b.relativeKm)<.003); assert.match(b.model,/二体轨道外推/);
  }
  p.dispose();
});
