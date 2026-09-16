import test from 'node:test';
import assert from 'node:assert/strict';
import { MathUtils } from 'three';
import { skyGlobeGeometry } from '../src/surface/SurfaceSky.js';
import { bodyModels } from '../src/body-models.js';
import { baseTextureKey, bodyTexturePath } from '../src/body-textures.js';
import { createRingSystemGeometry, ringSystemFor } from '../src/ring-systems.js';
import { createRingSurfaceMaterial } from '../src/ring-photometry.js';
import { bodies } from '../src/data.js';
import { landingSites } from '../src/surface/geometry.js';

const axes = geometry => {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
};

test('the landing sky draws every body with the catalogue outline, not a sphere', () => {
  for (const [id, model] of Object.entries(bodyModels)) {
    if (!model.shape && !model.ridge) continue;
    const [x, y, z] = axes(skyGlobeGeometry(id, true));
    // A ridge rescales the whole body so its widest radius stays 1, so the polar ratio
    // below only holds for the bodies whose outline is the ellipsoid alone.
    if (model.shape && !model.ridge) {
      const [sx, sy, sz] = model.shape;
      assert.ok(Math.abs(y / x - sy / sx) < 1e-6, `${id}: polar/equatorial ratio ${y / x} is not the modelled ${sy / sx}`);
      assert.ok(Math.abs(z / x - sz / sx) < 1e-6, `${id}: third axis ratio ${z / x} is not the modelled ${sz / sx}`);
    }
    // A body without a published triaxial shape stays a sphere, and one with a ridge is
    // widest at its equator rather than at its poles.
    if (!model.shape && !model.ridge) assert.ok(Math.abs(y / x - 1) < 1e-6, id);
    if (model.ridge) assert.ok(x > y, `${id}: the equatorial ridge did not widen the equator`);
  }
  // The parents a landing sky actually shows are the flattened ones, so this is not a
  // theoretical check: Jupiter and Saturn are nine and ten percent wider than tall.
  for (const id of ['jupiter', 'saturn', 'uranus']) {
    const [x, y] = axes(skyGlobeGeometry(id, true));
    assert.ok(y / x < 0.99, `${id} is drawn round (${y / x})`);
  }
});

test('the landing sky takes each body texture from the same catalogue entry as the overview', () => {
  const byId = new Map(bodies.map(body => [body.id, body]));
  for (const [siteId, site] of Object.entries(landingSites)) {
    const body = byId.get(site.parent.toLowerCase());
    assert.ok(body, `${siteId}: ${site.parent} is not in the catalogue`);
    assert.equal(bodyTexturePath(site.parent), `/solar-system/textures/${baseTextureKey(body)}`, siteId);
  }
  // The bodies whose shipped map is a processed file must not fall back to the older jpg.
  assert.equal(bodyTexturePath('pluto'), '/solar-system/textures/completed/pluto-1920.webp');
  assert.equal(bodyTexturePath('charon'), '/solar-system/textures/repaired/charon-1920.webp');
  assert.equal(landingSites.pluto.texture.startsWith('/surface/'), true, 'the ground panorama is still a landing asset');
});

test('the landing ring is the measured system shaded from the slab tables', () => {
  const system = ringSystemFor('saturn');
  const geometry = createRingSystemGeometry(system);
  let inner = Infinity, outer = -Infinity;
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getY(i));
    if (radius < inner) inner = radius;
    if (radius > outer) outer = radius;
  }
  inner *= system.equatorialKm; outer *= system.equatorialKm;
  const measured = system.regions.reduce(([lo, hi], [, innerKm, outerKm]) =>
    [Math.min(lo, innerKm), Math.max(hi, outerKm)], [Infinity, -Infinity]);
  assert.ok(Math.abs(inner - measured[0]) < 1, `the ring starts at ${inner.toFixed(0)} km, not ${measured[0]}`);
  assert.ok(Math.abs(outer - measured[1]) < 1, `the ring ends at ${outer.toFixed(0)} km, not ${measured[1]}`);
  assert.equal(system.regions.length, 401, 'the measured region table changed size');

  const material = createRingSurfaceMaterial({ scattering: {}, rows: 1, phaseG: system.phaseG, lightIntensity: 2.2 });
  // Lambert is what made the ring black at a ring-plane crossing; the slab terms are what
  // replaced it, and the opacity must follow the same optical depth.
  for (const term of ['ringSlabReflectance', 'ringSlabTransmittance', 'ringOppositionSurge', 'ringParticleColour'])
    assert.ok(material.fragmentShader.includes(term), `the ring shader lost ${term}`);
  assert.ok(material.fragmentShader.includes('1.0 - exp(-tau / mu)'), 'ring opacity no longer follows the optical depth');
  assert.ok(!/vNormal|normalMatrix/.test(material.fragmentShader), 'the ring must not be shaded as a surface');
  assert.equal(material.uniforms.uRingLight.value, 2.2, 'the ring is lit with the same intensity as the globes');
  assert.ok(Math.abs(material.uniforms.uRingDisplayLevel.value - 0.85) < 1e-9);
});

test('the sky places bodies by angle, so the drawn size is the physical one', () => {
  // SurfaceSky scales each globe by distance*radius/distance about the observer, which is
  // asin(R/d) of angular radius; the same expression the details panel reports.
  const radiusKm = 71492, distanceKm = 421700, skyDistance = 300 + 900 * distanceKm / (distanceKm + 149597870.7);
  const scale = skyDistance * radiusKm / distanceKm;
  // A sphere's silhouette is its tangent cone, so the drawn angular radius is the arcsine
  // of scale/distance, which is exactly asin(R/d) for the scale the sky uses.
  const drawn = 2 * MathUtils.radToDeg(Math.asin(scale / skyDistance));
  const physical = 2 * MathUtils.radToDeg(Math.asin(radiusKm / distanceKm));
  assert.ok(Math.abs(drawn - physical) < 1e-9, `${drawn} vs ${physical}`);
});
