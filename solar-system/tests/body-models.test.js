import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import * as THREE from 'three';
import { bodies } from '../src/data.js';
import { physicalDefinitions, sourceFor } from '../src/physics/definitions.js';
import { physicalData } from '../src/physical-scale.js';
import { createBodyGeometry, createNarrowRing } from '../src/body-geometry.js';
import { landmarks, landmarkFrame } from '../src/landmarks.js';
import { uvDirection } from '../src/feature-anchors.js';
import { updateDisplayState } from '../src/orbits.js';
import { meanElements } from '../src/physics/mean-motion.js';
import { physicalTime } from '../src/physics/time.js';
import { localPhysics } from './physical-fixture.js';
const provider=localPhysics();
await provider.ensure(new Date('2000-01-01T12:00:00Z'),['enceladus','miranda','pluto'],{prefetch:false});
const SIMULATION_EPOCH=Date.UTC(2000,0,1,12);
const ROTATION_PERIOD_DAYS=Object.fromEntries(Object.entries(meanElements.bodies).map(([id,e])=>[id,e.spinDays]));
const day = 86400000;
const date = days => new Date(SIMULATION_EPOCH + days * day);
function scene() {
  return new Map(bodies.map(data => {
    const root = new THREE.Group(), tilted = new THREE.Group(), mesh = new THREE.Mesh();
    root.add(tilted); tilted.add(mesh);
    return [data.id, {...data, root, tilted, mesh, orbitCenter: new THREE.Vector3(), orbitLine: new THREE.Line()}];
  }));
}
function update(objects, days) {
  updateDisplayState(objects,provider.frame(date(days)));
  for (const body of objects.values()) body.root.updateMatrixWorld(true);
}
function facing(observer, target) {
  return target.root.position.clone().sub(observer.root.position).normalize()
    .applyQuaternion(observer.mesh.getWorldQuaternion(new THREE.Quaternion()).invert());
}

test('every catalogue body has valid motion, physical radius and readable surface assets', async () => {
  assert.equal(new Set(bodies.map(b => b.id)).size, bodies.length);
  const objects = scene();
  update(objects, .123);
  const original = new Map([...objects].map(([id,b]) => [id,{position:b.root.position.clone(),orientation:b.mesh.quaternion.clone()}]));
  update(objects, .137);
  for (const b of objects.values()) {
    assert.ok(Number.isFinite(physicalData[b.id]?.radiusKm), `${b.id}: missing radius`);
    const facts = b.facts.find(([label]) => /半径|直径/.test(label));
    assert.ok(facts, `${b.id}: missing size on card`);
    const radius = Number(facts[1].replaceAll(',', '')) / (facts[0].includes('直径') ? 2 : 1);
    assert.ok(Math.abs(radius - physicalData[b.id].radiusKm) < 1, `${b.id}: incorrect radius on card`);
    assert.ok([...b.root.position, ...b.mesh.quaternion].every(Number.isFinite), `${b.id}: invalid transform`);
    assert.ok(b.mesh.quaternion.angleTo(original.get(b.id).orientation) > 1e-7, `${b.id}: not rotating`);
    if (b.orbit) assert.ok(b.root.position.distanceTo(original.get(b.id).position) > 1e-7, `${b.id}: not orbiting`);
    if (b.parent) assert.ok(objects.has(b.parent));
    assert.ok(b.physical.orientation.model, `${b.id}: missing attitude model`);
    for (const file of [b.baseTexture || `2k_${b.texture}.jpg`, b.high].filter(Boolean)) {
      await access(new URL(`../../public/solar-system/textures/${file}`, import.meta.url));
    }
  }
});

test('independent Pluto/Charon attitudes preserve near-locking without manufacturing an exact fixed face', () => {
  const objects=scene(), directions={pluto:[],charon:[]};
  for(let i=0;i<=64;i++){
    update(objects,i*6.387/32);
    for(const [a,b] of [['pluto','charon'],['charon','pluto']])directions[a].push(facing(objects.get(a),objects.get(b)));
  }
  for(const [id,values] of Object.entries(directions)){
    const excursions=values.map(v=>v.distanceTo(values[0]));
    assert.ok(Math.max(...excursions)>.000001,`${id}: artificially fixed face`);
    assert.ok(Math.max(...excursions)<.025,`${id}: lost synchronous relation`);
  }
});

test('both retrograde satellites orbit opposite to regular satellites in their parent frame', () => {
  const objects = scene();
  function sign(id) {
    const b = objects.get(id), p = objects.get(b.parent);
    update(objects, 0);
    const start = b.root.position.clone().sub(p.root.position);
    update(objects, .0001);
    return Math.sign(start.cross(b.root.position.clone().sub(p.root.position)).dot(new THREE.Vector3(0,1,0).applyQuaternion(p.tilted.quaternion)));
  }
  const regular = sign('mimas');
  assert.equal(sign('phoebe'), -regular);
  assert.equal(sign('triton'), -regular);
});

test('independent rotation matches a quarter turn without inheriting the orbital period', () => {
  const objects = scene();
  for (const id of ['makemake','haumea','phoebe','himalia','nereid','hiiaka']) {
    const b = objects.get(id);
    update(objects, 0); const initial = b.mesh.quaternion.clone();
    update(objects, ROTATION_PERIOD_DAYS[id] / 4);
    // Date truncates sub-millisecond fractions of the quarter period.
    assert.ok(Math.abs(initial.angleTo(b.mesh.quaternion) - Math.PI/2) < 1e-6, id);
  }
});

test('absolute dates reproduce independently rotating and tumbling attitudes on rewind', () => {
  const objects=scene();
  for(const id of ['pluto','eris','europa','hyperion','nix','hiiaka','namaka']){
    update(objects,10);const start=objects.get(id).displayOrientation.clone();
    update(objects,11);assert.ok(start.angleTo(objects.get(id).displayOrientation)>1e-6,id);
    update(objects,10);assert.ok(start.angleTo(objects.get(id).displayOrientation)<1e-7,id);
  }
});

test('Pluto small moons orbit the barycenter while Charon retains the binary displacement', () => {
  const objects = scene(); update(objects, 2.1);
  const p = objects.get('pluto');
  assert.ok(p.root.position.distanceTo(p.orbitCenter) > .1);
  for (const id of ['styx','nix','kerberos','hydra']) {
    const b = objects.get(id);
    const expected=b.physical.relativeKm.length()/physicalData[id].orbitKm*b.orbit;
    assert.ok(Math.abs(b.root.position.distanceTo(p.orbitCenter)-expected)<1e-8);
    assert.ok(b.orbitLine.position.distanceTo(p.orbitCenter) < 1e-8);
  }
});

test('names, round major moons, equatorial ridges and the Haumea system are distinct', () => {
  const byId = Object.fromEntries(bodies.map(b => [b.id,b]));
  assert.deepEqual(['nix','hydra','kerberos','styx'].map(id => byId[id].name), ['冥卫二','冥卫三','冥卫四','冥卫五']);
  const sphere = new THREE.SphereGeometry(1,112,80);
  for (const id of ['ariel','umbriel','titania','oberon']) {
    const b = byId[id], g = createBodyGeometry(b,sphere); g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    // PCK00011 gives Ariel 581.1 x 577.9 x 577.7 km, so it is measurably, if barely,
    // non-spherical; the other three are adopted as spheres by the same source.
    assert.ok(Math.abs(size.y/size.x - b.shape[1]) < 1e-3, `${id}: polar ratio`);
    assert.ok(Math.abs(size.z/size.x - b.shape[2]) < 1e-3, `${id}: equatorial ratio`);
    assert.ok(Math.abs(size.y/size.x - 1) < .01, `${id}: not a near-sphere`);
  }
  for (const id of ['atlas','pan']) {
    const b = byId[id], g = createBodyGeometry(b,sphere), p = g.attributes.position;
    let excess = 0;
    for (let i=0;i<p.count;i++) {
      const y = p.getY(i)*(1+b.ridge.height)/b.shape[1];
      if (Math.abs(y) < .15) excess = Math.max(excess, Math.hypot(p.getX(i)/b.shape[0],p.getZ(i)/b.shape[2])*(1+b.ridge.height)-Math.sqrt(1-y*y));
    }
    assert.ok(excess > .25, `${id}: missing ridge`);
    assert.ok(g.boundingSphere.radius < 1.001, `${id}: escaped camera/collision bounds`);
  }
  assert.deepEqual(bodies.filter(b=>b.parent==='haumea').map(b=>b.id),['hiiaka','namaka']);
  const ring = createNarrowRing(byId.haumea);
  assert.ok(ring.geometry.parameters.innerRadius > byId.haumea.radius);
  assert.ok(ring.geometry.parameters.outerRadius > ring.geometry.parameters.innerRadius);
});

test('every display silhouette is taken from a sourced set of semi-axes', () => {
  const byId = Object.fromEntries(bodies.map(b => [b.id, b]));
  const sphere = new THREE.SphereGeometry(1, 112, 80);
  let shaped = 0;
  for (const [id, definition] of Object.entries(physicalDefinitions.bodies)) {
    const { semiAxesKm, semiAxesSource } = definition.radius;
    if (!semiAxesKm) continue;
    shaped++;
    const [a, b, c] = semiAxesKm;
    assert.ok(a >= b && b >= c, `${id}: semi-axes must be ordered a >= b >= c`);

    // A silhouette without a retrievable source is what this whole table exists to stop.
    const source = sourceFor(semiAxesSource);
    assert.ok(source?.url, `${id}: semi-axes cite the missing source "${semiAxesSource}"`);
    assert.ok(source.retrieved, `${id}: source "${semiAxesSource}" carries no retrieval date`);
    assert.ok(definition.radius.semiAxesNote, `${id}: semi-axes carry no stated definition`);

    const display = byId[id];
    assert.ok(display, `${id}: absent from the catalogue`);
    assert.deepEqual(display.shape, [1, c / a, b / a], `${id}: display shape drifted from the recorded semi-axes`);
    // Three's +Y axis is the spin axis, so a flattened body must be shortest along Y.
    assert.ok(display.shape[1] <= display.shape[2] + 1e-12, `${id}: shortest semi-axis is not the spin axis`);

    if (display.ridge) continue; // The equatorial ridge adds a separate display bulge.
    const geometry = createBodyGeometry(display, sphere);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y / size.x - display.shape[1]) < 1e-3, `${id}: mesh polar ratio`);
    assert.ok(Math.abs(size.z / size.x - display.shape[2]) < 1e-3, `${id}: mesh equatorial ratio`);
    geometry.dispose();
  }
  // Guards against a future edit quietly dropping most of the table back to spheres.
  assert.ok(shaped >= 50, `only ${shaped} bodies carry semi-axes`);
  assert.equal(bodies.filter(b => b.shapeEstimated).map(b => b.id).join(','), 'namaka');
  sphere.dispose();
});

test('every static landmark sits on the measured ellipsoid, not on a unit sphere', () => {
  const sphere = new THREE.SphereGeometry(1, 112, 80);
  let checked = 0;
  let flattened = 0;
  for (const [id, features] of Object.entries(landmarks)) {
    const data = bodies.find(body => body.id === id);
    const staticFeatures = features.filter(feature => feature.uv && !feature.dynamic);
    if (!data?.shape || staticFeatures.length === 0) continue;
    const root = new THREE.Object3D(), mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial());
    root.add(mesh);
    mesh.scale.setScalar(data.radius);
    const body = { ...data, root, mesh };
    // The 1.017 lift keeps a marker just above the surface; on a flattened globe it
    // has to be measured against the flattened radius, not the equatorial one.
    const surfaceRadius = uv => Math.hypot(
      ...uvDirection(uv).toArray().map((value, axis) => value * data.shape[axis]),
    );
    for (const feature of staticFeatures) {
      const frame = landmarkFrame(feature, body);
      assert.ok(frame, `${id}/${feature.id}: landmark frame missing`);
      const anchorRadius = frame.point.clone().sub(root.position).length() / data.radius;
      assert.ok(Math.abs(anchorRadius - surfaceRadius(feature.uv) * 1.017) < 1e-6,
        `${id}/${feature.id}: marker left the measured silhouette`);
      checked++;
    }
    if (data.shape[1] < .999) {
      flattened++;
      const pole = landmarkFrame({ uv: [.5, 1] }, body);
      const equator = landmarkFrame({ uv: [.5, .5] }, body);
      const poleRadius = pole.point.clone().sub(root.position).length() / data.radius;
      const equatorRadius = equator.point.clone().sub(root.position).length() / data.radius;
      assert.ok(poleRadius < equatorRadius - 1e-4, `${id}: flattening did not reach the marker`);
      assert.ok(Math.abs(equatorRadius - 1.017) < 1e-6, `${id}: equatorial marker lost the equatorial radius`);
    }
    mesh.geometry = sphere;
  }
  assert.ok(checked >= 8, `only ${checked} landmarks checked`);
  assert.ok(flattened >= 5, `only ${flattened} flattened globes carried landmarks`);
  sphere.dispose();
});

test('Saturn keeps its measured oblateness and its markers on the flattened globe', () => {
  const saturn = bodies.find(b => b.id === 'saturn');
  assert.ok(saturn.shape, 'Saturn: display shape missing');
  // 54364 / 60268 semi-axes and the NASA 108,728 / 120,536 km diameters agree.
  assert.ok(Math.abs(saturn.shape[1] - 108728 / 120536) < 1e-4, 'Saturn: polar ratio disagrees with the measured diameters');
  assert.deepEqual([saturn.shape[0], saturn.shape[2]], [1, 1], 'Saturn: only the polar axis may be shortened');

  const sphere = new THREE.SphereGeometry(1,112,80);
  const geometry = createBodyGeometry(saturn,sphere);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(size.y < size.x, 'Saturn: still renders as a unit sphere');
  assert.ok(Math.abs(size.y/size.x - saturn.shape[1]) < 1e-3, 'Saturn: flattening does not match the shape ratio');

  const root = new THREE.Object3D(), mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  root.add(mesh); mesh.scale.setScalar(saturn.radius);
  const body = {...saturn, root, mesh};
  // The 1.017 lift is what keeps a marker just above the surface; it must be measured
  // against the flattened radius, or an equator-anchored pin floats at the poles.
  const surfaceRadius = uv => Math.hypot(
    ...uvDirection(uv).toArray().map((value,axis) => value * saturn.shape[axis]),
  );
  const anchorRadius = frame => frame.point.clone().sub(root.position).length() / saturn.radius;

  const hexagon = landmarks.saturn.find(feature => feature.id === 'hexagon');
  assert.deepEqual(hexagon.uv, [.5,1], 'north-pole hexagon must anchor at 90°N');
  const pole = landmarkFrame(hexagon,body);
  assert.ok(Math.abs(anchorRadius(pole) - surfaceRadius(hexagon.uv)*1.017) < 1e-6, 'polar marker floats off the flattened cloud tops');
  assert.ok(Math.abs(anchorRadius(pole) - 1.017) > 1e-3, 'polar marker ignored the flattening');

  const equator = landmarkFrame({uv:[.5,.5]},body);
  assert.ok(Math.abs(anchorRadius(equator) - 1.017) < 1e-6, 'equatorial marker must keep the equatorial radius');

  mesh.geometry.dispose(); mesh.material.dispose(); sphere.dispose();
});
