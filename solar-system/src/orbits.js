import * as THREE from "three";
import { Ecliptic, HelioVector } from "astronomy-engine";
import { DISPLAY_LONGITUDE_OFFSET } from "./sky-coordinates.js";

const TAU = Math.PI * 2;
const axis = new THREE.Vector3(0, 0, 1);
const offset = new THREE.Vector3();
const plane = new THREE.Quaternion();
const epoch = Date.UTC(2000, 0, 1, 12);

export function orbitPoint(body, angle, target = new THREE.Vector3()) {
  return target
    .set(Math.cos(angle) * body.orbit, 0, Math.sin(angle) * body.orbit)
    .applyAxisAngle(axis, THREE.MathUtils.degToRad(body.inclination || 0));
}

export function updatePrimaryOrbits(objects, date) {
  for (const body of objects.values()) {
    if (!body.orbit || body.parent) continue;
    if (body.body) {
      const vector = Ecliptic(HelioVector(body.body, date));
      const longitude = THREE.MathUtils.degToRad(vector.elon) - DISPLAY_LONGITUDE_OFFSET;
      const latitude = THREE.MathUtils.degToRad(vector.elat) * 0.3;
      body.root.position.set(
        Math.cos(longitude) * Math.cos(latitude) * body.orbit,
        Math.sin(latitude) * body.orbit,
        -Math.sin(longitude) * Math.cos(latitude) * body.orbit,
      );
    } else {
      const phase = ((date.getTime() - epoch) / 86400000 / body.orbitDays) % 1;
      orbitPoint(body, body.orbitPhase + phase * TAU, body.root.position);
    }
    body.orbitCenter.copy(body.root.position);
  }
}

export function updateSatelliteOrbits(objects, elapsed, lockedId) {
  for (const body of objects.values()) {
    if (!body.parent) continue;
    const parent = objects.get(body.parent);
    // Compress the range of periods so small satellite systems remain observable.
    const period = 24 * Math.sqrt(body.period);
    const angle =
      body.orbitPhase +
      ((elapsed / period) % 1) * TAU * (body.retrograde ? -1 : 1);
    orbitPoint(body, angle, offset).applyQuaternion(parent.tilted.quaternion);
    if (body.id === "charon") {
      parent.root.position
        .copy(parent.orbitCenter)
        .addScaledVector(offset, -0.1085);
      if (parent.id !== lockedId) parent.mesh.rotation.y = -angle;
    }
    body.root.position.copy(parent.root.position).add(offset);
    plane.setFromAxisAngle(
      axis,
      THREE.MathUtils.degToRad(body.inclination || 0),
    );
    body.tilted.quaternion.copy(parent.tilted.quaternion).multiply(plane);
    if (body.id !== lockedId) body.mesh.rotation.y = -angle;
    body.orbitLine.position.copy(parent.root.position);
    body.orbitLine.quaternion.copy(parent.tilted.quaternion);
  }
}
