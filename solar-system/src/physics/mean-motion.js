import { AstroTime } from 'astronomy-engine';
import { meanElements, AU_KM } from './definitions.js';
import { bodyOrientation } from './orientation.js';
import { orbitalBasis } from './reference-planes.js';

export { meanElements } from './definitions.js';
const bases = new Map();
export function meanOrbitBasis(id) {
  if (!bases.has(id)) {
    const orbit = meanElements.bodies[id];
    // A fixed reference equator at the element epoch, independent of the
    // parent's later spin and of the satellite's own attitude.
    const epochDays = orbit.epochTdbJd-2451545;
    const parentPole = orbit.referencePlane === 'equatorial'
      ? bodyOrientation(orbit.parent,{tdbSeconds:epochDays*86400,
          astronomy:AstroTime.FromTerrestrialTime(epochDays)}).north : undefined;
    bases.set(id,orbitalBasis(orbit,parentPole));
  }
  const {p,q,north} = bases.get(id);
  return {p:p.clone(),q:q.clone(),north:north.clone()};
}

export function meanMotion(id,time) {
  const orbit = meanElements.bodies[id];
  if (!orbit || !Number.isFinite(time.tdbDays)) throw new RangeError('Unsupported mean orbit or epoch');
  const {p,q} = meanOrbitBasis(id), e = orbit.e;
  const a = orbit.a.value*(orbit.a.unit === 'au' ? AU_KM : 1);
  const n = 2*Math.PI/(orbit.periodDays*86400);
  const days = time.tdbDays-(orbit.epochTdbJd-2451545);
  // Inclination > 90 degrees already specifies retrograde angular momentum.
  // Do not reverse anomaly a second time, or copy that sign into the spin.
  const M = (orbit.meanAnomalyDegrees*Math.PI/180+days/orbit.periodDays*2*Math.PI)%(2*Math.PI);
  let E = M;
  for (let iteration=0;iteration<24;iteration++) {
    const correction = (E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
    E -= correction;
    if (Math.abs(correction)<1e-13) break;
  }
  const beta = Math.sqrt(1-e*e), rate = n/(1-e*Math.cos(E));
  const relativeKm = p.clone().multiplyScalar(a*(Math.cos(E)-e)).addScaledVector(q,a*beta*Math.sin(E));
  const relativeVelocityKmS = p.clone().multiplyScalar(-a*Math.sin(E)*rate).addScaledVector(q,a*beta*Math.cos(E)*rate);
  return {relativeKm,relativeVelocityKmS,orientation:bodyOrientation(id,time),
    orbitGuide:{aKm:a,e,p:p.toArray(),q:q.toArray()},
    model:`有来源的平均椭圆近似；${orbit.validity}${orbit.timeApproximation || ''}`,
    orbitFrame:orbit.center,approximate:true};
}
