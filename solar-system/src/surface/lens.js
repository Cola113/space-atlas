export const SURFACE_FOV_DEGREES = 62;
export const TELESCOPE_MAGNIFICATIONS = Object.freeze([1,2,4,8]);
export function telescopeFieldOfView(magnification) {
  if(!TELESCOPE_MAGNIFICATIONS.includes(magnification))throw new RangeError('Unsupported telescope magnification');
  return 2*Math.atan(Math.tan(SURFACE_FOV_DEGREES*Math.PI/360)/magnification)*180/Math.PI;
}
