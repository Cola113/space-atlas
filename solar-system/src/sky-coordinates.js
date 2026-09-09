import { Matrix3, Vector3, MathUtils } from 'three';
import { Rotation_EQJ_ECT, Rotation_EQJ_GAL } from 'astronomy-engine';

// Match the existing illustrated orbit orientation without changing the orbits.
export const DISPLAY_LONGITUDE_OFFSET = 2;
const c = Math.cos(DISPLAY_LONGITUDE_OFFSET), s = Math.sin(DISPLAY_LONGITUDE_OFFSET);
const eclipticToScene = new Matrix3().set(c, s, 0, 0, 0, 1, s, -c, 0);

function astronomyMatrix(rotation) {
  // Astronomy Engine stores its rotation matrix as columns, as does Three.js.
  return new Matrix3().fromArray(rotation.rot.flat());
}
export const equatorialToGalactic = astronomyMatrix(Rotation_EQJ_GAL());
export function skyRotation(date) {
  return new Matrix3().multiplyMatrices(eclipticToScene, astronomyMatrix(Rotation_EQJ_ECT(date)));
}
export function equatorialDirection(ra, dec, target = new Vector3()) {
  return target.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}
export function galacticUv(direction) {
  const galactic = direction.clone().applyMatrix3(equatorialToGalactic).normalize();
  return [MathUtils.euclideanModulo(0.5 - Math.atan2(galactic.y, galactic.x) / (2 * Math.PI), 1),
    0.5 + Math.asin(MathUtils.clamp(galactic.z, -1, 1)) / Math.PI];
}
export function starAppearance(magnitude, colourIndex) {
  // Compress flux for a normal display, preserving apparent-magnitude order.
  const flux = 10 ** (-0.4 * magnitude);
  const brightness = MathUtils.clamp(0.24 * Math.sqrt(flux / 10 ** (-1.2)), 0.035, 0.95);
  const size = MathUtils.clamp(1.3 + (6.5 - magnitude) * 0.07, 1.3, 1.85);
  // Subtle display colours from B-V; missing measurements stay neutral.
  const t = colourIndex === null ? 0.4 : MathUtils.clamp((colourIndex + 0.3) / 2.1, 0, 1);
  const colour = t < 0.4
    ? [MathUtils.lerp(0.7, 1, t / 0.4), MathUtils.lerp(0.83, 0.97, t / 0.4), 1]
    : [1, MathUtils.lerp(0.97, 0.77, (t - 0.4) / 0.6), MathUtils.lerp(1, 0.55, (t - 0.4) / 0.6)];
  return { brightness, size, colour };
}
export function skyExposure(occupancy) {
  return 1 - 0.78 * MathUtils.smoothstep(occupancy, 0.015, 0.32);
}
