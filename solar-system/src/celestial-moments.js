import * as THREE from 'three';
import { physicalData } from './physical-scale.js';
import { physicalState } from './physics/state.js';
import { computeMoonTransit, MOON_TRANSIT_SYSTEMS, physicalAxes, physicalGeometryRotation } from './moon-transits.js';
import { geographicNormal } from './titan-glint.js';
import { ringShadowAnchor } from './feature-anchors.js';
import { primarySunspotAnchor } from './solar-sunspots.js';

// Curated observation moments and live ephemeris event finder.
// Every date here is evaluated by the app's own physical state (JPL year bundles or
// Astronomy Engine); no physical position, attitude or shadow is fabricated to fit a view.
export const CELESTIAL_MOMENTS = Object.freeze([
  {
    id: 'io-shadow-transit',
    category: 'orbit',
    title: '木卫一影凌木星',
    subtitle: '木星 · 2026-01-02 13:00 UTC',
    bodyId: 'jupiter',
    date: '2026-01-02T13:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'shadow-transit',
    transitMoon: 'io',
    summary: '木卫一走到太阳与木星之间，本影与半影同时滑过南热带云带，卫星本体也在近侧凌星。',
    provenance: 'Astronomy Engine IMCCE L1.2 · 影心与本影直径已与 JPL DE440 独立复核（差 0.07%）',
  },
  {
    id: 'titan-shadow-transit',
    category: 'orbit',
    title: '土卫六影凌土星',
    subtitle: '土星 · 2025-02-24 15:00 UTC',
    bodyId: 'saturn',
    date: '2025-02-24T15:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'shadow-transit',
    transitMoon: 'titan',
    summary: '土星春分前夕光环接近侧视，土卫六巨大的本影（约 3,992 km）正好投射在土星云顶上。',
    provenance: '本地 JPL SAT441 星历 · 实测扁球体求交 + 有限太阳盘本影/半影',
  },
  {
    id: 'triton-shadow-transit',
    category: 'orbit',
    title: '海卫一影凌海王星',
    subtitle: '海王星 · 2046-07-07 03:30 UTC',
    bodyId: 'neptune',
    date: '2046-07-07T03:30:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'shadow-transit',
    transitMoon: 'triton',
    summary: '海卫一逆行倾角约 157°，每约九十年才迎来一次影凌季；2046 年峰期其约 2,602 km 本影近直射海王星赤道云顶，同时可见近侧凌星本体。',
    provenance: '本地 JPL NEP098 星历（16 历元与 Horizons 最大差 16 m）· 实测扁球体求交 + 有限太阳盘本影/半影',
  },
  {
    id: 'titan-sea-glint',
    category: 'orbit',
    title: '土卫六北极海面日镜反光',
    subtitle: '土卫六 · 2014-08-19 14:00 UTC',
    bodyId: 'titan',
    date: '2014-08-19T14:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'titan-glint',
    glintTarget: Object.freeze({ latitude: 63.1055, longitude: 42.0117 }),
    summary: '太阳光在克拉肯海与丽姬亚海的液态烃海面上形成镜面反射，镜头直接对准反光角平分方向。',
    provenance: 'JPL SAT441 + 卡西尼雷达湖岸线（PIA17655）· 依据 5 μm 观测的可见光视觉增强',
  },
  {
    id: 'sun-differential-spots',
    category: 'orbit',
    title: '太阳黑子与差动自转',
    subtitle: '太阳 · 2025-07-01（第 25 周峰年附近 · 100k×）',
    bodyId: 'sun',
    date: '2025-07-01T12:00:00Z',
    playing: true,
    speed: 100000,
    cameraMode: 'sunspot',
    summary: '赤道自转周期约 24.5 天、中纬约 26.7 天；在 100k× 流速下可直观看到低纬黑子逐渐超前高纬活动区。',
    provenance: 'Snodgrass & Ulrich (1990) 差动自转经验公式 · 黑子位置与活动周为程序示意',
  },
  {
    id: 'saturn-ring-opening',
    category: 'orbit',
    title: '土星大张角光环与环影',
    subtitle: '土星 · 2032-08-15 12:00 UTC',
    bodyId: 'saturn',
    date: '2032-08-15T12:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'ring-shadow',
    summary: '土星南至点前后光环大角度张开，401 区公里级实测环带在云顶投下清晰环影与卡西尼环缝亮带。',
    provenance: 'PDS COUVIS_8001 光学厚度剖面 + Chandrasekhar 多次散射求解',
  },
  {
    id: 'saturn-ring-crossing',
    category: 'orbit',
    title: '土星 2025 环面穿越',
    subtitle: '土星 · 2025-03-23 16:00 UTC',
    bodyId: 'saturn',
    date: '2025-03-23T16:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'ring-edge',
    summary: '太阳几乎位于土星赤道环面内，宽阔光环收窄成近乎侧视的细线，环面掠射透射与暗面对比尤为明显。',
    provenance: 'Astronomy Engine + NAIF PCK00011 极轴姿态',
  },
  {
    id: 'phobos-mars-sky',
    category: 'surface',
    title: '火卫一斯蒂克尼 · 42° 巨型火星',
    subtitle: '火卫一地表 · 2026-09-27 00:52 UTC',
    bodyId: 'phobos',
    siteId: 'phobos-311e',
    date: '2026-09-27T00:52:00Z',
    playing: false,
    speed: 500,
    cameraMode: 'surface',
    summary: '火卫一刚走出火星影锥 12 分钟，视直径超过 42° 的火星悬在斯蒂克尼坑缘上方；切换倒放可回看火星日食。',
    provenance: '本地 JPL MAR099 星历（与 CSPICE 差 <0.65 m）· 轨道影像参考重绘全景',
  },
  {
    id: 'earth-moonrise',
    category: 'surface',
    title: '冒纳凯阿 · 2026 中秋满月升云海',
    subtitle: '地球地表 · 2026-09-27 05:30 UTC',
    bodyId: 'earth',
    siteId: 'earth',
    date: '2026-09-27T05:30:00Z',
    playing: false,
    speed: 500,
    cameraMode: 'surface',
    summary: '海拔 4207 米死火山顶，夏威夷黄昏后 99.5% 满月刚升起至云海上方 15.1°；可用「赏月 4×」望远镜细看。',
    provenance: 'Astronomy Engine 顶心视角 · 火山地貌与独立云海为艺术重建',
  },
  {
    id: 'moon-apollo15',
    category: 'surface',
    title: '阿波罗 15 号 · 月面仰望地球',
    subtitle: '月球地表 · 1971-08-01 17:00 UTC',
    bodyId: 'moon',
    siteId: 'moon',
    date: '1971-08-01T17:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'surface',
    summary: '1971 年哈德利-亚平宁着陆区实拍全景，地球高悬 68.3°；开启 8× 望远镜可见地球夜侧城市灯光。',
    provenance: 'NASA 阿波罗 15 号实拍全景拼接 · IAU 月球姿态与共享地球夜光',
  },
  {
    id: 'miranda-summer-2085',
    category: 'surface',
    title: '天卫五 · 2085 极昼高阳',
    subtitle: '天卫五地表 · 2085-06-15 12:00 UTC',
    bodyId: 'miranda',
    siteId: 'miranda',
    date: '2085-06-15T12:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'surface',
    summary: '天王星 98° 躺倒自转带来数十年一季：与 2026 年终日极夜相反，2085 年维罗纳断崖正午太阳升至高空。',
    provenance: '本地 JPL URA184 星历 · 旅行者 2 号地貌参考艺术重建',
  },
  {
    id: 'triton-neptune-sky',
    category: 'surface',
    title: '海卫一南极 · 8° 蔚蓝海王星',
    subtitle: '海卫一地表 · 2026-09-26 22:00 UTC',
    bodyId: 'triton',
    siteId: 'triton',
    date: '2026-09-26T22:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'surface',
    summary: '站在南纬 60° 氮冰原望向北方，视直径约 8° 的海王星悬于 29.8° 仰角，与地平线近 30° 的太阳交相照亮冰原。',
    provenance: '本地 JPL NEP098（DE442）真实星历 · 旅行者 2 号地貌参考艺术重建',
  },
  {
    id: 'iapetus-open-rings',
    category: 'surface',
    title: '土卫八赤道山脊 · 大张角土星环',
    subtitle: '土卫八地表 · 2031-05-01 12:00 UTC',
    bodyId: 'iapetus',
    siteId: 'iapetus',
    date: '2031-05-01T12:00:00Z',
    playing: false,
    speed: 1000,
    cameraMode: 'surface',
    summary: '借助土卫八相对土星赤道约 15° 的轨道倾角，在土星南至点迎来 −15.6° 大张角受光环面，卡西尼暗区与水冰交界处同时可见。',
    provenance: '本地 JPL SAT441（NAIF 608）真实星历 · 卡西尼号地貌参考艺术重建',
  },
]);

export function momentById(id) {
  return CELESTIAL_MOMENTS.find((entry) => entry.id === id) || null;
}

/**
 * Compute an optimal world-space camera offset vector for an orbital moment,
 * derived directly from the live physical frame and body world transform.
 */
export function computeMomentCameraOffset({ moment, body, frame, baseDistance }) {
  if (!moment || !body || !frame) return null;
  body.mesh.updateWorldMatrix(true, false);
  const sun = body.sunDirection?.clone().normalize() || new THREE.Vector3(1, 0, 0);

  if (moment.cameraMode === 'shadow-transit' && moment.transitMoon) {
    const parentState = frame.bodies.get(body.id);
    const moonState = frame.bodies.get(moment.transitMoon);
    const sunState = frame.bodies.get('sun');
    if (parentState && moonState && sunState) {
      const axes = physicalAxes(body.id);
      const rotation = physicalGeometryRotation(parentState.orientation);
      const transit = computeMoonTransit({
        sunPositionKm: sunState.positionKm,
        parentPositionKm: parentState.positionKm,
        moonPositionKm: moonState.positionKm,
        parentAxesKm: axes,
        parentRotation: rotation,
        moonRadiusKm: physicalData[moment.transitMoon].radiusKm,
        sunRadiusKm: physicalData.sun.radiusKm,
      });
      if (transit) {
        const worldHit = transit.centerGeometry.clone().applyMatrix4(body.mesh.matrixWorld);
        const outDir = worldHit.sub(body.root.position).normalize();
        // Frame slightly toward sunlight so both shadow umbra and foreground transit moon sit cleanly in view.
        let viewDir = outDir.clone().multiplyScalar(0.84).addScaledVector(sun, 0.24).normalize();
        // When a central transit sits nearly dead-subsolar (such as Triton on Neptune in 2046),
        // offset the distant sightline by ~1.7 deg so the foreground moon disc and its dark umbra
        // sit cleanly side-by-side inside the sunlit globe instead of occulting each other.
        if (body.id === 'neptune' && viewDir.dot(sun) > 0.9994) {
          const north = new THREE.Vector3(0, 1, 0).applyQuaternion(
            body.tilted.getWorldQuaternion(new THREE.Quaternion()),
          );
          const side = new THREE.Vector3().crossVectors(north, sun).normalize();
          viewDir = sun.clone().addScaledVector(side, 0.028).addScaledVector(north, 0.010).normalize();
        }
        return viewDir.multiplyScalar(baseDistance * (body.id === 'saturn' ? 0.72 : 0.80));
      }
    }
  }

  if (moment.cameraMode === 'titan-glint' && moment.glintTarget) {
    const localNormal = geographicNormal(moment.glintTarget.latitude, moment.glintTarget.longitude);
    const worldNormal = localNormal.clone().transformDirection(body.mesh.matrixWorld).normalize();
    if (worldNormal.dot(sun) > 0) {
      // Exact specular reflection ray originating at the finite-radius sea point so
      // normalize(cameraPosition - vTitanPosition) aligns to 0 deg inside the +/-2 deg cone.
      const mirrorView = sun.clone().negate().reflect(worldNormal).normalize();
      if (mirrorView.dot(worldNormal) > 0.05) {
        const surfaceWorld = localNormal.clone().applyMatrix4(body.mesh.matrixWorld);
        const surfaceOffset = surfaceWorld.sub(body.root.position);
        return surfaceOffset.addScaledVector(mirrorView, baseDistance * 0.84);
      }
    }
  }

  if (moment.cameraMode === 'ring-shadow') {
    const localSun = sun.clone().transformDirection(body.mesh.matrixWorld.clone().invert()).normalize();
    const anchor = ringShadowAnchor(localSun, body.shape);
    if (anchor) {
      const worldDir = anchor.clone().transformDirection(body.mesh.matrixWorld).normalize();
      const north = new THREE.Vector3(0, 1, 0).applyQuaternion(
        body.tilted.getWorldQuaternion(new THREE.Quaternion()),
      );
      const side = Math.sign(north.dot(sun)) || 1;
      const viewDir = worldDir.multiplyScalar(0.76).addScaledVector(sun, 0.34).addScaledVector(north, side * 0.38).normalize();
      return viewDir.multiplyScalar(baseDistance * 0.92);
    }
  }

  if (moment.cameraMode === 'ring-edge') {
    const north = new THREE.Vector3(0, 1, 0).applyQuaternion(
      body.tilted.getWorldQuaternion(new THREE.Quaternion()),
    );
    const tangent = new THREE.Vector3().crossVectors(north, sun).normalize();
    const viewDir = sun.clone().multiplyScalar(0.82).addScaledVector(tangent, 0.45).addScaledVector(north, 0.14).normalize();
    return viewDir.multiplyScalar(baseDistance * 0.94);
  }

  if (moment.cameraMode === 'sunspot') {
    const anchor = primarySunspotAnchor(frame.date);
    if (anchor) {
      const worldDir = anchor.viewDirection.clone().transformDirection(body.mesh.matrixWorld).normalize();
      return worldDir.multiplyScalar(baseDistance * 0.86);
    }
  }

  return null;
}

/**
 * Scan forward from `fromDate` using live Astronomy Engine / physicalState ephemerides
 * to locate the next real Galilean moon shadow transit across Jupiter's cloud tops.
 */
export function findNextJupiterShadowTransit(fromDate, provider = physicalState, {
  horizonHours = 96,
  stepMinutes = 15,
} = {}) {
  const startMs = fromDate instanceof Date ? fromDate.getTime() : Number(fromDate);
  if (!Number.isFinite(startMs)) return null;
  const axes = physicalAxes('jupiter');
  const sunRadiusKm = physicalData.sun.radiusKm;
  const moons = MOON_TRANSIT_SYSTEMS.jupiter;
  const stepMs = stepMinutes * 60000;
  const totalSteps = Math.ceil((horizonHours * 3600000) / stepMs);

  let coarseHit = null;
  for (let i = 1; i <= totalSteps; i++) {
    const t = startMs + i * stepMs;
    const frame = provider.frame(new Date(t));
    const jupiter = frame.bodies.get('jupiter');
    const sun = frame.bodies.get('sun');
    if (!jupiter || !sun) continue;
    const rotation = physicalGeometryRotation(jupiter.orientation);
    for (const moonId of moons) {
      const moon = frame.bodies.get(moonId);
      if (!moon) continue;
      const g = computeMoonTransit({
        sunPositionKm: sun.positionKm,
        parentPositionKm: jupiter.positionKm,
        moonPositionKm: moon.positionKm,
        parentAxesKm: axes,
        parentRotation: rotation,
        moonRadiusKm: physicalData[moonId].radiusKm,
        sunRadiusKm,
      });
      if (!g) continue;
      const incidence = -g.normalLocal.dot(g.axisLocal);
      if (incidence > 0.65) {
        coarseHit = { t, moonId, incidence, geometry: g };
        break;
      }
    }
    if (coarseHit) break;
  }
  if (!coarseHit) return null;

  // Refine within +/- 60 minutes at 2-minute steps to pick peak central-disc visibility.
  let best = coarseHit;
  for (let offset = -60; offset <= 60; offset += 2) {
    const t = coarseHit.t + offset * 60000;
    if (t <= startMs) continue;
    const frame = provider.frame(new Date(t));
    const jupiter = frame.bodies.get('jupiter');
    const sun = frame.bodies.get('sun');
    const moon = frame.bodies.get(coarseHit.moonId);
    if (!jupiter || !sun || !moon) continue;
    const rotation = physicalGeometryRotation(jupiter.orientation);
    const g = computeMoonTransit({
      sunPositionKm: sun.positionKm,
      parentPositionKm: jupiter.positionKm,
      moonPositionKm: moon.positionKm,
      parentAxesKm: axes,
      parentRotation: rotation,
      moonRadiusKm: physicalData[coarseHit.moonId].radiusKm,
      sunRadiusKm,
    });
    if (!g) continue;
    const incidence = -g.normalLocal.dot(g.axisLocal);
    if (incidence > best.incidence) best = { t, moonId: coarseHit.moonId, incidence, geometry: g };
  }

  const moonNames = { io: '木卫一', europa: '木卫二', ganymede: '木卫三', callisto: '木卫四' };
  const iso = new Date(best.t).toISOString();
  return {
    id: `live-jupiter-${best.moonId}-${best.t}`,
    category: 'orbit',
    title: `${moonNames[best.moonId] || best.moonId} 影凌木星`,
    subtitle: `木星 · ${iso.replace('T', ' ').slice(0, 16)} UTC`,
    bodyId: 'jupiter',
    date: iso,
    playing: false,
    speed: 1000,
    cameraMode: 'shadow-transit',
    transitMoon: best.moonId,
    umbraKm: Math.round(best.geometry.shadowDiameterKm),
    incidence: best.incidence,
    summary: `由当前模拟日期向后实时检索得到：${moonNames[best.moonId]}正在木星云顶投下约 ${Math.round(best.geometry.shadowDiameterKm)} km 宽的本影。`,
    provenance: 'Astronomy Engine IMCCE L1.2 实时星历检索',
  };
}
