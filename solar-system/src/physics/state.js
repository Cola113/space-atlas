import { Vector3 } from 'three';
import { HelioState, GeoMoonState, JupiterMoons } from 'astronomy-engine';
import { meanMotion,meanElements } from './mean-motion.js';
import { physicalData } from '../physical-scale.js';
import { physicalTime } from './time.js';
import { bodyOrientation } from './orientation.js';
import { EphemerisStore, EPHEMERIS_SYSTEMS, inEphemerisRange, evaluateEphemeris } from './ephemeris.js';
import { keplerPosition } from './kepler.js';
import anchors from './kepler-anchors.json';
import { AU_KM } from './definitions.js';

export { AU_KM } from './definitions.js';
export const physicalNames = Object.freeze({ sun:'Sun', mercury:'Mercury', venus:'Venus', earth:'Earth',
  moon:'Moon', mars:'Mars', jupiter:'Jupiter', io:'Io', europa:'Europa', ganymede:'Ganymede', callisto:'Callisto',
  saturn:'Saturn', enceladus:'Enceladus', titan:'Titan', uranus:'Uranus', miranda:'Miranda',
  neptune:'Neptune', pluto:'Pluto', charon:'Charon' });
const vectorKm = value => new Vector3(value.x,value.y,value.z).multiplyScalar(AU_KM);
const velocityKmS = value => new Vector3(value.vx,value.vy,value.vz).multiplyScalar(AU_KM/86400);
export const systemsForBodies = ids => [...new Set(ids.map(id => EPHEMERIS_SYSTEMS[id] || EPHEMERIS_SYSTEMS[meanElements.bodies[id]?.parent]).filter(Boolean))];
// Bodies whose dated state comes from a published year bundle. The overview must
// prefetch all of them, not just one representative: Ceres looks permanently
// unavailable until its own bundle is resident, and listing a body here is exactly
// what makes that visible instead of silent.
export const ephemerisBodyIds = Object.freeze(Object.keys(EPHEMERIS_SYSTEMS));

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
    const time = physicalTime(date), states = new Map(), missing = new Map(), barycenters = new Map(), barycenterVelocities = new Map();
    const add = (id,positionKm,parent,relativeKm,model,motion={}) => {
      const orientation = motion.orientation || bodyOrientation(id,time);
      states.set(id,{ id, name:physicalNames[id] || id, positionKm, parent, relativeKm,
        orientation, radiusKm:physicalData[id].radiusKm, model,
        approximate:!inEphemerisRange(date),
        velocityKmS:new Vector3(),relativeVelocityKmS:new Vector3(),...motion,
        accuracy:`${model}；姿态：${orientation.model}。几何位置，未加光行时、像差或折射。${orientation.limitations}` });
    };
    add('sun',new Vector3(),null,new Vector3(),'日心原点');
    for (const id of ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune']) {
      const state = HelioState(physicalNames[id],time.astronomy),position=vectorKm(state),velocity=velocityKmS(state);
      add(id,position,'sun',position.clone(),'Astronomy Engine 2.1.19',{velocityKmS:velocity,relativeVelocityKmS:velocity.clone()});
    }
    const moonState=GeoMoonState(time.astronomy),moon=vectorKm(moonState),moonVelocity=velocityKmS(moonState);
    add('moon',states.get('earth').positionKm.clone().add(moon),'earth',moon,'Astronomy Engine 月球位置',
      {relativeVelocityKmS:moonVelocity,velocityKmS:states.get('earth').velocityKmS.clone().add(moonVelocity)});
    const jovian = JupiterMoons(time.astronomy);
    for (const id of ['io','europa','ganymede','callisto']) {
      const relative = vectorKm(jovian[id]);
      const velocity=velocityKmS(jovian[id]);
      add(id,states.get('jupiter').positionKm.clone().add(relative),'jupiter',relative,'Astronomy Engine 伽利略卫星位置',
        {relativeVelocityKmS:velocity,velocityKmS:states.get('jupiter').velocityKmS.clone().add(velocity)});
    }
    const inRange = inEphemerisRange(date);
    const extrapolation = inRange ? null : anchors.anchors[date.getUTCFullYear()<1900?'first':'last'].elements;
    for (const [system,ids] of [['saturn',['enceladus','titan']],['uranus',['miranda']],['pluto',['pluto','charon']],['ceres',['ceres']]]) {
      let bundle;
      try { bundle = this.ephemeris.require(system,date); }
      catch (error) { for (const id of ids) missing.set(id,error); continue; }
      const at = (target,center,t=time.tdbSeconds) => new Vector3().fromArray(evaluateEphemeris(bundle,target,center,t));
      const derivative = fn => fn(time.tdbSeconds+1).sub(fn(time.tdbSeconds-1)).multiplyScalar(.5);
      const relativeAt = (target,parent,center,t) => at(target,center,t).sub(at(parent,center,t));
      const model = inRange ? `JPL ${ {saturn:'SAT441',uranus:'URA184',pluto:'PLU060',ceres:'Horizons 小行星星历'}[system]} 原始多项式`
        : '范围外近似：最近边界 JPL 状态的二体轨道外推，无摄动及精度保证';
      if (system === 'pluto') {
        const barycenter = inRange ? at(9,0).sub(at(10,0)) : keplerPosition(extrapolation.plutoBarycenter,time.tdbSeconds);
        const relative = inRange ? at(901,9).sub(at(999,9)) : keplerPosition(extrapolation.charon,time.tdbSeconds);
        const offset = inRange ? at(999,9) : relative.clone().multiplyScalar(-anchors.binaryPlutoFraction)
          .add(new Vector3().fromArray(extrapolation.plutoResidualKm));
        const pluto = barycenter.clone().add(offset);
        const vBary=derivative(t=>inRange?relativeAt(9,10,0,t):keplerPosition(extrapolation.plutoBarycenter,t));
        const vRelative=derivative(t=>inRange?relativeAt(901,999,9,t):keplerPosition(extrapolation.charon,t));
        const vOffset=inRange?derivative(t=>at(999,9,t)):vRelative.clone().multiplyScalar(-anchors.binaryPlutoFraction);
        const vPluto=vBary.clone().add(vOffset);
        add('pluto',pluto,'sun',pluto.clone(),model,{velocityKmS:vPluto,relativeVelocityKmS:vPluto.clone()});
        add('charon',pluto.clone().add(relative),'pluto',relative,model,{relativeVelocityKmS:vRelative,velocityKmS:vPluto.clone().add(vRelative)});
        barycenters.set('pluto',barycenter);
        barycenterVelocities.set('pluto',vBary);
      } else if (system === 'ceres') {
        // Heliocentric small body: the published track is already the Sun-relative
        // position (target 20000001 about center 10), so there is no parent center to
        // subtract and no moon-relative frame to build. Outside 1900–2100 the fallback
        // stays the sourced mean ellipse, which is what the project used throughout
        // before this kernel existed.
        const heliocentric = inRange ? at(20000001,10) : keplerPosition(extrapolation.ceres,time.tdbSeconds);
        const v = inRange ? derivative(t=>at(20000001,10,t))
          : keplerPosition(extrapolation.ceres,time.tdbSeconds+1)
            .sub(keplerPosition(extrapolation.ceres,time.tdbSeconds-1)).multiplyScalar(.5);
        add('ceres',heliocentric,'sun',heliocentric.clone(),model,{velocityKmS:v,relativeVelocityKmS:v.clone()});
      } else for (const id of ids) {
        const target = {enceladus:602,titan:606,miranda:705}[id], parent = system==='saturn'?699:799, center = system==='saturn'?6:7;
        const relative = inRange ? at(target,center).sub(at(parent,center)) : keplerPosition(extrapolation[id],time.tdbSeconds);
        const v=derivative(t=>inRange?relativeAt(target,parent,center,t):keplerPosition(extrapolation[id],t));
        add(id,states.get(system).positionKm.clone().add(relative),system,relative,model+'；主星日心平移取 Astronomy Engine',
          {relativeVelocityKmS:v,velocityKmS:states.get(system).velocityKmS.clone().add(v)});
      }
    }
    for(const [id,element] of Object.entries(meanElements.bodies)){
      const parent=states.get(element.parent);
      if(!parent){missing.set(id,missing.get(element.parent));continue;}
      const motion=meanMotion(id,time,parent);
      const center=motion.orbitFrame==='barycenter'?barycenters.get(element.parent):parent.positionKm;
      const centerVelocity=motion.orbitFrame==='barycenter'?barycenterVelocities.get(element.parent):parent.velocityKmS;
      add(id,center.clone().add(motion.relativeKm),element.parent,motion.relativeKm,motion.model,
        {...motion,velocityKmS:centerVelocity.clone().add(motion.relativeVelocityKmS)});
    }
    this.current = {date:time.date,time,bodies:states,missing,barycenters,barycenterVelocities,revision:this.ephemeris.revision,
      frame:'J2000 equatorial', units:'km', geometric:true,
      accuracy:inRange ? '1900—2100 为核心星历校准范围；其它小天体为有来源的固定平均椭圆，不能预测真实交会或掩食。星历编码误差小于1 km不代表轨道解、姿态或落点的总误差。'
        : '范围外近似推算：卫星采用边界二体外推，行星沿用 Astronomy Engine；误差随外推时间增大。' };
    return this.current;
  }
  dispose() { this.ephemeris.dispose(); this.current = null; }
}

export const physicalState = new PhysicalState();
