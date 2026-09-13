import { Vector3 } from 'three';
import { HelioVector, GeoMoon, JupiterMoons } from 'astronomy-engine';
import { physicalData } from '../physical-scale.js';
import { physicalTime } from './time.js';
import { bodyOrientation } from './orientation.js';
import { EphemerisStore, EPHEMERIS_SYSTEMS, inEphemerisRange, evaluateEphemeris } from './ephemeris.js';
import { keplerPosition } from './kepler.js';
import anchors from './kepler-anchors.json';

export const AU_KM = 149597870.7;
export const physicalNames = Object.freeze({ sun:'Sun', mercury:'Mercury', venus:'Venus', earth:'Earth',
  moon:'Moon', mars:'Mars', jupiter:'Jupiter', io:'Io', europa:'Europa', ganymede:'Ganymede', callisto:'Callisto',
  saturn:'Saturn', enceladus:'Enceladus', titan:'Titan', uranus:'Uranus', miranda:'Miranda',
  neptune:'Neptune', pluto:'Pluto', charon:'Charon' });
const vectorKm = value => new Vector3(value.x,value.y,value.z).multiplyScalar(AU_KM);
export const systemsForBodies = ids => [...new Set(ids.map(id => EPHEMERIS_SYSTEMS[id]).filter(Boolean))];

/** One geometric physical frame per date/cache revision. All vectors are km in
 * heliocentric J2000 equatorial axes; callers must clone before transforming.
 * No view scales, camera state, current target or texture rotations enter here.
 */
export class PhysicalState {
  constructor({ephemeris = new EphemerisStore()} = {}) { this.ephemeris = ephemeris; this.current = null; }
  ensure(date, ids, options) { return this.ephemeris.ensure(date,systemsForBodies(ids),options); }
  require(date, ids) {
    for (const system of systemsForBodies(ids)) this.ephemeris.require(system,date);
  }
  frame(date, {required = []} = {}) {
    this.require(date,required);
    if (this.current?.date.getTime() === date.getTime() && this.current.revision === this.ephemeris.revision) return this.current;
    const time = physicalTime(date), states = new Map(), missing = new Map(), barycenters = new Map();
    const add = (id,positionKm,parent,relativeKm,model) => {
      const orientation = bodyOrientation(id,time);
      states.set(id,{ id, name:physicalNames[id], positionKm, parent, relativeKm,
        orientation, radiusKm:physicalData[id].radiusKm, model,
        approximate:!inEphemerisRange(date),
        accuracy:`${model}；几何位置，未加光行时、像差或折射。${orientation.limitations}` });
    };
    add('sun',new Vector3(),null,new Vector3(),'日心原点');
    for (const id of ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune']) {
      const position = vectorKm(HelioVector(physicalNames[id],time.astronomy));
      add(id,position,'sun',position.clone(),'Astronomy Engine 2.1.19');
    }
    const moon = vectorKm(GeoMoon(time.astronomy));
    add('moon',states.get('earth').positionKm.clone().add(moon),'earth',moon,'Astronomy Engine 月球位置');
    const jovian = JupiterMoons(time.astronomy);
    for (const id of ['io','europa','ganymede','callisto']) {
      const relative = vectorKm(jovian[id]);
      add(id,states.get('jupiter').positionKm.clone().add(relative),'jupiter',relative,'Astronomy Engine 伽利略卫星位置');
    }
    const inRange = inEphemerisRange(date);
    const extrapolation = inRange ? null : anchors.anchors[date.getUTCFullYear()<1900?'first':'last'].elements;
    for (const [system,ids] of [['saturn',['enceladus','titan']],['uranus',['miranda']],['pluto',['pluto','charon']]]) {
      let bundle;
      try { bundle = this.ephemeris.require(system,date); }
      catch (error) { for (const id of ids) missing.set(id,error); continue; }
      const at = (target,center) => new Vector3().fromArray(evaluateEphemeris(bundle,target,center,time.tdbSeconds));
      const model = inRange ? `JPL ${ {saturn:'SAT441',uranus:'URA184',pluto:'PLU060'}[system]} 原始多项式`
        : '范围外近似：最近边界 JPL 状态的二体轨道外推，无摄动及精度保证';
      if (system === 'pluto') {
        const barycenter = inRange ? at(9,0).sub(at(10,0)) : keplerPosition(extrapolation.plutoBarycenter,time.tdbSeconds);
        const relative = inRange ? at(901,9).sub(at(999,9)) : keplerPosition(extrapolation.charon,time.tdbSeconds);
        const offset = inRange ? at(999,9) : relative.clone().multiplyScalar(-anchors.binaryPlutoFraction)
          .add(new Vector3().fromArray(extrapolation.plutoResidualKm));
        const pluto = barycenter.clone().add(offset);
        add('pluto',pluto,'sun',pluto.clone(),model);
        add('charon',pluto.clone().add(relative),'pluto',relative,model);
        barycenters.set('pluto',barycenter);
      } else for (const id of ids) {
        const target = {enceladus:602,titan:606,miranda:705}[id], parent = system==='saturn'?699:799, center = system==='saturn'?6:7;
        const relative = inRange ? at(target,center).sub(at(parent,center)) : keplerPosition(extrapolation[id],time.tdbSeconds);
        add(id,states.get(system).positionKm.clone().add(relative),system,relative,model+'；主星日心平移取 Astronomy Engine');
      }
    }
    this.current = {date:time.date,time,bodies:states,missing,barycenters,revision:this.ephemeris.revision,
      frame:'J2000 equatorial', units:'km', geometric:true,
      accuracy:inRange ? '1900—2100 校准范围；星历编码误差小于1 km不代表轨道解、姿态或落点的总误差。'
        : '范围外近似推算：卫星采用边界二体外推，行星沿用 Astronomy Engine；误差随外推时间增大。' };
    return this.current;
  }
  dispose() { this.ephemeris.dispose(); this.current = null; }
}

export const physicalState = new PhysicalState();
