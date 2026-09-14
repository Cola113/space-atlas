import { Vector3 } from 'three';

export function uvDirection([u, v]) {
  const phi = u * Math.PI * 2, theta = (1 - v) * Math.PI;
  return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

// Cast from the dense B ring toward the sphere, opposite the incident sunlight.
// Radii and the equatorial plane match the existing ring-shadow shader.
//
// `shape` holds the semi-axes in body-radius units. Comparing in the space where
// each axis is divided by its semi-axis turns the ray/ellipsoid intersection into a
// ray against a unit sphere; normalising the unit-sphere hit and rescaling it onto
// the ellipsoid afterwards lands on a different point, by up to the flattening.
export function ringShadowAnchor(sun, shape = [1, 1, 1]) {
  if (Math.abs(sun.y) < .002) return null;
  const ring = new Vector3(sun.x, 0, sun.z).normalize().multiplyScalar(1.7);
  const [sx, sy, sz] = shape;
  const scaledRing = new Vector3(ring.x / sx, ring.y / sy, ring.z / sz);
  const scaledSun = new Vector3(sun.x / sx, sun.y / sy, sun.z / sz);
  const along = scaledRing.dot(scaledSun), squared = scaledSun.lengthSq();
  const discriminant = along * along - squared * (scaledRing.lengthSq() - 1);
  if (discriminant < 0) return null;
  const travel = (along - Math.sqrt(discriminant)) / squared;
  return travel > 0 ? ring.addScaledVector(sun, -travel) : null;
}

export const solarEruptionAxis = new Vector3(.88, .32, .26).normalize();
export const volcanicAxis = new Vector3(.07, .19, .98).normalize();
export const icePlumeAxis = new Vector3(.1375, -1, 0).normalize();

export function plumeViewDirection(point) {
  const normal = point.clone().normalize();
  const side = new Vector3().crossVectors(normal, new Vector3(0, 0, 1)).normalize();
  return normal.multiplyScalar(.48).addScaledVector(side, .88).normalize();
}
