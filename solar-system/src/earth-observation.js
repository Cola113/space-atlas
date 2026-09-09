import * as THREE from "three";
import { Body, Equator, Observer, SiderealTime } from "astronomy-engine";

const observer = new Observer(0, 0, 0);
const sunDirection = new THREE.Vector3();
const inverseTilt = new THREE.Quaternion();
const RAD = Math.PI / 180;

export function subsolarPoint(date) {
  const equator = Equator(Body.Sun, date, observer, true, false);
  return { latitude: equator.dec,
    longitude: THREE.MathUtils.euclideanModulo((equator.ra - SiderealTime(date)) * 15 + 180, 360) - 180 };
}

export function alignObservedEarth(body, point) {
  // Match the ecliptic scene's longitude offset (-2 radians) and north axis.
  body.tilted.rotation.set(-23.43928 * RAD, -2, 0, "YXZ");
  inverseTilt.copy(body.tilted.quaternion).invert();
  sunDirection.copy(body.root.position).negate().normalize().applyQuaternion(inverseTilt);
  body.mesh.rotation.y = Math.atan2(-sunDirection.z, sunDirection.x) - point.longitude * RAD;
  body.clouds.rotation.copy(body.mesh.rotation);
}
