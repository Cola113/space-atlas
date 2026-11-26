import * as THREE from 'three';
import { MassProduct } from 'astronomy-engine';
import { physicalData } from '../physical-scale.js';

export const SONGBIRD_YEAR = 2077;
export const SONGBIRD_DEFAULT_DATE = '2077-06-12T18:00:00Z';
export const SONGBIRD_DEFAULT_TIMESTAMP = Date.parse(SONGBIRD_DEFAULT_DATE);

export const TYCHO_LATITUDE = -43.31;
export const TYCHO_LONGITUDE = 348.64; // 11.36°W in IAU east-positive longitude
// Southern rim overlook (~42.5 km south of crater center, matching Tycho's 85 km diameter)
export const TYCHO_RIM_LATITUDE = -44.71;
export const TYCHO_RIM_LONGITUDE = 348.92;
export const TRANQUILLITATIS_LATITUDE = 8.5;
export const TRANQUILLITATIS_LONGITUDE = 31.4;

const HALO_PERIOD_MS = 12 * 86400000;
const HALO_IN_PLANE_KM = 1550;
const HALO_OUT_OF_PLANE_KM = 1250;

export function isSongbird2077Active(date) {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isFinite(value.getTime()) && value.getUTCFullYear() >= SONGBIRD_YEAR;
}

let cachedL1 = null;

/**
 * Exact collinear Earth–Moon L1 ratio solved from the restricted three-body
 * Euler quintic using the same Astronomy Engine GM values as orbits.js.
 */
export function earthMoonL1Fraction() {
  if (cachedL1) return cachedL1;
  const gmEarth = MassProduct('Earth');
  const gmMoon = MassProduct('Moon');
  const mu = gmMoon / (gmEarth + gmMoon);
  let gamma = Math.cbrt(mu / 3);
  for (let i = 0; i < 14; i++) {
    const oneMinus = 1 - gamma;
    const f = (1 - mu) / (oneMinus * oneMinus) - mu / (gamma * gamma) - (1 - mu - gamma);
    const df = (2 * (1 - mu)) / (oneMinus * oneMinus * oneMinus) + (2 * mu) / (gamma * gamma * gamma) + 1;
    const step = f / df;
    gamma -= step;
    if (Math.abs(step) < 1e-15) break;
  }
  cachedL1 = Object.freeze({
    mu,
    moonFraction: gamma,
    earthFraction: 1 - gamma,
  });
  return cachedL1;
}

const _l1Pos = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _relative = new THREE.Vector3();
const _fallbackUp = new THREE.Vector3(0, 1, 0);
const _fallbackX = new THREE.Vector3(1, 0, 0);
const _fallbackZ = new THREE.Vector3(0, 0, 1);

/**
 * Compute Earth–Moon L1 (plus optional gentle display Halo offset) in a
 * surfaceFrame's local ENU sky coordinates. Works on any lunar landing site.
 */
export function computeEarthMoonL1(frame, { halo = true } = {}) {
  if (!frame?.physical?.bodies) return null;
  const earth = frame.physical.bodies.get('earth');
  const moon = frame.physical.bodies.get('moon');
  if (!earth || !moon) return null;
  const { earthFraction } = earthMoonL1Fraction();
  _l1Pos.copy(earth.positionKm).lerp(moon.positionKm, earthFraction);
  _axis.copy(earth.positionKm).sub(moon.positionKm);
  const earthMoonKm = _axis.length();
  if (!(earthMoonKm > 0)) return null;
  _axis.divideScalar(earthMoonKm);
  if (moon.orientation?.north) _pole.copy(moon.orientation.north);
  else _pole.copy(_fallbackZ);
  _tangent.crossVectors(_axis, _pole);
  if (_tangent.lengthSq() < 1e-6) _tangent.crossVectors(_axis, _fallbackUp);
  _tangent.normalize();
  _normal.crossVectors(_tangent, _axis).normalize();
  if (halo) {
    const phase = (((frame.date?.getTime() || SONGBIRD_DEFAULT_TIMESTAMP) - SONGBIRD_DEFAULT_TIMESTAMP) / HALO_PERIOD_MS) * Math.PI * 2;
    _l1Pos.addScaledVector(_tangent, Math.cos(phase) * HALO_IN_PLANE_KM)
      .addScaledVector(_normal, Math.sin(phase) * HALO_OUT_OF_PLANE_KM);
  }
  _relative.copy(_l1Pos).sub(frame.observerKm);
  const distanceKm = _relative.length();
  if (!(distanceKm > 0)) return null;
  return {
    positionKm: _l1Pos.clone(),
    distanceKm,
    earthMoonKm,
    moonDistanceKm: _l1Pos.distanceTo(moon.positionKm),
    direction: frame.local(_relative).normalize(),
  };
}

/**
 * Compute display-space world position of the Earth–Moon L1 Crystal Palace
 * station along the display Earth–Moon corridor, maintaining safe clearance
 * from both displayed globes.
 */
export function computeEarthMoonL1Display(earthBody, moonBody, date) {
  if (!earthBody?.physicalAvailable || !moonBody?.physicalAvailable) return null;
  const earthPos = earthBody.root.position;
  const moonPos = moonBody.root.position;
  const corridor = moonPos.clone().sub(earthPos);
  const span = corridor.length();
  if (!(span > 0.2)) return null;
  const { earthFraction } = earthMoonL1Fraction();
  const earthClear = (earthBody.renderRadius || earthBody.radius) * 1.45;
  const moonClear = (moonBody.renderRadius || moonBody.radius) * 1.65;
  const distFromEarth = THREE.MathUtils.clamp(span * earthFraction, earthClear, Math.max(earthClear, span - moonClear));
  const axis = corridor.divideScalar(span);
  const position = earthPos.clone().addScaledVector(axis, distFromEarth);
  const side = axis.clone().cross(_fallbackUp);
  if (side.lengthSq() < 1e-4) side.crossVectors(axis, _fallbackX);
  side.normalize();
  const lift = side.clone().cross(axis).normalize();
  const phase = (((date instanceof Date ? date.getTime() : Number(date)) - SONGBIRD_DEFAULT_TIMESTAMP) / HALO_PERIOD_MS) * Math.PI * 2;
  const haloDisplay = Math.min(0.055, span * 0.014);
  position.addScaledVector(side, Math.cos(phase) * haloDisplay)
    .addScaledVector(lift, Math.sin(phase) * haloDisplay * 0.72);
  return { position, axis, side, lift, span };
}

/**
 * Compute the southern Tycho limb offset direction on the Moon's disc as seen
 * from Earth (used for the 2077 Mauna Kea 4x/8x moon-echo easter egg).
 */
export function computeTychoEchoOnMoon(frame) {
  const moon = frame?.targets?.Moon;
  const moonBody = frame?.physical?.bodies?.get('moon');
  if (!moon || !moonBody?.orientation) return null;
  const lat = THREE.MathUtils.degToRad(TYCHO_LATITUDE);
  const lon = THREE.MathUtils.degToRad(TYCHO_LONGITUDE);
  const basis = moonBody.orientation;
  const equator = basis.prime.clone().multiplyScalar(Math.cos(lon)).addScaledVector(basis.east, Math.sin(lon));
  const surfaceNormal = equator.multiplyScalar(Math.cos(lat)).addScaledVector(basis.north, Math.sin(lat)).normalize();
  const tychoKm = moonBody.positionKm.clone().addScaledVector(surfaceNormal, physicalData.moon.radiusKm * 1.003);
  const toObserver = frame.observerKm.clone().sub(tychoKm);
  if (surfaceNormal.dot(toObserver) <= 0) return null; // Far-side or occluded
  const relative = tychoKm.clone().sub(frame.observerKm);
  return {
    direction: frame.local(relative).normalize(),
    distanceKm: relative.length(),
  };
}

export const easterEggLandingSites = Object.freeze({
  'moon-tycho': Object.freeze({
    siteId: 'moon-tycho',
    id: 'moon',
    body: 'Moon',
    name: '月球',
    title: '第谷终端 · 2077',
    english: 'TYCHO OVERLOOK · 2077',
    easterEgg: 'songbird-2077',
    latitude: TYCHO_RIM_LATITUDE,
    longitude: TYCHO_RIM_LONGITUDE,
    radiusKm: physicalData.moon.radiusKm,
    date: SONGBIRD_DEFAULT_DATE,
    parent: 'Earth',
    parentName: '地球',
    parentRadiusKm: physicalData.earth.radiusKm,
    texture: '/surface/moon-tycho.webp',
    parentClouds: '/solar-system/textures/2k_earth_clouds.jpg',
    provenance: '2077 致敬彩蛋 · AI 艺术重建',
    credit: '第谷坑缘虚构观景点 · 致敬《赛博朋克 2077：往日之影》· 地表重绘 gpt-image-2.5-sunburst · 真实星历驱动天空',
    source: 'https://planetarynames.wr.usgs.gov/Feature/6175',
    description: '站在第谷撞击坑南缘高地。右前方月岩旁静静放着一枚拉丝钛金属微光信标与远去的靴印，北方地平线上是静默的第谷月面穹顶与质量投射器，头顶悬着 2077 年的蓝色地球。',
    notes: '本落点是致敬《赛博朋克 2077：往日之影》百灵鸟登月结局的隐藏彩蛋观景点：近景信标、靴印与远方第谷基地、质量投射器轮廓均为 AI 艺术重建，不是实测地形。落点取在第谷撞击坑南缘（44.71°S / 11.08°W，IAU 东经 348.92°E；坑心 43.31°S / 11.36°W 位于正北约 42 千米）；天空中的 2077 年地球高度角约 37.5°–49.8°、视直径约 1.82°–1.98°、地球相位与昼夜灯光、太阳与星空全部由本项目真实星历实时计算。切至望远镜 4× 或 8× 望向地球盘面旁，可观察到位于真实地月 L1 拉格朗日点（Halo 展示偏移、站体视大小经展示增强）的「水晶宫」轨道空间站。',
    coordinateNote: '彩蛋虚构地貌，不可用于地形测量；天体方向、相位与地月 L1 拉格朗日点位置采用真实力学计算。',
    solarDay: 29.53,
    panoramaCenter: 13.5,
    initialHeading: 13.5,
    initialPitch: 15,
    referenceSolarAltitude: 18,
    nightFloor: 0.022,
  }),
});

export const SONGBIRD_COPY = Object.freeze({
  tycho2077: Object.freeze({
    eyebrow: 'TYCHO-ORBITAL // S.M. // 2077',
    badge: '/solar-system/easter-eggs/tycho-pin.png',
    badgeAlt: '第谷纪念金属别针（TYCHO 2077）',
    message: '“信号很微弱，但这里很安静，没有黑墙的杂音。谢谢你把我送到看得见星星的地方——偶尔抬头看看月亮南边吧。”',
    meta: '虚构致敬彩蛋（《赛博朋克 2077：往日之影》）· 非实测信号。点选月球南缘冰蓝图钉可降落至第谷终端。',
    radioLabelPlay: '收听第谷真空电波',
    radioLabelStop: '静默第谷电波',
  }),
  crystalPalace2077: Object.freeze({
    eyebrow: 'EARTH–MOON L1 // HALO ORBIT',
    badge: '/solar-system/easter-eggs/crystal-palace-emblem.png',
    badgeAlt: '水晶宫地月 L1 轨道空间站徽章',
    message: '站在第谷抬头望向地球时，它正好静悬在地球盘面旁的视线走廊中。',
    meta: '地月 L1 平衡比（84.91% 距地 / 15.09% 距月）由三体欧拉方程实时求解；站体与 Halo 偏移为《赛博朋克 2077》致敬与展示增强。',
  }),
  tranquillitatis2077: Object.freeze({
    eyebrow: 'MARE TRANQUILLITATIS // 2077 NOTE',
    message: '“在 2077 年的静海，也曾有人摘下头盔，在月尘里闭眼晒太阳。”',
    meta: '虚构致敬注记（《赛博朋克：边缘行者》）· 静海本身为真实月海地貌。',
  }),
  surfaceDormantNotice: '当前模拟年份早于 2077 年，第谷载波与地月 L1「水晶宫」处于休眠状态；拨回 2077 年及以后可重新接收。',
});

const SONGBIRD_KEYWORDS = [
  '百灵鸟', '宋昭美', '水晶宫', '第谷终端', '往日之影', '露西', '边缘行者', '蓝眼睛',
  'songbird', 'so mi', 'somi', 'crystal palace', 'phantom liberty', 'edgerunners', '2077', 'tycho',
];

export function matchesSongbirdQuery(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (normalized.length < 2) return false;
  return SONGBIRD_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

let cachedGlowTexture = null;
let cachedRingAlbedo = null;
let cachedRingEmissive = null;
let cachedPanelAlbedo = null;

function createSoftGlowTexture() {
  if (cachedGlowTexture) return cachedGlowTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.hypot(dx, dy);
      const core = Math.exp(-r * r * 18);
      const halo = Math.exp(-r * 4.2) * 0.34 * Math.max(0, 1 - r);
      const v = Math.min(1, core + halo);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(190 + 65 * core);
      data[idx + 1] = Math.round(234 + 21 * core);
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(v * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  cachedGlowTexture = texture;
  return texture;
}

function getRingTextures() {
  if (cachedRingAlbedo && cachedRingEmissive) {
    return { albedo: cachedRingAlbedo, emissive: cachedRingEmissive };
  }
  const w = 256;
  const h = 64;
  const albedoData = new Uint8Array(w * h * 4);
  const emissiveData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    // Tube circumference: put smoked viewport strip along the outer/upper face
    const bandDist = Math.abs(v - 0.5);
    const inViewport = bandDist < 0.14;
    const isTrim = Math.abs(bandDist - 0.155) < 0.025;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const modulePhase = x % 16;
      const isRib = modulePhase === 0 || modulePhase === 1;
      const isSubSeam = modulePhase === 8;

      // Brushed champagne-titanium outer hull, dark smoked glass viewport band
      let r = 216, g = 212, b = 201;
      if (isRib) {
        r = 188; g = 172; b = 136; // warm satin brass-titanium structural rib
      } else if (inViewport) {
        r = 34; g = 42; b = 48; // dark smoked observation glass
      } else if (isTrim) {
        r = 214; g = 194; b = 148; // champagne trim
      } else if (isSubSeam) {
        r = 165; g = 166; b = 164;
      } else {
        const grain = ((x * 37 + y * 17) % 11) - 5;
        r += grain; g += grain; b += grain;
      }
      albedoData[idx] = THREE.MathUtils.clamp(r, 0, 255);
      albedoData[idx + 1] = THREE.MathUtils.clamp(g, 0, 255);
      albedoData[idx + 2] = THREE.MathUtils.clamp(b, 0, 255);
      albedoData[idx + 3] = 255;

      // Subtle warm habitat window micro-lights recessed inside the dark band
      let er = 0, eg = 0, eb = 0;
      if (inViewport && !isRib && bandDist < 0.085) {
        const cell = (x % 16);
        const hash = Math.sin(Math.floor(x / 4) * 12.9898 + Math.floor(y / 3) * 78.233) * 43758.5453;
        const frac = hash - Math.floor(hash);
        if (cell >= 3 && cell <= 13 && (cell % 2 === 1) && frac > 0.34) {
          const lit = 0.55 + 0.45 * frac;
          er = Math.round(255 * lit);
          eg = Math.round(226 * lit);
          eb = Math.round(168 * lit);
        }
      }
      emissiveData[idx] = er;
      emissiveData[idx + 1] = eg;
      emissiveData[idx + 2] = eb;
      emissiveData[idx + 3] = 255;
    }
  }

  cachedRingAlbedo = new THREE.DataTexture(albedoData, w, h, THREE.RGBAFormat);
  cachedRingAlbedo.wrapS = THREE.RepeatWrapping;
  cachedRingAlbedo.wrapT = THREE.RepeatWrapping;
  cachedRingAlbedo.colorSpace = THREE.SRGBColorSpace;
  cachedRingAlbedo.needsUpdate = true;

  cachedRingEmissive = new THREE.DataTexture(emissiveData, w, h, THREE.RGBAFormat);
  cachedRingEmissive.wrapS = THREE.RepeatWrapping;
  cachedRingEmissive.wrapT = THREE.RepeatWrapping;
  cachedRingEmissive.colorSpace = THREE.SRGBColorSpace;
  cachedRingEmissive.needsUpdate = true;

  return { albedo: cachedRingAlbedo, emissive: cachedRingEmissive };
}

function getPanelTexture() {
  if (cachedPanelAlbedo) return cachedPanelAlbedo;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const grid = (x % 8 === 0) || (y % 16 === 0);
      data[idx] = grid ? 168 : 42;
      data[idx + 1] = grid ? 156 : 56;
      data[idx + 2] = grid ? 124 : 74;
      data[idx + 3] = 255;
    }
  }
  cachedPanelAlbedo = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  cachedPanelAlbedo.wrapS = THREE.RepeatWrapping;
  cachedPanelAlbedo.wrapT = THREE.RepeatWrapping;
  cachedPanelAlbedo.colorSpace = THREE.SRGBColorSpace;
  cachedPanelAlbedo.needsUpdate = true;
  return cachedPanelAlbedo;
}

/**
 * Shared procedural 3D twin-ring Crystal Palace orbital station used in both
 * the Earth–Moon orbit scene and the lunar SurfaceSky (4x/8x telescope).
 * Physically shaded by the Sun with subtle warm cabin-window emissive strips
 * so the shadow side reads believably next to Earth's day/night terminator.
 */
export function createCrystalPalaceMesh({
  scale = 1,
  includeHalo = true,
  withLighting = null,
  withSkyDepth = null,
} = {}) {
  const group = new THREE.Group();
  group.name = 'crystal-palace-l1';
  const materials = [];
  const register = (material, { lit = true } = {}) => {
    materials.push(material);
    if (lit && withLighting) withLighting(material);
    if (withSkyDepth) withSkyDepth(material);
    return material;
  };

  const { albedo: ringAlbedo, emissive: ringEmissive } = getRingTextures();
  const panelAlbedo = getPanelTexture();

  const outerRingMat = register(new THREE.MeshStandardMaterial({
    map: ringAlbedo,
    emissive: new THREE.Color('#ffe5b4'),
    emissiveMap: ringEmissive,
    emissiveIntensity: 1.15,
    metalness: 0.28,
    roughness: 0.42,
  }));

  const innerRingMat = register(new THREE.MeshStandardMaterial({
    map: ringAlbedo,
    color: '#dce4ea',
    emissive: new THREE.Color('#ffdca2'),
    emissiveMap: ringEmissive,
    emissiveIntensity: 0.88,
    metalness: 0.32,
    roughness: 0.40,
  }));

  const titaniumMat = register(new THREE.MeshStandardMaterial({
    color: '#cfd8df',
    metalness: 0.32,
    roughness: 0.46,
  }));

  const champagneMat = register(new THREE.MeshStandardMaterial({
    color: '#d8c295',
    metalness: 0.38,
    roughness: 0.36,
  }));

  const panelMat = register(new THREE.MeshStandardMaterial({
    map: panelAlbedo,
    metalness: 0.22,
    roughness: 0.52,
    side: THREE.DoubleSide,
  }));

  const beaconMat = register(new THREE.MeshBasicMaterial({
    color: '#7ce4f7',
    transparent: true,
    opacity: 0.85,
  }), { lit: false });

  const outerGroup = new THREE.Group();
  const innerGroup = new THREE.Group();

  // Slender primary rotating habitat torus
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.058, 16, 72), outerRingMat);
  outerRing.rotation.x = Math.PI / 2;
  outerGroup.add(outerRing);

  // Structural champagne-titanium collar ribs around the outer torus
  const collarGeo = new THREE.TorusGeometry(0.064, 0.011, 8, 16);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const collar = new THREE.Mesh(collarGeo, champagneMat);
    collar.position.set(Math.cos(angle), 0, Math.sin(angle));
    collar.rotation.y = -angle;
    outerGroup.add(collar);
  }

  // Slender counter-rotating inner ring
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.042, 14, 56), innerRingMat);
  innerRing.rotation.x = Math.PI / 2;
  innerGroup.add(innerRing);

  // 6 slender radial transfer spokes connecting outer ring to central hub
  const spokeGeo = new THREE.CylinderGeometry(0.012, 0.012, 2.0, 8);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(spokeGeo, titaniumMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = (i * Math.PI) / 3;
    outerGroup.add(spoke);
  }

  // 4 inner spokes connecting inner ring to central zero-g core
  const innerSpokeGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.08, 6);
  for (let i = 0; i < 2; i++) {
    const spoke = new THREE.Mesh(innerSpokeGeo, titaniumMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    innerGroup.add(spoke);
  }

  // Multi-tiered central zero-gravity docking axis + cupola + spire
  const hubCore = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.24, 18), titaniumMat);
  group.add(hubCore);

  const hubDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.145, 0.075, 20), champagneMat);
  hubDeck.position.y = 0.08;
  group.add(hubDeck);

  const upperSpindle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.072, 0.44, 14), titaniumMat);
  upperSpindle.position.y = 0.30;
  group.add(upperSpindle);

  const commSpire = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.36, 12), champagneMat);
  commSpire.position.y = 0.68;
  group.add(commSpire);

  const lowerDock = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.044, 0.42, 14), titaniumMat);
  lowerDock.position.y = -0.30;
  group.add(lowerDock);

  // Subtle thermal-radiator / photovoltaic wing pairs mounted off the lower axial boom
  const wingGeo = new THREE.BoxGeometry(0.42, 0.008, 0.15);
  for (const side of [-1, 1]) {
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.46, 6), titaniumMat);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(side * 0.28, -0.34, 0);
    group.add(boom);

    const wing = new THREE.Mesh(wingGeo, panelMat);
    wing.position.set(side * 0.48, -0.34, 0);
    wing.rotation.x = 0.32;
    group.add(wing);
  }

  // Restrained docking collar navigation beacon ring
  const beaconRing = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.009, 8, 28), beaconMat);
  beaconRing.rotation.x = Math.PI / 2;
  beaconRing.position.y = 0.125;
  group.add(beaconRing);

  group.add(outerGroup, innerGroup);

  // Subtle pinpoint starlight specular glint (prominent at 1x distance, fades out
  // on close-up/telescope magnification so it never washes out the station hull)
  let glow = null;
  if (includeHalo) {
    const spriteMat = register(new THREE.SpriteMaterial({
      map: createSoftGlowTexture(),
      color: '#bfefff',
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }), { lit: false });
    glow = new THREE.Sprite(spriteMat);
    glow.scale.setScalar(1.85);
    group.add(glow);
  }

  group.rotation.order = 'YXZ';
  group.scale.setScalar(scale);

  return {
    group,
    outerGroup,
    innerGroup,
    glow,
    materials,
    step(elapsedSeconds, glowStrength = 0.35) {
      outerGroup.rotation.y = elapsedSeconds * 0.24;
      innerGroup.rotation.y = -elapsedSeconds * 0.38;
      if (glow) {
        const twinkle = 0.86 + 0.14 * Math.sin(elapsedSeconds * 1.7);
        glow.material.opacity = THREE.MathUtils.clamp(glowStrength * twinkle, 0, 0.85);
        glow.visible = glow.material.opacity > 0.015;
      }
    },
    dispose() {
      const disposedGeo = new Set();
      group.traverse((child) => {
        if (child.geometry && !disposedGeo.has(child.geometry)) {
          disposedGeo.add(child.geometry);
          child.geometry.dispose();
        }
      });
      for (const mat of materials) mat.dispose();
    },
  };
}

/**
 * Tiny ice-cyan signal echo glint rendered on the Moon's southern Tycho limb
 * when viewing from Earth (Mauna Kea) in 2077 at >= 4x telescope zoom.
 */
export function createEarthMoonEchoPoint(withSkyDepth = null) {
  const material = new THREE.SpriteMaterial({
    map: createSoftGlowTexture(),
    color: '#8cf0ff',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  if (withSkyDepth) withSkyDepth(material);
  const sprite = new THREE.Sprite(material);
  sprite.name = 'surface-tycho-echo';
  sprite.renderOrder = 6;
  sprite.visible = false;
  return {
    sprite,
    material,
    dispose() {
      material.dispose();
    },
  };
}
