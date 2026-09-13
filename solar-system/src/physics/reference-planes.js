import { Vector3 } from 'three';
import { physicalDefinitions } from './definitions.js';

const radians = degrees => degrees * Math.PI / 180;
// JPL's ECLIPJ2000 is the NAIF inertial plane (IAU 1976 obliquity), which
// differs by 0.042 arcsec from Astronomy Engine's IAU 2006 ecliptic helper.
const obliquity = radians(physicalDefinitions.constants.j2000EclipticObliquityArcsec/3600);
export function poleVector({raDegrees, decDegrees}) {
  const ra = radians(raDegrees), dec = radians(decDegrees);
  return new Vector3(Math.cos(ra)*Math.cos(dec), Math.sin(ra)*Math.cos(dec), Math.sin(dec));
}

// All output vectors are in fixed J2000 equatorial axes. JPL defines node from
// the reference plane's ascending node on the ICRF equator, not a body meridian.
export function orbitalBasis(orbit, equatorialPole) {
  let north, origin;
  if (orbit.referencePlane === 'ecliptic') {
    north = new Vector3(0,-Math.sin(obliquity),Math.cos(obliquity));
    origin = new Vector3(1,0,0);
  } else if (orbit.referencePlane === 'J2000-equatorial') {
    north = new Vector3(0,0,1); origin = new Vector3(1,0,0);
  } else {
    north = orbit.referencePlane === 'Laplace' ? poleVector(orbit.referencePole) : equatorialPole?.clone();
    if (!north) throw new RangeError(`Unsupported reference plane: ${orbit.referencePlane}`);
    origin = new Vector3(0,0,1).cross(north).normalize();
    if (origin.lengthSq()<.5) origin.set(1,0,0);
  }
  const node = origin.applyAxisAngle(north,radians(orbit.ascendingNodeDegrees));
  north.applyAxisAngle(node,radians(orbit.inclinationDegrees));
  const p = node.applyAxisAngle(north,radians(orbit.argumentPeriapsisDegrees));
  return {p, q:north.clone().cross(p), north};
}
