import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeMoonTransit, createMoonTransitSystem, physicalAxes, physicalGeometryRotation } from '../src/moon-transits.js';
import { updateDisplayState } from '../src/orbits.js';
import { bodies } from '../src/data.js';
import { localPhysics } from './physical-fixture.js';
const base={sunPositionKm:[0,0,0],parentPositionKm:[1e8,0,0],moonPositionKm:[1e8-400000,0,0],
  parentAxesKm:[70000,60000,70000],moonRadiusKm:1800,sunRadiusKm:696340};
test('solar axis intersects the measured oblate surface and gives finite cone diameters',()=>{
  const g=computeMoonTransit(base);
  assert.ok(g);assert.ok(Math.abs(g.hitLocalKm.x+70000)<1e-8);
  assert.ok(Math.abs(g.distanceToSurfaceKm-330000)<1e-8);
  assert.ok(g.umbraRadiusKm===0);assert.ok(g.penumbraRadiusKm>1800);
  const h=computeMoonTransit({...base,parentPositionKm:[8e8,0,0],moonPositionKm:[8e8-400000,0,0]});
  assert.ok(h.umbraRadiusKm>1400 && h.umbraRadiusKm<1600);
});
test('behind-parent moons and rays missing the ellipsoid have no central shadow',()=>{
  assert.equal(computeMoonTransit({...base,moonPositionKm:[1e8+400000,0,0]}),null);
  assert.equal(computeMoonTransit({...base,moonPositionKm:[1e8-400000,100000,0]}),null);
});
test('ellipsoid pole and nontrivial orientation are not treated as a sphere',()=>{
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
  const g=computeMoonTransit({...base,parentRotation:q});
  assert.ok(Math.abs(g.hitLocalKm.y-60000)<1e-7);
  assert.ok(Math.abs(g.hitLocalKm.x)<1e-7);
});
function objectsFor(ids){return new Map(bodies.filter(b=>ids.includes(b.id)).map(b=>{
  const root=new THREE.Group(),tilted=new THREE.Group(),mesh=new THREE.Mesh(new THREE.SphereGeometry(1,8,4),new THREE.MeshBasicMaterial());
  root.add(tilted);tilted.add(mesh);mesh.scale.setScalar(b.radius);
  return [b.id,{...b,root,tilted,mesh,orbitCenter:new THREE.Vector3()}];
}));}
test('changing actual orbit display scales cannot move a physical shadow or change its diameter',()=>{
  const provider=localPhysics(),frame=provider.frame(new Date('2026-01-01T00:00:00Z'));
  const objects=objectsFor(['jupiter','io','europa','ganymede','callisto']);
  updateDisplayState(objects,frame,{guides:false});
  const transits=createMoonTransitSystem(objects);transits.update(frame);
  const a=transits.snapshot(),before=objects.get('io').root.position.clone();
  for(const b of objects.values())b.orbit*=23;
  updateDisplayState(objects,frame,{guides:false});transits.update(frame);
  assert.ok(before.distanceTo(objects.get('io').root.position)>1);
  assert.deepEqual(transits.snapshot(),a);
  const local=new THREE.Vector3(...a.jupiter[0].moonLocal).multiplyScalar(physicalAxes('jupiter')[0]);
  const orientation=frame.bodies.get('jupiter').orientation;
  const physical=frame.bodies.get('io').relativeKm;
  const expected=new THREE.Vector3(physical.dot(orientation.prime),physical.dot(orientation.north),-physical.dot(orientation.east));
  assert.ok(local.distanceTo(expected)<1e-6);
  const rotated=physical.clone().applyQuaternion(physicalGeometryRotation(orientation).invert());
  assert.ok(rotated.distanceTo(expected)<1e-7);
  provider.dispose();
});
test('sparse available moons compact slots and clear stale state',()=>{
  const provider=localPhysics(),frame=provider.frame(new Date('2026-01-01T00:00:00Z'));
  const objects=objectsFor(['jupiter','io','europa','ganymede','callisto']),system=createMoonTransitSystem(objects);
  system.update(frame);assert.equal(objects.get('jupiter').moonTransitUniforms.uMoonTransitCount.value,4);
  const sparse={...frame,bodies:new Map([...frame.bodies].filter(([id])=>!['io','europa','ganymede'].includes(id)))};
  system.update(sparse);assert.equal(objects.get('jupiter').moonTransitUniforms.uMoonTransitCount.value,1);
  assert.equal(system.snapshot().jupiter[3].available,true);
  assert.equal(objects.get('jupiter').moonTransitUniforms.uTransitMoons.value[1].w,0);
  system.setEnabled(false);assert.equal(objects.get('jupiter').moonTransitUniforms.uMoonTransitEnabled.value,0);
  provider.dispose();
});

