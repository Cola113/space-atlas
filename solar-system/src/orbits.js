import * as THREE from "three";
import { Ecliptic, HelioVector } from "astronomy-engine";
import { physicalState, basisQuaternion, AU_KM } from "./physical-state.js";
import {physicalData} from "./physical-scale.js";
import { skyRotation, DISPLAY_LONGITUDE_OFFSET } from "./sky-coordinates.js";
import { bodyModels } from './body-models.js';

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
  ...Object.fromEntries(Object.entries(bodyModels).filter(([, model]) => model.spinDays).map(([id, model]) => [id, model.spinDays])),
});
const ROTATION_PHASE = Object.freeze({ earth: 3.3, jupiter: -1 });

// A retrograde flag defines the travel direction; represent the plane with an
// acute inclination so a >90 degree plane cannot reverse that direction again.
export function orbitInclination(body) {
  const inclination = body.inclination || 0;
  return body.retrograde && inclination > 90 ? 180 - inclination : inclination;
}

export function orbitPoint(body, angle, target = new THREE.Vector3()) {
  return target
    .set(Math.cos(angle) * body.orbit, 0, Math.sin(angle) * body.orbit)
    .applyAxisAngle(axis, THREE.MathUtils.degToRad(orbitInclination(body)));
}

export const COORBITAL_SWAP_DAYS = 4 * 365.25;
export function satelliteOrbit(body, date) {
  const days = (date.getTime() - SIMULATION_EPOCH) / DAY;
  if (body.coorbital) {
    // A smooth horseshoe *display* model, not an N-body ephemeris. Opposite
    // radial offsets exchange every four years; the angular gap never closes.
    const phase = days / COORBITAL_SWAP_DAYS * Math.PI;
    const separation = Math.PI + (Math.PI - .12) * Math.cos(phase);
    const weight = body.id === 'janus' ? .2 : -.8;
    const common = (days / .69435 % 1) * TAU;
    return {angle: common + weight * separation, radius: body.orbit * (1 + weight * .035 * Math.sin(phase))};
  }
  return {angle: body.orbitPhase + (days / body.period % 1) * TAU * (body.retrograde ? -1 : 1), radius: body.orbit};
}

export function updatePrimaryOrbits(objects, date) {
  const snapshot=physicalState(date),rotation=skyRotation(date);
  for (const body of objects.values()) {
    if (!body.orbit || body.parent) continue;
    const physical=snapshot.states.get(body.id);
    if (physical && physicalData[body.id]?.orbitAU) {
      body.root.position.copy(physical.position).applyMatrix3(rotation).multiplyScalar(body.orbit/physicalData[body.id].orbitAU);
      body.physical=physical;
      const north=physical.basis.north,node=new THREE.Vector3(-north.y,north.x,0).normalize();
      body.tilted.quaternion.copy(basisQuaternion({prime:node,north,east:north.clone().cross(node)},rotation));
    } else {
      const phase = ((date.getTime() - SIMULATION_EPOCH) / DAY / body.orbitDays) % 1;
      orbitPoint(body, body.orbitPhase + phase * TAU, body.root.position);
    }
    body.orbitCenter.copy(body.root.position);
  }
}

export function updateSatelliteOrbits(objects, date) {
  const snapshot=physicalState(date),rotation=skyRotation(date);
  for (const body of objects.values()) {
    if (!body.parent) continue;
    const parent = objects.get(body.parent);
    const physical=snapshot.states.get(body.id),parentPhysical=snapshot.states.get(body.parent);
    if(physical&&parentPhysical){
      offset.copy(physical.position).sub(parentPhysical.position).applyMatrix3(rotation).multiplyScalar(AU_KM*body.orbit/physicalData[body.id].orbitKm);
      body.root.position.copy(parent.root.position).add(offset);body.physical=physical;
      if(body.id==="charon")parent.orbitCenter.copy(parent.root.position).addScaledVector(offset,.1085);
      if(body.orbitLine){body.orbitLine.position.copy(parent.root.position);body.orbitLine.quaternion.identity();}
      continue;
    }
    const {angle, radius} = satelliteOrbit(body, date);
    orbitPoint(body, angle, offset).multiplyScalar(radius / body.orbit).applyQuaternion(parent.tilted.quaternion);
    if (body.id === "charon") {
      parent.root.position
        .copy(parent.orbitCenter)
        .addScaledVector(offset, -0.1085);
    }
    const center = body.orbitFrame === 'barycenter' ? parent.orbitCenter : parent.root.position;
    body.root.position.copy(center).add(offset);
    plane.setFromAxisAngle(
      axis,
      THREE.MathUtils.degToRad(orbitInclination(body)),
    );
    body.tilted.quaternion.copy(parent.tilted.quaternion).multiply(plane);
    // Independent spin is updated separately. A synchronous moon points its
    // local +X toward its parent; all axes honor the fixed-rotation control.
    if (!ROTATION_PERIOD_DAYS[body.id]) body.mesh.rotation.set(0, Math.PI - angle, 0);
    body.orbitLine.position.copy(center);
    body.orbitLine.quaternion.copy(parent.tilted.quaternion);
    body.orbitLine.scale.setScalar(radius / body.orbit);
  }
}

export function updateBodyRotations(objects, date) {
  const snapshot=physicalState(date),rotation=skyRotation(date);
  const days = (date.getTime() - SIMULATION_EPOCH) / DAY;
  for (const body of objects.values()) {
    const physical=snapshot.states.get(body.id);
    if(physical){
      const north=physical.basis.north,node=new THREE.Vector3(-north.y,north.x,0).normalize();
      const pole=basisQuaternion({prime:node,north,east:north.clone().cross(node)},rotation);
      body.tilted.quaternion.copy(pole);
      body.mesh.quaternion.copy(pole.clone().invert().multiply(basisQuaternion(physical.basis,rotation)));
      if(body.clouds)body.clouds.quaternion.copy(body.mesh.quaternion);
      body.physical=physical;body.physicalSun=physical.position.clone().negate().applyMatrix3(rotation).normalize();continue;
    }
    if (body.tidalPartner && objects.has(body.tidalPartner)) {
      const direction = objects.get(body.tidalPartner).root.position.clone().sub(body.root.position)
        .applyQuaternion(body.tilted.quaternion.clone().invert());
      body.mesh.rotation.set(0, Math.atan2(-direction.z, direction.x), 0);
      continue;
    }
    const period = ROTATION_PERIOD_DAYS[body.id];
    if (!period) continue;
    const phase = days * TAU / period;
    if (body.tumbling) {
      // Deterministic irregular attitude illustration, deliberately not claimed
      // to predict chaotic motion. Absolute dates support pause, rewind/reload.
      body.mesh.rotation.set(.9 * Math.sin(phase * .371) + .35 * Math.sin(phase * .113),
        (phase + .7 * Math.sin(phase * .173)) % TAU, .7 * Math.sin(phase * .613));
    } else body.mesh.rotation.set(0, ((ROTATION_PHASE[body.id] || 0) + phase) % TAU, 0);
    if (body.clouds) body.clouds.rotation.copy(body.mesh.rotation);
  }
}
