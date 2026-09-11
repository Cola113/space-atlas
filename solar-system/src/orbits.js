import * as THREE from "three";
import { Ecliptic, HelioVector } from "astronomy-engine";
import { DISPLAY_LONGITUDE_OFFSET } from "./sky-coordinates.js";

const TAU = Math.PI * 2;
const axis = new THREE.Vector3(0, 0, 1);
const offset = new THREE.Vector3();
const plane = new THREE.Quaternion();
export const SIMULATION_EPOCH = Date.UTC(2000, 0, 1, 12);
const DAY = 86400000;

// The old scene advanced satellite angles with a separate wall-clock timer.
// Keep one date as the source of truth so a given speed has the same meaning
// in the orbit view and on a surface.
export const ROTATION_PERIOD_DAYS = Object.freeze({
  sun: 25.38, mercury: 58.646, venus: -243.025, earth: .99726968,
  mars: 1.02595675, jupiter: .41354, saturn: .44401, uranus: -.71833,
  neptune: .67125, pluto: 6.387, ceres: .37809, vesta: .22258,
});
const ROTATION_PHASE = Object.freeze({ earth: 3.3, jupiter: -1 });

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
      const phase = ((date.getTime() - SIMULATION_EPOCH) / DAY / body.orbitDays) % 1;
      orbitPoint(body, body.orbitPhase + phase * TAU, body.root.position);
    }
    body.orbitCenter.copy(body.root.position);
  }
}

export function updateSatelliteOrbits(objects, date, lockedId) {
  for (const body of objects.values()) {
    if (!body.parent) continue;
    const parent = objects.get(body.parent);
    const period = body.period;
    const angle =
      body.orbitPhase +
      (((date.getTime() - SIMULATION_EPOCH) / DAY / period) % 1) * TAU * (body.retrograde ? -1 : 1);
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

export function updateBodyRotations(objects, date, lockedId = null) {
  const days = (date.getTime() - SIMULATION_EPOCH) / DAY;
  for (const body of objects.values()) {
    if (body.parent || body.id === lockedId) continue;
    const period = ROTATION_PERIOD_DAYS[body.id];
    if (!period) continue;
    body.mesh.rotation.y = (ROTATION_PHASE[body.id] || 0) + days * TAU / period;
    if (body.clouds && body.id !== 'earth') body.clouds.rotation.y = body.mesh.rotation.y;
    if (body.clouds && body.id === 'earth') body.clouds.rotation.y = body.mesh.rotation.y;
  }
}
