import { Vector3 } from 'three';

export function uvDirection([u, v]) {
  const phi = u * Math.PI * 2, theta = (1 - v) * Math.PI;
  return new Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}

// Cast from the dense B ring toward the sphere, opposite the incident sunlight.
// Radii and the equatorial plane match the existing ring-shadow shader.
export function ringShadowAnchor(sun) {
  if (Math.abs(sun.y) < .002) return null;
  const ring = new Vector3(sun.x, 0, sun.z).normalize().multiplyScalar(1.7);
  const along = ring.dot(sun), discriminant = along * along - ring.lengthSq() + 1;
  if (discriminant <= 0) return null;
  return ring.addScaledVector(sun, -along + Math.sqrt(discriminant)).normalize();
}

export const solarEruptionAxis = new Vector3(.88, .32, .26).normalize();
export const volcanicAxis = new Vector3(.07, .19, .98).normalize();
export const icePlumeAxis = new Vector3(.1375, -1, 0).normalize();

export function plumeViewDirection(point) {
  const normal = point.clone().normalize();
  const side = new Vector3().crossVectors(normal, new Vector3(0, 0, 1)).normalize();
  return normal.multiplyScalar(.48).addScaledVector(side, .88).normalize();
}
