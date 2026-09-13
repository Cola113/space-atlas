import * as THREE from "three";
import { Body, Equator, Observer, SiderealTime } from "astronomy-engine";

const observer = new Observer(0, 0, 0);
const RAD = Math.PI / 180;

export function physicalSubsolarPoint(frame) {
  const earth=frame.bodies.get('earth');
  const sun=earth.positionKm.clone().negate().normalize();
  const {prime,east,north}=earth.orientation;
  return {latitude:Math.asin(sun.dot(north))/RAD,
    longitude:Math.atan2(sun.dot(east),sun.dot(prime))/RAD};
}

export function subsolarPoint(date) {
  const equator = Equator(Body.Sun, date, observer, true, false);
  return { latitude: equator.dec,
    longitude: THREE.MathUtils.euclideanModulo((equator.ra - SiderealTime(date)) * 15 + 180, 360) - 180 };
}
