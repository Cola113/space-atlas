import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeMoonTransit, createMoonTransitSystem } from '../src/moon-transits.js';
import { physicalDefinitions } from '../src/physics/definitions.js';

const axes = [2, 1.8, 2];
const base = {
  sunPositionKm: [0, 0, 0],
  parentPositionKm: [10, 0, 0],
  moonPositionKm: [5, 0, 0],
  parentAxesKm: axes,
  moonRadiusKm: .25,
  sunRadiusKm: .1,
};

test('moon transit intersects the measured ellipsoid and returns a finite shadow cone', () => {
  const result = computeMoonTransit(base);
  assert.ok(result);
  assert.deepEqual(result.hitLocalKm.toArray(), [-2, 0, 0]);
  assert.deepEqual(result.centerGeometry.toArray(), [-1, 0, 0]);
  assert.equal(result.distanceToSurfaceKm, 3);
  assert.ok(result.umbraRadiusKm > 0);
  assert.ok(result.penumbraRadiusKm > result.umbraRadiusKm);
  assert.equal(result.shadowDiameterKm, result.umbraRadiusKm * 2);
});

test('a moon behind the parent cannot produce a transit', () => {
  assert.equal(computeMoonTransit({ ...base, moonPositionKm: [15, 0, 0] }), null);
});

test('changing the displayed satellite position does not change the physical shadow position', () => {
  const parentMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshBasicMaterial());
  const parentRoot = new THREE.Group(); parentRoot.add(parentMesh);
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshBasicMaterial());
  const objects = new Map([
    ['jupiter', { id: 'jupiter', root: parentRoot, mesh: parentMesh }],
    ['io', { id: 'io', mesh: moonMesh, sunDirection: new THREE.Vector3(1, 0, 0) }],
  ]);
  const parentAxes = physicalDefinitions.bodies.jupiter.radius.semiAxesKm;
  const frame = { bodies: new Map([
    ['sun', { positionKm: new THREE.Vector3(0, 0, 0) }],
    ['jupiter', { positionKm: new THREE.Vector3(1e8, 0, 0) }],
    ['io', { positionKm: new THREE.Vector3(1e8 - 421700, 0, 0) }],
  ]) };
  const transit = createMoonTransitSystem(objects);
  transit.update(frame);
  const first = transit.snapshot().jupiter[0];
  moonMesh.position.set(12345, -6789, 2468);
  transit.update(frame);
  const second = transit.snapshot().jupiter[0];
  assert.equal(first.visible, true);
  assert.deepEqual(second.center, first.center);
  assert.equal(second.umbraRadiusKm, first.umbraRadiusKm);
  parentMesh.geometry.dispose(); parentMesh.material.dispose(); moonMesh.geometry.dispose(); moonMesh.material.dispose();
});

test('finite Sun geometry can be rotated into the parent ellipsoid frame', () => {
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const result = computeMoonTransit({ ...base, parentRotation: rotation });
  assert.ok(result);
  assert.ok(result.normalLocal.length() > .99 && result.normalLocal.length() < 1.01);
});
