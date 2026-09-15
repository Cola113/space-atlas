import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Object3D, Mesh, SphereGeometry, MeshBasicMaterial } from 'three';
import { ringShadowAnchor } from '../src/feature-anchors.js';
import { landmarkFrame, landingFrame, landingPointVisible } from '../src/landmarks.js';
import { landingSites, surfaceFrame } from '../src/surface/geometry.js';
import { bodies } from '../src/data.js';
import { uvDirection } from '../src/feature-anchors.js';
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

test('the ring-shadow anchor is the exact ellipsoid intersection, not a rescaled sphere hit', () => {
  // Saturn's measured silhouette, from PCK00011: polar/equatorial = 54364/60268.
  const shape = [1, 54364 / 60268, 1];
  const onEllipsoid = p => (p.x / shape[0]) ** 2 + (p.y / shape[1]) ** 2 + (p.z / shape[2]) ** 2;
  for (const latitude of [-26, -10, -1, 1, 10, 26, 31]) {
    const angle = latitude * Math.PI / 180;
    const sun = new Vector3(Math.cos(angle), Math.sin(angle), 0);
    const point = ringShadowAnchor(sun, shape);
    assert.ok(point, `${latitude}: no anchor`);
    assert.ok(Math.abs(onEllipsoid(point) - 1) < 1e-12, `${latitude}: anchor left the ellipsoid`);
    // The same ray through the ring plane still leaves the B ring's 1.7 radius.
    const travel = -point.y / sun.y;
    assert.ok(travel > 0, `${latitude}: anchor is not sunward of the ring`);
    const ring = point.clone().addScaledVector(sun, travel);
    assert.ok(Math.abs(Math.hypot(ring.x, ring.z) - 1.7) < 1e-12, `${latitude}: ring plane drifted`);

    // The superseded method: hit a unit sphere, then scale the hit onto the ellipsoid.
    const sphereHit = ringShadowAnchor(sun);
    const rescaled = new Vector3(sphereHit.x * shape[0], sphereHit.y * shape[1], sphereHit.z * shape[2]);
    assert.ok(onEllipsoid(rescaled) <= 1 + 1e-12, `${latitude}: rescaled hit escaped the ellipsoid`);
    // It lands inside the surface, so a marker placed there sinks into the cloud tops.
    assert.ok(point.distanceTo(rescaled) > 1e-3, `${latitude}: the two intersections coincide`);
  }
  assert.equal(ringShadowAnchor(new Vector3(1, 0, 0), shape), null);
  // Beyond 36° the ray from the 1.7-radius ring plane clears the globe, flattened or
  // not, so the shadow has no surface anchor to point at.
  const high = 45 * Math.PI / 180;
  assert.equal(ringShadowAnchor(new Vector3(Math.cos(high), Math.sin(high), 0), shape), null);
});

test('landmark framing follows the true ellipsoid normal, not the radius vector', () => {
  const root = new Object3D(), mesh = new Mesh(new SphereGeometry(), new MeshBasicMaterial());
  root.add(mesh);
  mesh.scale.setScalar(4);
  const build = shape => {
    const data = { id: 'saturn', root, mesh, shape };
    const frame = landmarkFrame({ uv: [.5, .75] }, data);
    const local = frame.point.clone().sub(root.position).divideScalar(4);
    return { frame, local, radiusDirection: frame.point.clone().sub(root.position).normalize() };
  };
  // A sphere has one normal and it is the radius vector, so nothing may change.
  const sphere = build([1, 1, 1]);
  assert.ok(sphere.frame.direction.distanceTo(sphere.radiusDirection) < 1e-12, 'sphere: normal moved');
  assert.equal(sphere.frame.extent, 1, 'sphere: framing extent changed');

  const flattening = 54364 / 60268;
  const oblate = build([1, flattening, 1]);
  const expected = new Vector3(oblate.local.x, oblate.local.y / flattening ** 2, oblate.local.z).normalize();
  assert.ok(oblate.frame.direction.distanceTo(expected) < 1e-12, 'flattened: normal is not the ellipsoid gradient');
  assert.ok(oblate.frame.direction.distanceTo(oblate.radiusDirection) > 1e-3, 'flattened: normal collapsed onto the radius');
  assert.equal(oblate.frame.extent, 1, 'flattened: framing extent changed');
  // The marker itself still sits on the flattened surface, lifted by the display offset.
  assert.ok(Math.abs(Math.hypot(oblate.local.x, oblate.local.y / flattening, oblate.local.z) - 1.017) < 1e-12);
  mesh.geometry.dispose(); mesh.material.dispose();
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

test('landing markers sit on the measured ellipsoid of every shaped body', async () => {
  // The goal's shape criterion asks for the landmark AND the landing geometry that
  // depends on the silhouette to be verified, not just the mesh. The landing test below
  // builds bodies without a shape, so it cannot see this: every one of the nine landing
  // sites is on a body that now carries measured semi-axes.
  const byId = Object.fromEntries(bodies.map(body => [body.id, body]));
  const shapeOf = id => byId[id]?.shape;
  let checked = 0;
  for (const site of Object.values(landingSites)) {
    const shape = shapeOf(site.id);
    if (!shape) continue;
    checked++;
    const root = new Object3D(), mesh = new Mesh(new SphereGeometry(1, 64, 48), new MeshBasicMaterial());
    root.add(mesh);
    mesh.scale.setScalar(4);
    // An arbitrary dated attitude, so a marker that ignored the rotation would fail.
    mesh.rotation.set(.31, -.72, .19);
    root.position.set(10, 20, 30);
    root.updateMatrixWorld(true);
    const body = { ...byId[site.id], root, mesh };
    const frame = landingFrame(site, body);
    const local = frame.point.clone().sub(root.position)
      .applyQuaternion(mesh.quaternion.clone().invert())
      .divideScalar(4);
    const [sx, sy, sz] = shape;
    // Same mapping as landmarks.js's geographic(): longitude wrapped into [0, 1).
    const [ux, uy, uz] = [...uvDirection([((site.longitude + 180) % 360) / 360, (site.latitude + 90) / 180])];
    // On the ellipsoid rather than on a unit sphere. The two differ by only 6e-5 for
    // Mars at 4.85 degrees south, so the tolerance has to be far tighter than the
    // flattening itself for this to detect a marker that ignored the shape.
    assert.ok(Math.abs((local.x / sx) ** 2 + (local.y / sy) ** 2 + (local.z / sz) ** 2 - 1) < 1e-9,
      `${site.id}: the landing marker left the measured surface`);
    // Exactly the ellipsoid radius in that direction, which a unit sphere would miss even
    // where the flattening barely shows.
    const expected = Math.hypot(ux * sx, uy * sy, uz * sz);
    assert.ok(Math.abs(local.length() - expected) < 1e-12,
      `${site.id}: marker radius ${local.length()} against the ellipsoid's ${expected}`);
    if (sy < .999 && Math.abs(uy) > 1e-3)
      assert.ok(local.length() < 1 - 1e-9, `${site.id}: flattening never reached the landing marker`);
    // The pin aims along the observer's up, which is the radius vector and not the
    // ellipsoid normal: the surface view builds its horizon from the geocentric
    // direction, so a normal-aimed pin would fight the view it opens. Landmarks aim
    // along the ellipsoid normal instead, because there the direction is only the
    // camera bearing. These two sites are where the choice is observable, so the test
    // states the difference and then checks which one the pin followed.
    const normal = new Vector3(local.x / sx ** 2, local.y / sy ** 2, local.z / sz ** 2).normalize();
    const radial = frame.point.clone().sub(root.position).normalize();
    if (sy < .999 && Math.abs(local.y) > 1e-2)
      assert.ok(normal.distanceTo(local.clone().normalize()) > 1e-4,
        `${site.id}: the two conventions do not differ here, so this site proves nothing`);
    assert.ok(frame.direction.distanceTo(radial) < 1e-9, `${site.id}: pin direction is not the observer's up`);
    mesh.geometry.dispose(); mesh.material.dispose();
  }
  assert.ok(checked >= 8, `only ${checked} landing sites are on shaped bodies`);
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
