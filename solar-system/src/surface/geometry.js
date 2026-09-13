import { Vector3, Matrix3, MathUtils } from 'three';
import { physicalData } from '../physical-scale.js';
import { bodyOrientation } from '../physics/orientation.js';
import { physicalState, AU_KM } from '../physics/state.js';
export { AU_KM } from '../physics/state.js';
import { additionalLandingSites } from './sites.js';

const rad = MathUtils.degToRad;

export const landingSites = Object.freeze({
  ...additionalLandingSites,
  moon: { id: 'moon', name: '月球', title: '哈德利 · 亚平宁', english: 'HADLEY–APENNINE',
    latitude: 26.1322, longitude: 3.6339, radiusKm: physicalData.moon.radiusKm,
    date: '1971-08-01T17:00:00Z', parent: 'Earth', parentName: '地球', parentRadiusKm: physicalData.earth.radiusKm,
    texture: '/surface/moon.webp', parentTexture: '/solar-system/textures/2k_earth_daymap.jpg',
    provenance: '阿波罗 15 号 · 实拍全景', source: 'https://www.lpi.usra.edu/resources/apollopanoramas/pans/?pan=JSC2007e045379&zoom=True',
    credit: 'NASA / James Irwin · 全景拼接 Warren Harold, NASA Johnson / LPI',
    description: '脚下是阿波罗 15 号留下的视野。环顾哈德利山与登月舱，抬头寻找地球。',
    notes: '地表来自 1971 年阿波罗实拍拼接。原图未覆盖脚下，低头区域按同图月壤的色调与颗粒感程序补绘；水平接缝经过融合。全景投影和朝向为近似校准。天空从选定历史时刻起随模拟时间推进，地球云层使用展示纹理，非当时的天气影像。',
    panoramaCenter: 105, initialHeading: 215, initialPitch: 3, solarDay:29.53,
  },
  europa: { id: 'europa', name: '木卫二', title: '朝木星侧 · 冰原', english: 'SUB-JOVIAN ICEFIELD',
    latitude: 0, longitude: 62, radiusKm: physicalData.europa.radiusKm,
    date: '2026-09-14T09:18:00Z', parent: 'Jupiter', parentName: '木星', parentRadiusKm: physicalData.jupiter.radiusKm,
    texture: '/surface/europa.webp', parentTexture: '/solar-system/textures/2k_jupiter.jpg',
    provenance: '冰原地貌 · AI 艺术重建', source: 'https://www.jpl.nasa.gov/missions/europa-lander/',
    credit: '地表艺术重建 · gpt-image-2.5-sunburst · 天体纹理 Solar System Scope / NASA',
    description: '站在冰壳的裂隙之间，仰望木星。固定的观景点，属于尚未抵达的世界。',
    notes: '木卫二没有真实着陆全景。冰原由 AI 生成，不能作为实测地形；拟定落点使用 IAU 东经坐标；轨道与自转独立计算，未额外建模非刚体物理天平动。天空按表面模拟时间的星历与真实半径更新，木星云带使用展示纹理。地表整体亮度随日照变化，贴图内的局部阴影保持原样。',
    panoramaCenter: 20, initialHeading: 270, initialPitch: 10, solarDay:3.55,
  },
});

export function angularDiameter(radiusKm, distanceKm) {
  if (!(radiusKm > 0 && distanceKm > radiusKm)) throw new RangeError('Observer must be outside the body');
  return 2 * Math.asin(radiusKm / distanceKm);
}

// Direction of the incident light at the target, expressed in the observer's
// local axes. Its observer direction and its illumination are separate vectors.
export function surfaceSunDirection(frame, target) {
  return frame.local(target.positionKm.clone().negate().normalize());
}

// Shared, independently evaluated IAU attitude in J2000 equatorial axes.
export function bodyBasis(body, date) { return bodyOrientation(body.toLowerCase(), date); }
export const satelliteBasis = bodyBasis;

export function surfaceFrame(site, date = new Date(site.date), provider = physicalState) {
  const physical = provider.frame(date, {required:[site.id,site.parent.toLowerCase()]});
  const body = physical.bodies.get(site.id), basis = body.orientation;
  const lat = rad(site.latitude), lon = rad(site.longitude);
  const equator = basis.prime.clone().multiplyScalar(Math.cos(lon)).addScaledVector(basis.east, Math.sin(lon));
  const up = equator.clone().multiplyScalar(Math.cos(lat)).addScaledVector(basis.north, Math.sin(lat)).normalize();
  const east = basis.prime.clone().multiplyScalar(-Math.sin(lon)).addScaledVector(basis.east, Math.cos(lon)).normalize();
  const north = up.clone().cross(east).normalize();
  // Local world: +X east, +Y zenith, -Z north. Planetocentric latitude,
  // east-positive longitude on the common mean-radius sphere; eye height 1.65 m.
  const rotation = new Matrix3().set(east.x,east.y,east.z, up.x,up.y,up.z, -north.x,-north.y,-north.z);
  const centerKm = body.positionKm.clone();
  const observerKm = centerKm.clone().addScaledVector(up,body.radiusKm + .00165);
  const local = v => v.clone().applyMatrix3(rotation);
  const targets = {};
  for (const [id,target] of physical.bodies) {
    if (id === site.id) continue;
    const relative = target.positionKm.clone().sub(observerKm), distanceKm = relative.length();
    targets[target.name] = {id, direction:local(relative).normalize(), distanceKm,
      radiusKm:target.radiusKm, angularDiameter:angularDiameter(target.radiusKm,distanceKm),
      position:target.positionKm.clone().divideScalar(AU_KM), positionKm:target.positionKm.clone(),
      orientation:target.orientation, accuracy:target.accuracy};
  }
  return {date,physical,centerKm,observerKm,center:centerKm.clone().divideScalar(AU_KM),
    observer:observerKm.clone().divideScalar(AU_KM),rotation,local,targets,basis,
    accuracy:body.accuracy+' '+physical.accuracy+' '+physical.time.timescaleNote};
}

export function nextDaylight(site,time,provider = physicalState) {
  const cycle=(site.solarDay||29.53)*86400000;
  // Also cover polar night; samples are at most a quarter local solar hour.
  const step=cycle/96;
  for(let n=1;n<=192;n++) {
    const candidate=time+n*step;
    if(horizonAngles(surfaceFrame(site,new Date(candidate),provider).targets.Sun.direction).altitude>8) return candidate;
  }
  return null;
}

export function horizonAngles(direction) {
  return { altitude: MathUtils.radToDeg(Math.asin(MathUtils.clamp(direction.y,-1,1))),
    azimuth: MathUtils.euclideanModulo(MathUtils.radToDeg(Math.atan2(direction.x,-direction.z)),360) };
}

export function lookDirection(heading, pitch) {
  return new Vector3(Math.sin(rad(heading))*Math.cos(rad(pitch)), Math.sin(rad(pitch)), -Math.cos(rad(heading))*Math.cos(rad(pitch)));
}

// The search can cross a year boundary or the JPL coverage boundary.
export async function nextDaylightAsync(site,time,provider = physicalState,{signal} = {}) {
  const step=(site.solarDay||29.53)*86400000/96;
  for(let n=1;n<=192;n++) {
    if(signal?.aborted)throw signal.reason;
    const candidate=time+n*step, date=new Date(candidate);
    await provider.ensure(date,[site.id,site.parent.toLowerCase()]);
    if(horizonAngles(surfaceFrame(site,date,provider).targets.Sun.direction).altitude>8)return candidate;
  }
  return null;
}
