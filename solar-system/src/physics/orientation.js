import { Vector3, Matrix4, Quaternion } from 'three';
import { RotationAxis } from 'astronomy-engine';
import data from './iau-coefficients.json';
import { physicalTime } from './time.js';

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
  const names = { sun:'Sun', mercury:'Mercury', venus:'Venus', earth:'Earth', moon:'Moon', mars:'Mars', jupiter:'Jupiter', saturn:'Saturn', uranus:'Uranus', neptune:'Neptune', pluto:'Pluto' };
  if (!names[id]) throw new RangeError(`No physical orientation for ${id}`);
  const axis = RotationAxis(names[id], time.astronomy);
  return { ...basis(axis.ra * 15, axis.dec, axis.spin), source: 'Astronomy Engine 2.1.19 RotationAxis',
    model: id === 'moon' ? 'IAU 月球姿态及周期项' : 'Astronomy Engine 旋转轴',
    limitations: 'Astronomy Engine 使用 TT，与 TDB 的毫秒级周期差属于本模型时标近似；未添加额外物理天平动。' };
}
