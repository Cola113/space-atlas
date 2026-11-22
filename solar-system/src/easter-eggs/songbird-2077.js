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
  const l1Km = earth.positionKm.clone().lerp(moon.positionKm, earthFraction);
  const axis = earth.positionKm.clone().sub(moon.positionKm);
  const earthMoonKm = axis.length();
  if (!(earthMoonKm > 0)) return null;
  axis.divideScalar(earthMoonKm);
  const pole = moon.orientation?.north?.clone() || new THREE.Vector3(0, 0, 1);
  let tangent = axis.clone().cross(pole);
  if (tangent.lengthSq() < 1e-6) tangent = axis.clone().cross(new THREE.Vector3(0, 1, 0));
  tangent.normalize();
  const normal = tangent.clone().cross(axis).normalize();
  if (halo) {
    const phase = (((frame.date?.getTime() || SONGBIRD_DEFAULT_TIMESTAMP) - SONGBIRD_DEFAULT_TIMESTAMP) / HALO_PERIOD_MS) * Math.PI * 2;
    l1Km.addScaledVector(tangent, Math.cos(phase) * HALO_IN_PLANE_KM)
      .addScaledVector(normal, Math.sin(phase) * HALO_OUT_OF_PLANE_KM);
  }
  const relativeKm = l1Km.clone().sub(frame.observerKm);
  const distanceKm = relativeKm.length();
  if (!(distanceKm > 0)) return null;
  return {
    positionKm: l1Km,
    distanceKm,
    earthMoonKm,
    moonDistanceKm: l1Km.distanceTo(moon.positionKm),
    direction: frame.local(relativeKm).normalize(),
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
  const axis = corridor.clone().divideScalar(span);
  const position = earthPos.clone().addScaledVector(axis, distFromEarth);
  const up = new THREE.Vector3(0, 1, 0);
  let side = axis.clone().cross(up);
  if (side.lengthSq() < 1e-4) side = axis.clone().cross(new THREE.Vector3(1, 0, 0));
  side.normalize();
  const lift = side.clone().cross(axis).normalize();
  const phase = (((date instanceof Date ? date.getTime() : Number(date)) - SONGBIRD_DEFAULT_TIMESTAMP) / HALO_PERIOD_MS) * Math.PI * 2;
  const haloDisplay = Math.min(0.06, span * 0.015);
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
    english: 'TYCHO CRATER OVERLOOK · 2077',
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
    credit: '第谷坑缘虚构观景点 · 致敬《赛博朋克 2077：往日之影》· 地表重绘 gpt-image-2.6 / gpt-image-2.5-sunburst · 真实星历驱动天空',
    source: 'https://planetarynames.wr.usgs.gov/Feature/6175',
    description: '站在第谷撞击坑南缘高地。脚边留着一枚泛着微弱冷光的信标与远去的靴印，北方地平线上是静默的月面穹顶，头顶悬着 2077 年的蓝色地球。',
    notes: '本落点是致敬《赛博朋克 2077：往日之影》百灵鸟登月结局的隐藏彩蛋观景点：近景信标、靴印与远方第谷穹顶、质量投射器轮廓均为 AI 艺术重建，不是实测地形。落点取在第谷撞击坑南缘（44.71°S / 11.08°W，IAU 东经 348.92°E；坑心 43.31°S / 11.36°W 位于正北约 42 千米）；天空中的 2077 年地球高度角约 37.5°–49.8°、视直径约 1.82°–1.98°、地球相位与昼夜灯光、太阳与星空全部由本项目真实星历实时计算。切至望远镜 4× 或 8× 望向地球盘面旁，可观察到位于真实地月 L1 拉格朗日点（Halo 展示偏移、站体视大小经展示增强）的「水晶宫」轨道空间站。',
    coordinateNote: '彩蛋虚构地貌，不可用于地形测量；天体方向、相位与地月 L1 拉格朗日点位置采用真实力学计算。',
    solarDay: 29.53,
    panoramaCenter: 13.5,
    initialHeading: 13.5,
    initialPitch: 12,
    referenceSolarAltitude: 18,
    nightFloor: 0.022,
  }),
});

export const SONGBIRD_COPY = Object.freeze({
  tychoHint: '检测到 43.31°S 方向存在一条休眠的历史载波——将模拟时间拨至 2077 年可开启监听。',
  tycho2077: Object.freeze({
    eyebrow: 'TYCHO-ORBITAL // S.M. // 2077',
    badge: '/solar-system/easter-eggs/tycho-pin.png',
    badgeAlt: '第谷纪念金属别针（TYCHO 2077）',
    message: '“信号很微弱，但这里很安静，没有黑墙的杂音。谢谢你把我送到看得见星星的地方——偶尔抬头看看月亮南边吧。”',
    meta: '虚构致敬彩蛋（《赛博朋克 2077：往日之影》）· 非实测射电信号。月球南半球 43.31°S 冰蓝图钉已解锁，可直接降落至第谷终端。',
    radioLabelPlay: '收听第谷真空电波',
    radioLabelStop: '静默第谷电波',
    radioQuote: '真空中听不见声音，但无线电波把歌声带回了地球。',
  }),
  crystalPalace2077: Object.freeze({
    eyebrow: 'EARTH–MOON L1 // HALO ORBIT',
    badge: '/solar-system/easter-eggs/crystal-palace-emblem.png',
    badgeAlt: '水晶宫地月 L1 轨道空间站徽章',
    message: '悬停在地球与月球引力平衡处（地月 L1 拉格朗日点，距月球约 5.8 万公里）的双环轨道站。站在第谷抬头望向地球，它就在视线正中。',
    meta: '地月 L1 平衡比例（约 84.91% 距地 / 15.09% 距月）由三体欧拉方程实时求解；空间站实体与 Halo 偏移为《赛博朋克 2077》致敬彩蛋与展示增强。',
  }),
  tranquillitatis2077: Object.freeze({
    eyebrow: 'MARE TRANQUILLITATIS // 2077 NOTE',
    message: '“在 2077 年的静海，也曾有人摘下头盔，在月尘里闭眼晒太阳。”',
    meta: '虚构致敬注记（《赛博朋克：边缘行者》）· 静海本身为真实月海地貌。',
  }),
  atlasEaster: Object.freeze({
    eyebrow: 'ENCRYPTED SIGNAL // 2077',
    title: '截获来自月球第谷的休眠频段',
    detail: '目标坐标 43.31°S / 11.36°W · 关联地月 L1 节点「水晶宫」',
    action: '跳转 2077 年并定位月球第谷',
  }),
});

const SONGBIRD_KEYWORDS = [
  '百灵鸟', '宋昭美', '水晶宫', '第谷终端', '往日之影', '露西', '边缘行者', '蓝眼睛',
  'songbird', 'so mi', 'somi', 'crystal palace', 'phantom liberty', 'edgerunners', '2077', 'tycho',
];

export function matchesSongbirdQuery(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (normalized.length < 2) return false;
  return SONGBIRD_KEYWORDS.some((keyword) => normalized.includes(keyword) || (normalized.length >= 3 && keyword.includes(normalized)));
}

let cachedGlowTexture = null;

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
      const core = Math.exp(-r * r * 14);
      const halo = Math.exp(-r * 3.6) * 0.45 * Math.max(0, 1 - r);
      const v = Math.min(1, core + halo);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(185 + 70 * core);
      data[idx + 1] = Math.round(238 + 17 * core);
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(v * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  cachedGlowTexture = texture;
  return texture;
}

/**
 * Shared procedural 3D twin-ring Crystal Palace orbital station used in both
 * the Earth–Moon orbit scene and the lunar SurfaceSky (4x/8x telescope).
 */
export function createCrystalPalaceMesh({ scale = 1, includeHalo = true, withSkyDepth = null } = {}) {
  const group = new THREE.Group();
  group.name = 'crystal-palace-l1';
  const materials = [];
  const register = (material) => {
    materials.push(material);
    if (withSkyDepth) withSkyDepth(material);
    return material;
  };

  const goldMat = register(new THREE.MeshBasicMaterial({ color: '#e6d3a3' }));
  const hullMat = register(new THREE.MeshBasicMaterial({ color: '#c9d7e0' }));
  const cyanMat = register(new THREE.MeshBasicMaterial({ color: '#78ecff' }));
  const warmWindowMat = register(new THREE.MeshBasicMaterial({ color: '#fff1cc' }));

  const outerGroup = new THREE.Group();
  const innerGroup = new THREE.Group();

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.085, 14, 56), goldMat);
  outerRing.rotation.x = Math.PI / 2;
  outerGroup.add(outerRing);

  const outerRim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.028, 8, 56), warmWindowMat);
  outerRim.rotation.x = Math.PI / 2;
  outerRim.position.y = 0.068;
  outerGroup.add(outerRim);

  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.065, 12, 42), hullMat);
  innerRing.rotation.x = Math.PI / 2;
  innerGroup.add(innerRing);

  const spokeGeo = new THREE.CylinderGeometry(0.018, 0.018, 2.0, 6);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(spokeGeo, hullMat);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = (i * Math.PI) / 4;
    outerGroup.add(spoke);
  }

  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.95, 12), hullMat);
  spindle.position.y = 0.08;
  group.add(spindle);

  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.42, 10), goldMat);
  spire.position.y = 0.72;
  group.add(spire);

  const beaconRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 8, 28), cyanMat);
  beaconRing.rotation.x = Math.PI / 2;
  beaconRing.position.y = 0.16;
  group.add(beaconRing);

  group.add(outerGroup, innerGroup);

  let glow = null;
  if (includeHalo) {
    const spriteMat = register(new THREE.SpriteMaterial({
      map: createSoftGlowTexture(),
      color: '#a9eeff',
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    glow = new THREE.Sprite(spriteMat);
    glow.scale.setScalar(3.4);
    group.add(glow);
  }

  // Slight architectural tilt so twin rings read clearly from Earth–Moon angles.
  group.rotation.order = 'YXZ';
  group.scale.setScalar(scale);

  return {
    group,
    outerGroup,
    innerGroup,
    glow,
    materials,
    step(elapsedSeconds, pulse = 1) {
      outerGroup.rotation.y = elapsedSeconds * 0.28;
      innerGroup.rotation.y = -elapsedSeconds * 0.44;
      if (glow) glow.material.opacity = (0.58 + 0.18 * Math.sin(elapsedSeconds * 1.9)) * pulse;
    },
    dispose() {
      group.traverse((child) => {
        child.geometry?.dispose?.();
      });
      for (const mat of materials) mat.dispose();
    },
  };
}

/**
 * Subtle curved ice-cyan Earth–Moon orbital transfer arc + gliding shuttle
 * glint rendered in the orbit view when 2077 Songbird mode is active.
 */
export function createEarthMoonTransferArc() {
  const group = new THREE.Group();
  group.name = 'songbird-transfer-arc';
  const segments = 56;
  const positions = new Float32Array((segments + 1) * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineMaterial = new THREE.LineBasicMaterial({
    color: '#6be4ff',
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, lineMaterial);
  const shuttleMaterial = new THREE.SpriteMaterial({
    map: createSoftGlowTexture(),
    color: '#c8f8ff',
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shuttle = new THREE.Sprite(shuttleMaterial);
  shuttle.scale.setScalar(0.11);
  group.add(line, shuttle);

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const point = new THREE.Vector3();

  return {
    group,
    update(earthPos, l1Pos, moonPos, phase, { reducedMotion = false } = {}) {
      p0.copy(earthPos);
      p2.copy(moonPos);
      const chord = p2.clone().sub(p0);
      const side = chord.clone().cross(new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-5) side.set(1, 0, 0);
      side.normalize();
      p1.copy(l1Pos).addScaledVector(side, chord.length() * 0.14);
      const attr = geometry.getAttribute('position');
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const inv = 1 - t;
        point.set(
          inv * inv * p0.x + 2 * inv * t * p1.x + t * t * p2.x,
          inv * inv * p0.y + 2 * inv * t * p1.y + t * t * p2.y,
          inv * inv * p0.z + 2 * inv * t * p1.z + t * t * p2.z,
        );
        attr.setXYZ(i, point.x, point.y, point.z);
      }
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();

      const s = reducedMotion ? 0.68 : THREE.MathUtils.euclideanModulo(phase, 1);
      const inv = 1 - s;
      shuttle.position.set(
        inv * inv * p0.x + 2 * inv * s * p1.x + s * s * p2.x,
        inv * inv * p0.y + 2 * inv * s * p1.y + s * s * p2.y,
        inv * inv * p0.z + 2 * inv * s * p1.z + s * s * p2.z,
      );
      shuttleMaterial.opacity = Math.sin(s * Math.PI) * 0.9;
    },
    dispose() {
      geometry.dispose();
      lineMaterial.dispose();
      shuttleMaterial.dispose();
    },
  };
}

/**
 * Subtle Orbital Air shuttle streak descending across the 2077 Tycho sky
 * from the Earth/L1 direction toward the distant northern crater rim.
 */
export function createSurfaceShuttle() {
  const group = new THREE.Group();
  group.name = 'surface-orbital-shuttle';
  const trailPoints = 18;
  const positions = new Float32Array(trailPoints * 3);
  const alphas = new Float32Array(trailPoints);
  for (let i = 0; i < trailPoints; i++) alphas[i] = i / (trailPoints - 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aProgress', new THREE.BufferAttribute(alphas, 1));
  const trailMaterial = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `attribute float aProgress; varying float vProgress;
      void main() { vProgress = aProgress; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uOpacity; varying float vProgress;
      void main() { float a = pow(vProgress, 2.2) * uOpacity * 0.65; gl_FragColor = vec4(0.55, 0.92, 1.0, a); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const trail = new THREE.Line(geometry, trailMaterial);
  const headMaterial = new THREE.SpriteMaterial({
    map: createSoftGlowTexture(),
    color: '#b8f4ff',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const head = new THREE.Sprite(headMaterial);
  head.scale.setScalar(11);
  group.add(trail, head);
  group.renderOrder = 14;
  group.visible = false;

  const sampleDir = (startDir, endDir, t) => {
    const d = startDir.clone().lerp(endDir, t);
    // Subtle graceful orbital curve east-west before leveling near the horizon
    const bend = Math.sin(t * Math.PI) * 0.08;
    d.x += bend;
    d.y += Math.sin(t * Math.PI) * 0.035;
    return d.normalize();
  };

  return {
    group,
    update(startDir, targetAzimuthDeg, cyclePhase, { visible = true, reducedMotion = false } = {}) {
      if (!visible || reducedMotion || !startDir) {
        group.visible = false;
        return;
      }
      // Show a calm periodic pass during the first 28% of each cycle.
      const windowLength = 0.28;
      const p = THREE.MathUtils.euclideanModulo(cyclePhase, 1);
      if (p > windowLength) {
        group.visible = false;
        return;
      }
      const t = p / windowLength;
      const az = THREE.MathUtils.degToRad(targetAzimuthDeg);
      const alt = THREE.MathUtils.degToRad(4.8);
      const endDir = new THREE.Vector3(
        Math.sin(az) * Math.cos(alt),
        Math.sin(alt),
        -Math.cos(az) * Math.cos(alt),
      ).normalize();

      const radius = 540;
      const attr = geometry.getAttribute('position');
      const tailSpan = 0.095;
      for (let i = 0; i < trailPoints; i++) {
        const u = Math.max(0, t - tailSpan * (1 - i / (trailPoints - 1)));
        const dir = sampleDir(startDir, endDir, u).multiplyScalar(radius);
        attr.setXYZ(i, dir.x, dir.y, dir.z);
      }
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();

      const headPos = sampleDir(startDir, endDir, t).multiplyScalar(radius);
      head.position.copy(headPos);
      const envelope = Math.sin(t * Math.PI);
      const alpha = Math.pow(envelope, 0.65);
      trailMaterial.uniforms.uOpacity.value = alpha;
      headMaterial.opacity = alpha * 0.92;
      group.visible = alpha > 0.02;
    },
    dispose() {
      geometry.dispose();
      trailMaterial.dispose();
      headMaterial.dispose();
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
    color: '#76ecff',
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
