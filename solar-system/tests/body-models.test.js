import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import * as THREE from 'three';
import { bodies } from '../src/data.js';
import { physicalData } from '../src/physical-scale.js';
import { createBodyGeometry, createNarrowRing } from '../src/body-geometry.js';
import { updateDisplayState } from '../src/orbits.js';
import { meanElements, meanMotion, COORBITAL_SWAP_DAYS } from '../src/physics/mean-motion.js';
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
    tilted.rotation.z = THREE.MathUtils.degToRad(data.tilt);
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
    assert.ok(Math.abs(b.root.position.distanceTo(p.orbitCenter) - b.orbit) < 1e-8);
    assert.ok(b.orbitLine.position.distanceTo(p.orbitCenter) < 1e-8);
  }
});

function meanOrbit(body,t){
  const physical=provider.frame(date(t)).bodies.get(body.id);
  // Express its physical plane in units of its display radius for the existing
  // qualitative collision check; never feed this scale into physical state.
  const model=meanElements.bodies[body.id],phase=t/COORBITAL_SWAP_DAYS*Math.PI;
  const r=physical.relativeKm.length()/physicalData[body.id].orbitKm*body.orbit;
  const north=provider.frame(date(t)).bodies.get(model.parent).orientation.north;
  const node=new THREE.Vector3(0,0,1).cross(north).normalize(),east=north.clone().cross(node);
  return {radius:r,angle:Math.atan2(physical.relativeKm.dot(east),physical.relativeKm.dot(node))};
}
test('co-orbital moons exchange inner/outer orbits smoothly without collisions', () => {
  const j = bodies.find(b => b.id === 'janus'), e = bodies.find(b => b.id === 'epimetheus');
  const delta = t => meanOrbit(j,t).radius - meanOrbit(e,t).radius;
  assert.ok(delta(COORBITAL_SWAP_DAYS/2) * delta(COORBITAL_SWAP_DAYS*1.5) < 0);
  for (let i = 0; i <= 160; i++) {
    const t = i * COORBITAL_SWAP_DAYS / 80;
    const a = meanOrbit(j,t), b = meanOrbit(e,t);
    const distance = Math.hypot(a.radius*Math.cos(a.angle)-b.radius*Math.cos(b.angle), a.radius*Math.sin(a.angle)-b.radius*Math.sin(b.angle));
    assert.ok(distance > j.radius + e.radius, 'co-orbital bodies intersect');
    const next = meanOrbit(j,t+.000001);
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
