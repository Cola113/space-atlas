import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Object3D, Mesh, SphereGeometry, MeshBasicMaterial } from 'three';
import { ringShadowAnchor } from '../src/feature-anchors.js';
import { landmarkFrame } from '../src/landmarks.js';

test('ring-shadow anchor traces toward the Sun through the B ring in either season', () => {
  for (const latitude of [-26, -10, -1, 1, 10, 26]) {
    const angle = latitude * Math.PI / 180;
    const sun = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const point = ringShadowAnchor(sun);
    assert.ok(point && Math.abs(point.length() - 1) < 1e-10);
    assert.ok(point.dot(sun) > 0);
    const travel = -point.y / sun.y;
    assert.ok(travel > 0);
    const ring = point.clone().addScaledVector(sun, travel);
    assert.ok(Math.abs(ring.length() - 1.7) < 1e-10);
  }
  assert.equal(ringShadowAnchor(new Vector3(1, 0, 0)), null);
});

test('landmark positions and viewing directions follow the mesh without changing its orientation', () => {
  const root = new Object3D(), mesh = new Mesh(new SphereGeometry(), new MeshBasicMaterial());
  root.position.set(10, 20, 30); root.add(mesh);
  mesh.rotation.set(.3, .2, .1); mesh.scale.setScalar(4);
  const body = { id: 'mars', root, mesh };
  const before = mesh.quaternion.toArray();
  const frame = landmarkFrame({ uv: [.5, 1] }, body);
  const expected = new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
  assert.ok(frame.direction.distanceTo(expected) < 1e-10);
  assert.ok(frame.point.distanceTo(root.position.clone().addScaledVector(expected, 4 * 1.017)) < 1e-10);
  assert.deepEqual(mesh.quaternion.toArray(), before);
  assert.equal(landmarkFrame({ dynamic: 'eruption' }, body), null);
  mesh.geometry.dispose(); mesh.material.dispose();
});
