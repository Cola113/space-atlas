import { Vector3, Matrix3, MathUtils } from 'three';
import { HelioVector, GeoMoon, JupiterMoons, RotationAxis } from 'astronomy-engine';
import { additionalLandingSites } from './sites.js';

export const AU_KM = 149597870.7;
const rad = MathUtils.degToRad;
const vector = value => new Vector3(value.x, value.y, value.z);

export const landingSites = Object.freeze({
  ...additionalLandingSites,
  moon: { id: 'moon', name: '月球', title: '哈德利 · 亚平宁', english: 'HADLEY–APENNINE',
    latitude: 26.1322, longitude: 3.6339, radiusKm: 1737.4,
    date: '1971-08-01T17:00:00Z', parent: 'Earth', parentName: '地球', parentRadiusKm: 6371.0084,
    texture: '/surface/moon.webp', parentTexture: '/solar-system/textures/2k_earth_daymap.jpg',
    provenance: '阿波罗 15 号 · 实拍全景', source: 'https://www.lpi.usra.edu/resources/apollopanoramas/pans/?pan=JSC2007e045379&zoom=True',
    credit: 'NASA / James Irwin · 全景拼接 Warren Harold, NASA Johnson / LPI',
    description: '脚下是阿波罗 15 号留下的视野。环顾哈德利山与登月舱，抬头寻找地球。',
    notes: '地表来自 1971 年阿波罗实拍拼接。原图未覆盖脚下，低头区域按同图月壤的色调与颗粒感程序补绘；水平接缝经过融合。全景投影和朝向为近似校准。天空从选定历史时刻起随模拟时间推进，地球云层使用展示纹理，非当时的天气影像。',
    panoramaCenter: 105, initialHeading: 215, initialPitch: 3, solarDay:29.53,
  },
  europa: { id: 'europa', name: '木卫二', title: '朝木星侧 · 冰原', english: 'SUB-JOVIAN ICEFIELD',
    latitude: 0, longitude: 62, radiusKm: 1560.8,
    date: '2026-09-14T09:18:00Z', parent: 'Jupiter', parentName: '木星', parentRadiusKm: 69911,
    texture: '/surface/europa.webp', parentTexture: '/solar-system/textures/2k_jupiter.jpg',
    provenance: '冰原地貌 · AI 艺术重建', source: 'https://www.jpl.nasa.gov/missions/europa-lander/',
    credit: '地表艺术重建 · gpt-image-2.5-sunburst · 天体纹理 Solar System Scope / NASA',
    description: '站在冰壳的裂隙之间，仰望木星。固定的观景点，属于尚未抵达的世界。',
    notes: '木卫二没有真实着陆全景。冰原由 AI 生成，不能作为实测地形；拟定落点使用理想潮汐锁定坐标，忽略物理天平动。天空按表面模拟时间的星历与真实半径更新，木星云带使用展示纹理。地表整体亮度随日照变化，贴图内的局部阴影保持原样。',
    panoramaCenter: 20, initialHeading: 270, initialPitch: 10, solarDay:3.55,
  },
});

export function angularDiameter(radiusKm, distanceKm) {
  if (!(radiusKm > 0 && distanceKm > radiusKm)) throw new RangeError('Observer must be outside the body');
  return 2 * Math.asin(radiusKm / distanceKm);
}

// Body-fixed basis expressed in J2000 equatorial coordinates.
export function bodyBasis(body, date) {
  if (['Enceladus','Titan','Miranda','Charon'].includes(body)) return satelliteBasis(body,date);
  const axis = RotationAxis(body, date);
  const a = rad(axis.ra * 15), w = rad(axis.spin % 360);
  const north = vector(axis.north).normalize();
  const node = new Vector3(-Math.sin(a), Math.cos(a), 0);
  const across = north.clone().cross(node).normalize();
  const prime = node.clone().multiplyScalar(Math.cos(w)).addScaledVector(across, Math.sin(w));
  return { prime, east: north.clone().cross(prime).normalize(), north };
}

// IAU orientation coefficients from NAIF pck00011.tpc. These orient the local
// surface; placing a moon opposite its prime axis is a mean synchronous-orbit
// approximation, not a replacement for the full JPL satellite ephemerides.
export function satelliteBasis(body,date) {
  const days=(date.getTime()-Date.UTC(2000,0,1,12))/86400000, centuries=days/36525;
  let ra,dec,w;
  if(body==='Enceladus') {ra=40.66-.036*centuries;dec=83.52-.004*centuries;w=6.32+262.7318996*days;}
  else if(body==='Titan') {ra=39.4827;dec=83.4279;w=186.5855+22.5769768*days;}
  else if(body==='Charon') {ra=132.993;dec=-6.163;w=122.695+56.3625225*days;}
  else if(body==='Miranda') {
    const u11=rad(102.23-2024.22*centuries),u12=rad(316.41+2863.96*centuries);
    ra=257.43+4.41*Math.sin(u11)-.04*Math.sin(2*u11);
    dec=-15.08+4.25*Math.cos(u11)-.02*Math.cos(2*u11);
    w=30.70-254.6906892*days+1.15*Math.sin(u11)-1.27*Math.sin(u12)-.09*Math.sin(2*u11)+.15*Math.sin(2*u12);
  } else throw new RangeError('Unsupported satellite orientation');
  const a=rad(ra),d=rad(dec);
  const north=new Vector3(Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d));
  const node=new Vector3(-Math.sin(a),Math.cos(a),0),across=north.clone().cross(node);
  const prime=node.multiplyScalar(Math.cos(rad(w%360))).addScaledVector(across,Math.sin(rad(w%360)));
  return {prime,north,east:north.clone().cross(prime).normalize()};
}

export function surfaceFrame(site, date = new Date(site.date)) {
  const earth = vector(HelioVector('Earth', date));
  const jupiter = vector(HelioVector('Jupiter', date));
  const satellites = JupiterMoons(date);
  let center, basis;
  if (site.id === 'moon') {
    center = earth.clone().add(vector(GeoMoon(date)));
    basis = bodyBasis('Moon', date);
  } else if (site.id==='europa'||site.id==='io') {
    const relative = vector(satellites[site.id]);
    center = jupiter.clone().add(relative);
    const prime = relative.clone().negate().normalize();
    const north = vector(RotationAxis('Jupiter', date).north).normalize();
    const east = north.clone().cross(prime).normalize();
    basis = { prime, east, north: prime.clone().cross(east).normalize() };
  } else if (['titan','enceladus','miranda'].includes(site.id)) {
    basis=bodyBasis(site.body,date);
    const orbitKm={titan:1221900,enceladus:238400,miranda:129846}[site.id];
    center=vector(HelioVector(site.parent,date)).addScaledVector(basis.prime,-orbitKm/AU_KM);
  } else if (site.body) {
    center=vector(HelioVector(site.body,date));
    basis=bodyBasis(site.body,date);
  } else throw new RangeError('Unsupported landing site');
  const lat = rad(site.latitude), lon = rad(site.longitude);
  const equator = basis.prime.clone().multiplyScalar(Math.cos(lon)).addScaledVector(basis.east, Math.sin(lon));
  const up = equator.clone().multiplyScalar(Math.cos(lat)).addScaledVector(basis.north, Math.sin(lat)).normalize();
  const east = basis.prime.clone().multiplyScalar(-Math.sin(lon)).addScaledVector(basis.east, Math.cos(lon)).normalize();
  const north = up.clone().cross(east).normalize();
  // Local world: +X east, +Y zenith, -Z north. A right-handed frame.
  const rotation = new Matrix3().set(east.x,east.y,east.z, up.x,up.y,up.z, -north.x,-north.y,-north.z);
  const observer = center.clone().addScaledVector(up, (site.radiusKm + .00165) / AU_KM);
  const local = v => v.clone().applyMatrix3(rotation);
  const positions = { Sun: new Vector3(), Earth: earth, Jupiter: jupiter };
  for (const name of ['Mercury','Venus','Mars','Saturn','Uranus','Neptune','Pluto']) positions[name] = vector(HelioVector(name,date));
  positions.Moon=earth.clone().add(vector(GeoMoon(date)));
  for (const [name,key] of [['Io','io'],['Europa','europa'],['Ganymede','ganymede'],['Callisto','callisto']]) positions[name] = jupiter.clone().add(vector(satellites[key]));
  if(site.id==='pluto') positions.Charon=center.clone().addScaledVector(basis.prime,19600/AU_KM);
  delete positions[site.body || (site.id==='moon'?'Moon':'Europa')];
  const targets = {};
  for (const [name,position] of Object.entries(positions)) {
    const relative = position.clone().sub(observer);
    targets[name] = { direction: local(relative).normalize(), distanceKm: relative.length() * AU_KM, position };
  }
  return { date, center, observer, rotation, local, targets, basis };
}

export function nextDaylight(site,time) {
  const cycle=(site.solarDay||29.53)*86400000;
  // Also cover polar night; samples are at most a quarter local solar hour.
  const step=cycle/96;
  for(let n=1;n<=192;n++) {
    const candidate=time+n*step;
    if(horizonAngles(surfaceFrame(site,new Date(candidate)).targets.Sun.direction).altitude>8) return candidate;
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
