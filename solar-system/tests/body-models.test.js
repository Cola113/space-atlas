import {loadYear} from './load-ephemeris.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import * as THREE from 'three';
import { bodies } from '../src/data.js';
import { physicalData } from '../src/physical-scale.js';
import { createBodyGeometry, createNarrowRing } from '../src/body-geometry.js';
import { SIMULATION_EPOCH, ROTATION_PERIOD_DAYS, COORBITAL_SWAP_DAYS, satelliteOrbit,
  updatePrimaryOrbits, updateSatelliteOrbits, updateBodyRotations } from '../src/orbits.js';

const day = 86400000;
const date = days => new Date(SIMULATION_EPOCH + days * day);
function scene() {
  return new Map(bodies.map(data => {
    const root = new THREE.Group(), tilted = new THREE.Group(), mesh = new THREE.Mesh();
    tilted.rotation.z = THREE.MathUtils.degToRad(data.tilt);
    root.add(tilted); tilted.add(mesh);
    return [data.id, {...data, root, tilted, mesh, orbitCenter: new THREE.Vector3(), orbitLine: new THREE.Line()}];
  }));
}
function update(objects, days, lockedId) {
  loadYear(date(days).getUTCFullYear());
  updatePrimaryOrbits(objects, date(days));
  updateSatelliteOrbits(objects, date(days), lockedId);
  updateBodyRotations(objects, date(days), lockedId);
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
    else assert.ok(ROTATION_PERIOD_DAYS[b.id], `${b.id}: missing independent spin period`);
    for (const file of [b.baseTexture || `2k_${b.texture}.jpg`, b.high].filter(Boolean)) {
      await access(new URL(`../../public/solar-system/textures/${file}`, import.meta.url));
    }
  }
});

test('Pluto and Charon remain mutually locked through the full update pipeline', () => {
  const objects = scene();
  for (const t of [0, .125, .25, .5, .75, 1, 9.25]) {
    update(objects, 6.387 * t);
    for (const [a,b] of [['pluto','charon'],['charon','pluto']]) assert.ok(facing(objects.get(a), objects.get(b)).distanceTo(new THREE.Vector3(1,0,0)) < .04, `${a}: lost near-synchronous alignment`);
  }
  update(objects, 4.2);
  assert.ok(facing(objects.get('eris'), objects.get('dysnomia')).x > .999999);
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

test('obsolete fixed rotation no longer freezes physics; dates reproduce attitudes on rewind', () => {
  const objects = scene();
  for (const id of ['pluto','eris','europa','hyperion','nix','hiiaka','namaka']) {
    update(objects, 10); const start = objects.get(id).mesh.quaternion.clone();
    update(objects, 11, id);
    assert.ok(start.angleTo(objects.get(id).mesh.quaternion) > 1e-7, `${id}: physical spin was frozen`);
    update(objects, 11); update(objects, 10);
    assert.ok(start.angleTo(objects.get(id).mesh.quaternion) < 1e-7, `${id}: rewind failed`);
  }
  update(objects, 10);
  assert.ok(Math.abs(objects.get('hyperion').mesh.rotation.x) > .01);
});

test('Pluto small moons orbit the barycenter while Charon retains the binary displacement', () => {
  const objects = scene(); update(objects, 2.1);
  const p = objects.get('pluto');
  assert.ok(p.root.position.distanceTo(p.orbitCenter) > .1);
  for (const id of ['styx','nix','kerberos','hydra']) {
    const b = objects.get(id);
    assert.ok(Math.abs(b.root.position.distanceTo(p.orbitCenter) - b.orbit) < 1e-8);
    assert.ok(b.orbitLine.position.distanceTo(p.orbitCenter) < 1e-8);
  }
});

test('co-orbital moons exchange inner/outer orbits smoothly without collisions', () => {
  const j = bodies.find(b => b.id === 'janus'), e = bodies.find(b => b.id === 'epimetheus');
  const delta = t => satelliteOrbit(j,date(t)).radius - satelliteOrbit(e,date(t)).radius;
  assert.ok(delta(COORBITAL_SWAP_DAYS/2) * delta(COORBITAL_SWAP_DAYS*1.5) < 0);
  for (let i = 0; i <= 160; i++) {
    const t = i * COORBITAL_SWAP_DAYS / 80;
    const a = satelliteOrbit(j,date(t)), b = satelliteOrbit(e,date(t));
    const distance = Math.hypot(a.radius*Math.cos(a.angle)-b.radius*Math.cos(b.angle), a.radius*Math.sin(a.angle)-b.radius*Math.sin(b.angle));
    assert.ok(distance > j.radius + e.radius, 'co-orbital bodies intersect');
    const next = satelliteOrbit(j,date(t+.000001));
    assert.ok(Math.abs(next.radius-a.radius) < 1e-6);
  }
});

test('names, round major moons, equatorial ridges and the Haumea system are distinct', () => {
  const byId = Object.fromEntries(bodies.map(b => [b.id,b]));
  assert.deepEqual(['nix','hydra','kerberos','styx'].map(id => byId[id].name), ['冥卫二','冥卫三','冥卫四','冥卫五']);
  const sphere = new THREE.SphereGeometry(1,112,80);
  for (const id of ['ariel','umbriel','titania','oberon']) {
    const g = createBodyGeometry(byId[id],sphere); g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x-size.y) < 1e-5 && Math.abs(size.x-size.z) < 1e-5);
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
