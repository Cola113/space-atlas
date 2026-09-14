import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Object3D, Mesh, SphereGeometry, MeshBasicMaterial } from 'three';
import { ringShadowAnchor } from '../src/feature-anchors.js';
import { landmarkFrame, landingFrame, landingPointVisible } from '../src/landmarks.js';
import { landingSites, surfaceFrame } from '../src/surface/geometry.js';
import { localPhysics } from './physical-fixture.js';
import { updateDisplayState } from '../src/orbits.js';
import { skyRotation } from '../src/sky-coordinates.js';

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

test('nine landing markers use the same east-positive coordinates and dated attitudes as their surface observers', async () => {
  const provider = localPhysics();
  try {
    for (const site of Object.values(landingSites)) {
      const root = new Object3D(), tilted = new Object3D(), mesh = new Mesh(new SphereGeometry(), new MeshBasicMaterial());
      root.add(tilted); tilted.add(mesh); mesh.scale.setScalar(4);
      const body = {id:site.id, root, tilted, mesh, radius:4, orbit:1, orbitCenter:new Vector3()};
      for (const date of [new Date('1971-08-01T17:00:00Z'),new Date('2026-09-14T09:18:00Z')]) {
        await provider.ensure(date,[site.id,site.parent.toLowerCase()],{prefetch:false});
        const surface = surfaceFrame(site,date,provider);
        updateDisplayState(new Map([[site.id,body]]),surface.physical,{guides:false});
        const before = mesh.quaternion.toArray(), frame = landingFrame(site,body);
        const up = surface.observerKm.clone().sub(surface.centerKm).normalize().applyMatrix3(skyRotation(surface.physical.time.astronomy));
        assert.ok(frame.direction.distanceTo(up)<1e-6,site.id+' mirrored or rotated landing coordinate');
        assert.ok(frame.point.distanceTo(root.position.clone().addScaledVector(up,4))<1e-5,site.id+' surface marker floats off the surface');
        assert.deepEqual(mesh.quaternion.toArray(),before);
      }
      mesh.geometry.dispose(); mesh.material.dispose();
    }
  } finally { provider.dispose(); }
});

test('landing markers hide beyond the limb and behind foreground geometry, then reappear when uncovered', () => {
  const makeBody = (id, x, y, z, radius) => {
    const root = new Object3D(), mesh = new Mesh(new SphereGeometry(1,32,24),new MeshBasicMaterial());
    root.position.set(x,y,z); root.add(mesh); mesh.scale.setScalar(radius);
    return {id,root,mesh,physicalAvailable:true};
  };
  const body = makeBody('moon',10,20,30,4), other = makeBody('earth',17,20,30,1);
  const objects = [body,other], observer = new Vector3(22,20,30), site = {latitude:0,longitude:0};
  let frame = landingFrame(site,body);
  assert.equal(landingPointVisible(frame,body,observer,[body]),true);
  assert.equal(landingPointVisible(frame,body,new Vector3(14,20,42),[body]),false,'exact limb is not a visible surface');
  assert.equal(landingPointVisible(frame,body,observer,objects),false,'foreground body must hide marker');
  other.root.position.y += 3;
  assert.equal(landingPointVisible(frame,body,observer,objects),true);
  other.root.position.y -= 3; other.root.position.x = 12;
  assert.equal(landingPointVisible(frame,body,observer,objects),true,'geometry behind the point must not hide it');
  other.root.position.x = 17; other.physicalAvailable = false;
  assert.equal(landingPointVisible(frame,body,observer,objects),true,'unavailable geometry is not drawn');
  body.mesh.rotation.y = Math.PI;
  frame = landingFrame(site,body);
  assert.equal(landingPointVisible(frame,body,observer,[body]),false,'back hemisphere cannot float into view');
  body.mesh.rotation.y = 0;
  assert.equal(landingPointVisible(landingFrame(site,body),body,observer,[body]),true);
  for (const object of objects) { object.mesh.geometry.dispose(); object.mesh.material.dispose(); }
});
