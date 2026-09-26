import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeMoonTransit, createMoonTransitSystem, physicalAxes, physicalGeometryRotation } from '../src/moon-transits.js';
import { updateDisplayState } from '../src/orbits.js';
import { bodies } from '../src/data.js';
import { localPhysics } from './physical-fixture.js';
import { observerTransit, createMoonTransitDiscs } from '../src/moon-transit-discs.js';
import { createBodyGeometry } from '../src/body-geometry.js';
const base={sunPositionKm:[0,0,0],parentPositionKm:[1e8,0,0],moonPositionKm:[1e8-400000,0,0],
  parentAxesKm:[70000,60000,70000],moonRadiusKm:1800,sunRadiusKm:696340};

test('observer transit is independent of solar shadow and excludes a far-side moon',()=>{
  const relative=new THREE.Vector3(400000,10000,5000),view=new THREE.Vector3(1,0,0);
  assert.deepEqual(observerTransit(relative,view,[70000,60000,70000],1800).planeKm.toArray(),[0,10000,5000]);
  assert.equal(observerTransit(relative,view.clone().negate(),[70000,60000,70000],1800),null);
  assert.equal(observerTransit(new THREE.Vector3(400000,80000,0),view,[70000,60000,70000],1800),null);
});

test('physical disks share the original texture, measured mesh and dated phase without modifying them',()=>{
  const provider=localPhysics(),frame=provider.frame(new Date('2026-01-01T00:00:00Z'));
  const objects=objectsFor(['jupiter','io','europa','ganymede','callisto']);
  updateDisplayState(objects,frame,{guides:false});
  const j=objects.get('jupiter'),io=objects.get('io');
  io.mesh.material.map=new THREE.Texture();
  const original={orbit:io.orbit,radius:io.radius,position:io.root.position.toArray(),attitude:io.mesh.quaternion.toArray()};
  const bearing=io.root.position.clone().sub(j.root.position).normalize();
  const camera=new THREE.PerspectiveCamera(42,1,.01,2400);
  camera.position.copy(j.root.position).addScaledVector(bearing,j.radius*10);
  camera.lookAt(j.root.position);camera.updateMatrixWorld();
  const disks=createMoonTransitDiscs(objects);disks.update(frame,camera,{selected:'jupiter'});
  const proxy=j.root.children.find(c=>c.name==='io-physical-transit');
  assert.ok(proxy.visible);assert.equal(proxy.material.map,io.mesh.material.map);
  assert.deepEqual([...proxy.geometry.attributes.position.array],[...io.mesh.geometry.attributes.position.array]);
  assert.ok(proxy.quaternion.angleTo(io.displayOrientation)<1e-7);
  assert.equal(proxy.material.userData.physicalSun,true);
  assert.deepEqual({orbit:io.orbit,radius:io.radius,position:io.root.position.toArray(),attitude:io.mesh.quaternion.toArray()},original);
  assert.ok(disks.snapshot()[0].visible);
  disks.dispose();provider.dispose();
});
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
  const root=new THREE.Group(),tilted=new THREE.Group(),mesh=new THREE.Mesh(createBodyGeometry(b,new THREE.SphereGeometry(1,24,16)),new THREE.MeshStandardMaterial());
  root.add(tilted);tilted.add(mesh);mesh.scale.setScalar(b.radius);
  return [b.id,{...b,root,tilted,mesh,orbitCenter:new THREE.Vector3()}];
}));}
test('changing actual orbit display scales cannot move a physical shadow or change its diameter',()=>{
  const provider=localPhysics(),frame=provider.frame(new Date('2026-01-02T13:00:00Z'));
  const objects=objectsFor(['jupiter','io','europa','ganymede','callisto']);
  updateDisplayState(objects,frame,{guides:false});
  const transits=createMoonTransitSystem(objects);transits.update(frame);
  const a=transits.snapshot(),before=objects.get('io').root.position.clone();
  assert.equal(a.jupiter[0].active,true,'scale invariance must exercise a real active Io shadow');
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

test('forward motion, pause and rewind retain the dated shadow with no activity-clock dependency',()=>{
  const provider=localPhysics(),objects=objectsFor(['jupiter','io','europa','ganymede','callisto']),system=createMoonTransitSystem(objects);
  const at=date=>{system.update(provider.frame(new Date(date)));return system.snapshot().jupiter[0];};
  const first=at('2026-01-02T13:00:00Z'),later=at('2026-01-02T13:10:00Z');
  assert.ok(first.active&&later.active);assert.ok(vector(first.center).distanceTo(vector(later.center))>.001,'shadow moves more than 70 km in body coordinates');
  assert.deepEqual(at('2026-01-02T13:10:00Z'),later,'paused date is deterministic');
  assert.deepEqual(at('2026-01-02T13:00:00Z'),first,'rewind returns the same physical state');
  assert.equal(at('2026-01-02T19:00:00Z').active,false,'shadow leaves the disk');
  provider.dispose();
});
const vector=a=>new THREE.Vector3().fromArray(a);
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
