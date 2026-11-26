import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bodies } from '../src/data.js';
import { physicalData } from '../src/physical-scale.js';
import { updateDisplayState } from '../src/orbits.js';
import { createBodyGeometry } from '../src/body-geometry.js';
import { computeMoonTransit, physicalAxes, physicalGeometryRotation } from '../src/moon-transits.js';
import { geographicNormal, mirrorStrength } from '../src/titan-glint.js';
import { resolveLandingSite, surfaceFrame, horizonAngles, sunHiddenByParent } from '../src/surface/geometry.js';
import { evaluateSunspots } from '../src/solar-sunspots.js';
import {
  CELESTIAL_MOMENTS,
  momentById,
  computeMomentCameraOffset,
  findNextJupiterShadowTransit,
} from '../src/celestial-moments.js';
import { localPhysics, prepareSurfaceTests } from './physical-fixture.js';

before(prepareSurfaceTests);

function mockObjects(ids) {
  return new Map(bodies.filter((b) => ids.includes(b.id)).map((b) => {
    const root = new THREE.Group();
    const tilted = new THREE.Group();
    const mesh = new THREE.Mesh(createBodyGeometry(b, new THREE.SphereGeometry(1, 24, 16)), new THREE.MeshStandardMaterial());
    root.add(tilted);
    tilted.add(mesh);
    mesh.scale.setScalar(b.radius);
    return [b.id, { ...b, root, tilted, mesh, orbitCenter: new THREE.Vector3() }];
  }));
}

test('curated celestial moments have valid metadata, targets, and dates inside 1900-2100', () => {
  const seen = new Set();
  const bodyIds = new Set(bodies.map((b) => b.id));
  assert.ok(CELESTIAL_MOMENTS.length >= 8);
  for (const m of CELESTIAL_MOMENTS) {
    assert.ok(!seen.has(m.id), `duplicate moment id ${m.id}`);
    seen.add(m.id);
    assert.equal(momentById(m.id), m);
    assert.ok(bodyIds.has(m.bodyId), `unknown bodyId ${m.bodyId}`);
    const year = new Date(m.date).getUTCFullYear();
    assert.ok(year >= 1900 && year <= 2100, `moment ${m.id} date out of ephemeris range: ${m.date}`);
    assert.ok(m.provenance && m.summary && m.title);
    if (m.category === 'surface') {
      const site = resolveLandingSite(m.siteId);
      assert.ok(site && site.id === m.bodyId, `invalid surface site ${m.siteId} for ${m.id}`);
    }
  }
});

test('orbital moments verify real shadow transits, Titan specular glint alignment, and sunspot framing', async () => {
  const provider = localPhysics();
  try {
    // 1. Io shadow transit on Jupiter
    const ioMoment = momentById('io-shadow-transit');
    const ioFrame = provider.frame(new Date(ioMoment.date));
    const ioShadow = computeMoonTransit({
      sunPositionKm: ioFrame.bodies.get('sun').positionKm,
      parentPositionKm: ioFrame.bodies.get('jupiter').positionKm,
      moonPositionKm: ioFrame.bodies.get('io').positionKm,
      parentAxesKm: physicalAxes('jupiter'),
      parentRotation: physicalGeometryRotation(ioFrame.bodies.get('jupiter').orientation),
      moonRadiusKm: physicalData.io.radiusKm,
      sunRadiusKm: physicalData.sun.radiusKm,
    });
    assert.ok(ioShadow && ioShadow.shadowDiameterKm > 2900 && ioShadow.shadowDiameterKm < 3150);

    // 2. Titan shadow transit on Saturn (SAT441)
    const titanTransit = momentById('titan-shadow-transit');
    await provider.ensure(new Date(titanTransit.date), ['titan'], { prefetch: false });
    const satFrame = provider.frame(new Date(titanTransit.date));
    const titanShadow = computeMoonTransit({
      sunPositionKm: satFrame.bodies.get('sun').positionKm,
      parentPositionKm: satFrame.bodies.get('saturn').positionKm,
      moonPositionKm: satFrame.bodies.get('titan').positionKm,
      parentAxesKm: physicalAxes('saturn'),
      parentRotation: physicalGeometryRotation(satFrame.bodies.get('saturn').orientation),
      moonRadiusKm: physicalData.titan.radiusKm,
      sunRadiusKm: physicalData.sun.radiusKm,
    });
    assert.ok(titanShadow && titanShadow.shadowDiameterKm > 3800 && titanShadow.shadowDiameterKm < 4200);

    // 3. Titan sea glint exact mirror camera direction (finite-distance ray from surface point to camera)
    const glintMoment = momentById('titan-sea-glint');
    await provider.ensure(new Date(glintMoment.date), ['titan'], { prefetch: false });
    const glintFrame = provider.frame(new Date(glintMoment.date));
    const objs = mockObjects(['sun', 'saturn', 'titan']);
    updateDisplayState(objs, glintFrame, { guides: false });
    const titan = objs.get('titan');
    const offset = computeMomentCameraOffset({ moment: glintMoment, body: titan, frame: glintFrame, baseDistance: 5 });
    assert.ok(offset && offset.length() > 0);
    titan.mesh.updateWorldMatrix(true, false);
    const localNormal = geographicNormal(glintMoment.glintTarget.latitude, glintMoment.glintTarget.longitude);
    const normalWorld = localNormal.clone().transformDirection(titan.mesh.matrixWorld).normalize();
    const surfaceWorld = localNormal.clone().applyMatrix4(titan.mesh.matrixWorld);
    const cameraWorld = titan.root.position.clone().add(offset);
    const viewRay = cameraWorld.sub(surfaceWorld).normalize();
    const strength = mirrorStrength(titan.sunDirection, normalWorld, viewRay, 1);
    assert.ok(strength > 0.9999, `expected peak finite-distance Titan glint alignment, got ${strength}`);

    // 4. Sun differential spots moment
    const sunMoment = momentById('sun-differential-spots');
    assert.ok(evaluateSunspots(sunMoment.date).length >= 4);
    const sunObjs = mockObjects(['sun']);
    const sunFrame = provider.frame(new Date(sunMoment.date));
    updateDisplayState(sunObjs, sunFrame, { guides: false });
    const sunOffset = computeMomentCameraOffset({ moment: sunMoment, body: sunObjs.get('sun'), frame: sunFrame, baseDistance: 15 });
    assert.ok(sunOffset && Math.abs(sunOffset.length() - 15 * 0.86) < 1e-6);
  } finally {
    provider.dispose();
  }
});

test('surface moments verify real Phobos daylight/Mars sky and Miranda 2085 summer sun', async () => {
  const provider = localPhysics();
  try {
    const phobosMoment = momentById('phobos-mars-sky');
    await provider.ensure(new Date(phobosMoment.date), ['phobos', 'mars'], { prefetch: false });
    const phobosSite = resolveLandingSite(phobosMoment.siteId);
    const phobosFrame = surfaceFrame(phobosSite, new Date(phobosMoment.date), provider);
    assert.equal(sunHiddenByParent(phobosFrame, phobosSite), false);
    assert.ok(horizonAngles(phobosFrame.targets.Mars.direction).altitude > 35);
    assert.ok(THREE.MathUtils.radToDeg(phobosFrame.targets.Mars.angularDiameter) > 40);

    const mirandaMoment = momentById('miranda-summer-2085');
    await provider.ensure(new Date(mirandaMoment.date), ['miranda', 'uranus'], { prefetch: false });
    const mirandaSite = resolveLandingSite(mirandaMoment.siteId);
    let maxAlt = -90;
    for (let h = 0; h < 36; h += 2) {
      const f = surfaceFrame(mirandaSite, new Date(Date.parse(mirandaMoment.date) + h * 3600000), provider);
      maxAlt = Math.max(maxAlt, horizonAngles(f.targets.Sun.direction).altitude);
    }
    assert.ok(maxAlt > 65, `expected high summer Sun on Miranda in 2085, maxAlt=${maxAlt}`);
  } finally {
    provider.dispose();
  }
});

test('live Jupiter shadow transit finder locates a real upcoming transit from any date', () => {
  const provider = localPhysics();
  try {
    for (const startIso of ['2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z']) {
      const startMs = Date.parse(startIso);
      const found = findNextJupiterShadowTransit(startMs, provider);
      assert.ok(found, `failed to find Jupiter shadow transit after ${startIso}`);
      assert.ok(Date.parse(found.date) > startMs, 'found transit must lie strictly after start date');
      assert.equal(found.bodyId, 'jupiter');
      assert.ok(found.incidence > 0.65 && found.umbraKm > 1000);
      // Independently verify the returned date actually casts a shadow.
      const frame = provider.frame(new Date(found.date));
      const shadow = computeMoonTransit({
        sunPositionKm: frame.bodies.get('sun').positionKm,
        parentPositionKm: frame.bodies.get('jupiter').positionKm,
        moonPositionKm: frame.bodies.get(found.transitMoon).positionKm,
        parentAxesKm: physicalAxes('jupiter'),
        parentRotation: physicalGeometryRotation(frame.bodies.get('jupiter').orientation),
        moonRadiusKm: physicalData[found.transitMoon].radiusKm,
        sunRadiusKm: physicalData.sun.radiusKm,
      });
      assert.ok(shadow, `returned transit ${found.date} for ${found.transitMoon} did not intersect Jupiter`);
    }
  } finally {
    provider.dispose();
  }
});
