import { Vector3, Matrix3, Matrix4, Quaternion, Euler } from 'three';
import { RotationAxis, Rotation_EQD_EQJ, SiderealTime } from 'astronomy-engine';
import data from './iau-coefficients.json';
import { physicalTime } from './time.js';
import { physicalDefinitions, sourceFor } from './definitions.js';
import { orbitalBasis, poleVector } from './reference-planes.js';

const radians = degrees => (degrees % 360) * Math.PI / 180;
const polynomial = (terms, time) => terms.reduceRight((value, coefficient) => value * time + coefficient, 0);
function basis(ra, dec, primeMeridian) {
  const a = radians(ra), d = radians(dec), w = radians(primeMeridian);
  const north = new Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
  const node = new Vector3(-Math.sin(a), Math.cos(a), 0);
  const across = north.clone().cross(node);
  const prime = node.multiplyScalar(Math.cos(w)).addScaledVector(across, Math.sin(w));
  const east = north.clone().cross(prime).normalize();
  return { prime, east, north, ra, dec, primeMeridian,
    // Body surface coordinates: X zero longitude, Y east, Z north.
    quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(prime, east, north)) };
}

export function iauOrientation(id, tdbSeconds) {
  const body = data.bodies[id];
  if (!body || !Number.isFinite(tdbSeconds)) throw new RangeError('Unsupported IAU body or epoch');
  const days = tdbSeconds / 86400, centuries = days / 36525;
  const angles = body.angles.map(terms => radians(polynomial(terms, centuries)));
  const periodic = (terms, fn) => terms.reduce((sum, coefficient, i) => sum + coefficient * fn(angles[i]), 0);
  const ra = polynomial(body.POLE_RA, centuries) + periodic(body.NUT_PREC_RA, Math.sin);
  const dec = polynomial(body.POLE_DEC, centuries) + periodic(body.NUT_PREC_DEC, Math.cos);
  const w = polynomial(body.PM, days) + periodic(body.NUT_PREC_PM, Math.sin);
  return { ...basis(ra, dec, w), source: data.source, model: 'IAU PCK00011',
    limitations: 'IAU 多项式及所列周期项；未额外建模非刚体物理天平动。' };
}

export function bodyOrientation(id, dateOrTime) {
  const time = dateOrTime instanceof Date ? physicalTime(dateOrTime) : dateOrTime;
  if (data.bodies[id]) return iauOrientation(id, time.tdbSeconds);
  const definition = physicalDefinitions.bodies[id]?.rotation;
  if (definition?.provider === 'mean-spin' || definition?.provider === 'illustrative-tumbling') {
    return meanOrientation(id,time);
  }
  if(id==='earth') {
    // EarthRotationAxis.spin uses an ERA-like origin, while its reported pole
    // includes precession/nutation. It is not W measured from that pole's IAU
    // node. Instead rotate Greenwich by GAST in equator-of-date, then to EQJ.
    const rotation=new Matrix3().fromArray(Rotation_EQD_EQJ(time.astronomy).rot.flat());
    const gast=SiderealTime(time.astronomy)*15,w=radians(gast);
    const prime=new Vector3(Math.cos(w),Math.sin(w),0).applyMatrix3(rotation);
    const north=new Vector3(0,0,1).applyMatrix3(rotation),east=north.clone().cross(prime);
    return {prime,east,north,primeMeridian:gast,
      quaternion:new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(prime,east,north)),
      source:'Astronomy Engine 2.1.19 SiderealTime / Rotation_EQD_EQJ',model:'地球 GAST、岁差与章动',
      limitations:'UT1 以 UTC 近似，未加极移；不适用于精密地球定向预报。'};
  }
  const names = { sun:'Sun', mercury:'Mercury', venus:'Venus', earth:'Earth', moon:'Moon', mars:'Mars', jupiter:'Jupiter', saturn:'Saturn', uranus:'Uranus', neptune:'Neptune', pluto:'Pluto' };
  if (!names[id]) throw new RangeError(`No physical orientation for ${id}`);
  const axis = RotationAxis(names[id], time.astronomy);
  return { ...basis(axis.ra * 15, axis.dec, axis.spin), source: 'Astronomy Engine 2.1.19 RotationAxis',
    model: id === 'moon' ? 'IAU 月球姿态及周期项' : 'Astronomy Engine 旋转轴',
    limitations: 'Astronomy Engine 使用 TT，与 TDB 的毫秒级周期差属于本模型时标近似；未添加额外物理天平动。' };
}

function fixedPole(id) {
  const pole = physicalDefinitions.bodies[id].rotation.pole;
  if (pole.referenceBody) return fixedPole(pole.referenceBody);
  if (pole.orbitNormalOf) return orbitalBasis(physicalDefinitions.bodies[pole.orbitNormalOf].orbit).north;
  return poleVector(pole);
}

function meanOrientation(id, time) {
  const rotation = physicalDefinitions.bodies[id].rotation;
  const pole = fixedPole(id);
  const ra = Math.atan2(pole.y,pole.x)*180/Math.PI;
  const dec = Math.asin(pole.z)*180/Math.PI;
  const days = time.tdbDays-(rotation.epochTdbJd-2451545);
  const spin = days/rotation.periodDays*2*Math.PI;
  let attitude = basis(ra,dec,rotation.primeMeridianDegrees+spin*180/Math.PI);
  if (rotation.provider === 'illustrative-tumbling') {
    // This explicitly labelled display attitude is never used for a landing.
    const turn = new Quaternion().setFromEuler(new Euler(
      .9*Math.sin(spin*.371)+.35*Math.sin(spin*.113),
      .7*Math.sin(spin*.613),spin+.7*Math.sin(spin*.173)));
    const quaternion = basis(ra,dec,rotation.primeMeridianDegrees).quaternion.multiply(turn);
    attitude = {quaternion,prime:new Vector3(1,0,0).applyQuaternion(quaternion),
      east:new Vector3(0,1,0).applyQuaternion(quaternion),north:new Vector3(0,0,1).applyQuaternion(quaternion)};
  }
  return {...attitude,source:sourceFor(rotation.source).url,
    model:rotation.provider==='illustrative-tumbling'?'混沌姿态示意':'独立平均自转',
    limitations:rotation.validity+(rotation.pole.note || '')};
}
