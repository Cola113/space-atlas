import * as THREE from 'three';
import { physicalData } from './physical-scale.js';
import { physicalDefinitions } from './physics/definitions.js';
import { bindPhysicalSun } from './physical-lighting.js';

// Regular satellites large enough to leave a readable projection at the overview scales.
// The three inner Saturnian moons are included because the same geometry supports them;
// their small umbra is expected to be difficult to see outside a close framing.
export const MOON_TRANSIT_SYSTEMS = Object.freeze({
  jupiter: Object.freeze(['io', 'europa', 'ganymede', 'callisto']),
  saturn: Object.freeze(['enceladus', 'tethys', 'dione', 'rhea', 'titan']),
});
export const MOON_TRANSIT_SLOTS = 5;

const vectorFrom = value => value instanceof THREE.Vector3 ? value.clone() : new THREE.Vector3().fromArray(value);
const physicalAxes = id => {
  const radius = physicalDefinitions.bodies[id]?.radius;
  if (radius?.semiAxesKm) {
    const [a, b, c] = radius.semiAxesKm;
    // The renderer's +Y axis is the physical spin axis. PCK records X,Y,Z as a,b,c,
    // while the display geometry uses X,Y,Z = equatorial, polar, equatorial.
    return [a, c, b];
  }
  const r = physicalData[id]?.radiusKm || 1;
  return [r, r, r];
};

function ellipsoidHit(origin, direction, axes) {
  const [a, b, c] = axes;
  const aa = a * a, bb = b * b, cc = c * c;
  const A = direction.x ** 2 / aa + direction.y ** 2 / bb + direction.z ** 2 / cc;
  const B = 2 * (origin.x * direction.x / aa + origin.y * direction.y / bb + origin.z * direction.z / cc);
  const C = origin.x ** 2 / aa + origin.y ** 2 / bb + origin.z ** 2 / cc - 1;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0 || A <= 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const roots = [(-B - root) / (2 * A), (-B + root) / (2 * A)].filter(value => value > 0);
  if (!roots.length) return null;
  return Math.min(...roots);
}

function tangentMetrics(point, axes) {
  const [a, b, c] = axes;
  const normal = new THREE.Vector3(point.x / (a * a), point.y / (b * b), point.z / (c * c)).normalize();
  const seed = Math.abs(normal.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangentA = new THREE.Vector3().crossVectors(seed, normal).normalize();
  const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
  // A shader point is expressed as geometry coordinates divided by the parent's
  // equatorial semi-axis. Multiplying by that one scale maps a coordinate
  // difference back to kilometres before projecting onto each tangent.
  return {
    normal,
    metricA: tangentA.multiplyScalar(a),
    metricB: tangentB.multiplyScalar(a),
  };
}

/**
 * Compute a moon's umbra/penumbra intersection with a measured parent ellipsoid.
 * Inputs and outputs are kilometres in one inertial/display frame; no display scale
 * or camera state is accepted here. The finite-Sun cone is a deliberately bounded
 * optical approximation, while the line of centres and ellipsoid intersection are exact
 * for the supplied state.
 */
export function computeMoonTransit({ sunPositionKm, parentPositionKm, moonPositionKm,
  parentAxesKm, moonRadiusKm, sunRadiusKm, parentRotation = new THREE.Quaternion() }) {
  const sun = vectorFrom(sunPositionKm);
  const parent = vectorFrom(parentPositionKm);
  const moon = vectorFrom(moonPositionKm);
  const sunToMoon = moon.clone().sub(sun);
  const sunMoonDistanceKm = sunToMoon.length();
  if (!(sunMoonDistanceKm > 0)) return null;
  const directionWorld = sunToMoon.normalize();
  const moonToParent = parent.clone().sub(moon);
  if (directionWorld.dot(moonToParent) <= 0) return null;
  const inverseRotation = parentRotation.clone().invert();
  const originLocal = moon.clone().sub(parent).applyQuaternion(inverseRotation);
  const directionLocal = directionWorld.clone().applyQuaternion(inverseRotation).normalize();
  const distanceToSurfaceKm = ellipsoidHit(originLocal, directionLocal, parentAxesKm);
  if (distanceToSurfaceKm === null) return null;
  const hitLocalKm = originLocal.clone().addScaledVector(directionLocal, distanceToSurfaceKm);
  const metrics = tangentMetrics(hitLocalKm, parentAxesKm);
  const umbraRadiusKm = moonRadiusKm - distanceToSurfaceKm * (sunRadiusKm - moonRadiusKm) / sunMoonDistanceKm;
  const penumbraRadiusKm = moonRadiusKm + distanceToSurfaceKm * (sunRadiusKm + moonRadiusKm) / sunMoonDistanceKm;
  if (!(penumbraRadiusKm > 0)) return null;
  const [equatorialRadiusKm] = parentAxesKm;
  return {
    active: true,
    distanceToSurfaceKm,
    sunMoonDistanceKm,
    hitLocalKm,
    centerGeometry: hitLocalKm.clone().multiplyScalar(1 / equatorialRadiusKm),
    normalLocal: metrics.normal,
    metricA: metrics.metricA,
    metricB: metrics.metricB,
    umbraRadiusKm: Math.max(0, umbraRadiusKm),
    penumbraRadiusKm,
    shadowDiameterKm: Math.max(0, umbraRadiusKm) * 2,
    parentAxesKm: [...parentAxesKm],
    parentEquatorialRadiusKm: equatorialRadiusKm,
    moonBetweenSunAndParent: true,
  };
}

export function createMoonTransitUniforms() {
  const uniforms = { uMoonTransitEnabled: { value: 0 }, uMoonTransitCount: { value: 0 } };
  for (let index = 0; index < MOON_TRANSIT_SLOTS; index++) {
    uniforms[`uMoonShadowCenter${index}`] = { value: new THREE.Vector3() };
    uniforms[`uMoonShadowMetricA${index}`] = { value: new THREE.Vector3() };
    uniforms[`uMoonShadowMetricB${index}`] = { value: new THREE.Vector3() };
    uniforms[`uMoonShadowUmbra${index}`] = { value: 0 };
    uniforms[`uMoonShadowPenumbra${index}`] = { value: 0 };
  }
  return uniforms;
}

// The spot is evaluated from the physical tangent metrics above, not from a displayed
// satellite position. The outer edge retains a small penumbra so the dark core remains
// legible against high-contrast cloud bands.
export function moonTransitMapFragment() {
  const spots = Array.from({ length: MOON_TRANSIT_SLOTS }, (_, index) => /* glsl */ `
    if (uMoonTransitEnabled > .5 && ${index} < uMoonTransitCount) {
      vec3 moonShadowDelta${index} = vActivityPosition - uMoonShadowCenter${index};
      float moonShadowDistance${index} = length(vec2(
        dot(moonShadowDelta${index}, uMoonShadowMetricA${index}),
        dot(moonShadowDelta${index}, uMoonShadowMetricB${index})));
      float moonCore${index} = uMoonShadowUmbra${index} > 0.0
        ? 1.0 - smoothstep(uMoonShadowUmbra${index} * .68, uMoonShadowUmbra${index}, moonShadowDistance${index})
        : 0.0;
      float moonPenumbra${index} = 1.0 - smoothstep(uMoonShadowUmbra${index}, uMoonShadowPenumbra${index}, moonShadowDistance${index});
      float moonDarkening${index} = max(moonCore${index} * .84, moonPenumbra${index} * .44);
      diffuseColor.rgb *= 1.0 - moonDarkening${index};
    }
  `).join('\n');
  return /* glsl */ `
    ${spots}
  `;
}

function moonGeometry(body) {
  const geometry = body.mesh.geometry.clone();
  geometry.computeBoundingSphere();
  return geometry;
}

function createOverlay(parent, moon) {
  const material = new THREE.MeshStandardMaterial({
    map: moon.mesh.material.map || null,
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  bindPhysicalSun(material, moon.sunDirection);
  const mesh = new THREE.Mesh(moonGeometry(moon), material);
  mesh.name = `${moon.id}-transit-disc`;
  mesh.visible = false;
  mesh.renderOrder = 2;
  parent.mesh.add(mesh);
  return { mesh, material, sourceGeometry: moon.mesh.geometry, sourceMap: moon.mesh.material.map };
}

function refreshOverlay(overlay, parent, moon, geometry) {
  if (overlay.sourceGeometry !== moon.mesh.geometry) {
    overlay.mesh.geometry.dispose();
    overlay.mesh.geometry = moonGeometry(moon);
    overlay.sourceGeometry = moon.mesh.geometry;
  }
  const map = moon.mesh.material.map || null;
  if (overlay.sourceMap !== map) {
    overlay.material.map = map;
    overlay.material.needsUpdate = true;
    overlay.sourceMap = map;
  }
  const parentWorld = parent.mesh.getWorldQuaternion(new THREE.Quaternion());
  const moonWorld = moon.mesh.getWorldQuaternion(new THREE.Quaternion());
  overlay.mesh.quaternion.copy(parentWorld.invert().multiply(moonWorld));
  const normal = geometry.normalLocal.clone();
  const normalGeometry = normal.normalize();
  overlay.mesh.position.copy(geometry.centerGeometry).addScaledVector(normalGeometry, .006);
  overlay.mesh.scale.setScalar(moonRadius(moon.id) / geometry.parentEquatorialRadiusKm);
  overlay.mesh.visible = true;
  // Keep the overlay's physical phase tied to the moon's real Sun direction.
  bindPhysicalSun(overlay.material, moon.sunDirection);
}

function moonRadius(id) { return physicalData[id]?.radiusKm || 0; }

export function createMoonTransitSystem(objects) {
  const overlays = new Map();
  for (const [parentId, moonIds] of Object.entries(MOON_TRANSIT_SYSTEMS)) {
    const parent = objects.get(parentId);
    if (!parent) continue;
    parent.moonTransitUniforms ??= createMoonTransitUniforms();
    overlays.set(parentId, moonIds.map(id => ({ id, overlay: null })));
  }

  function update(frame) {
    for (const [parentId, entries] of overlays) {
      const parent = objects.get(parentId);
      const parentState = frame.bodies.get(parentId);
      const uniforms = parent.moonTransitUniforms;
      uniforms.uMoonTransitCount.value = 0;
      uniforms.uMoonTransitEnabled.value = 0;
      parent.root.updateWorldMatrix(true, true);
      const parentRotation = parent.mesh.getWorldQuaternion(new THREE.Quaternion());
      const axes = physicalAxes(parentId);
      for (const { id } of entries) {
        const moon = objects.get(id);
        const slot = entries.findIndex(entry => entry.id === id);
        const overlay = entries[slot];
        if (overlay.overlay) overlay.overlay.mesh.visible = false;
        const moonState = frame.bodies.get(id);
        if (!moonState || !parentState) continue;
        const geometry = computeMoonTransit({
          sunPositionKm: frame.bodies.get('sun')?.positionKm || new THREE.Vector3(),
          parentPositionKm: parentState.positionKm,
          moonPositionKm: moonState.positionKm,
          parentAxesKm: axes,
          moonRadiusKm: moonRadius(id),
          sunRadiusKm: physicalData.sun.radiusKm,
          parentRotation,
        });
        if (!geometry) continue;
        uniforms[`uMoonShadowCenter${slot}`].value.copy(geometry.centerGeometry);
        uniforms[`uMoonShadowMetricA${slot}`].value.copy(geometry.metricA);
        uniforms[`uMoonShadowMetricB${slot}`].value.copy(geometry.metricB);
        uniforms[`uMoonShadowUmbra${slot}`].value = geometry.umbraRadiusKm;
        uniforms[`uMoonShadowPenumbra${slot}`].value = geometry.penumbraRadiusKm;
        uniforms.uMoonTransitCount.value++;
        if (!overlay.overlay) overlay.overlay = createOverlay(parent, moon);
        refreshOverlay(overlay.overlay, parent, moon, geometry);
      }
      if (uniforms.uMoonTransitCount.value > 0) uniforms.uMoonTransitEnabled.value = 1;
    }
  }

  function snapshot() {
    return Object.fromEntries([...overlays].map(([parentId, entries]) => [parentId, entries.map(({ id, overlay }) => ({
      id,
      visible: Boolean(overlay?.mesh.visible),
      center: objects.get(parentId).moonTransitUniforms[`uMoonShadowCenter${entries.findIndex(entry => entry.id === id)}`].value.toArray(),
      umbraRadiusKm: objects.get(parentId).moonTransitUniforms[`uMoonShadowUmbra${entries.findIndex(entry => entry.id === id)}`].value,
      penumbraRadiusKm: objects.get(parentId).moonTransitUniforms[`uMoonShadowPenumbra${entries.findIndex(entry => entry.id === id)}`].value,
      shadowDiameterKm: objects.get(parentId).moonTransitUniforms[`uMoonShadowUmbra${entries.findIndex(entry => entry.id === id)}`].value * 2,
    }))]));
  }

  return { update, snapshot };
}
