import { Vector3 } from 'three';

// Elliptic two-body propagation in inertial J2000 coordinates. The osculating
// orbit is anchored to a JPL position/velocity, never to a rotation meridian.
// Perturbations and secular precession are deliberately not extrapolated.
export function orbitalElements(positionKm, velocityKmS, gmKm3S2, epochTdbSeconds) {
  const r = new Vector3().fromArray(positionKm), v = new Vector3().fromArray(velocityKmS);
  const h = r.clone().cross(v), normal = h.clone().normalize();
  const eccentricity = v.clone().cross(h).divideScalar(gmKm3S2).sub(r.clone().normalize());
  const e = eccentricity.length(), a = 1 / (2 / r.length() - v.lengthSq() / gmKm3S2);
  if (!(a > 0 && e < 1)) throw new RangeError('Expected an elliptic JPL anchor');
  const p = e > 1e-10 ? eccentricity.divideScalar(e) : r.clone().normalize();
  const q = normal.clone().cross(p);
  const E = Math.atan2(r.dot(q) / (a * Math.sqrt(1 - e * e)), r.dot(p) / a + e);
  return { aKm: a, e, p: p.toArray(), q: q.toArray(), meanAnomaly: E - e * Math.sin(E),
    meanMotion: Math.sqrt(gmKm3S2 / a ** 3), epochTdbSeconds, gmKm3S2 };
}

export function keplerPosition(elements, tdbSeconds) {
  const { aKm:a, e, p, q, meanAnomaly, meanMotion, epochTdbSeconds } = elements;
  const M = (meanAnomaly + meanMotion * (tdbSeconds - epochTdbSeconds)) % (2 * Math.PI);
  let E = M;
  for (let i = 0; i < 20; i++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return new Vector3().fromArray(p).multiplyScalar(a * (Math.cos(E) - e))
    .addScaledVector(new Vector3().fromArray(q), a * Math.sqrt(1 - e * e) * Math.sin(E));
}
