import * as THREE from "three";
import { createElement, MapPin } from 'lucide';
import { uvDirection, ringShadowAnchor } from './feature-anchors.js';
import { shapeSurfacePoint, shapeSurfaceNormal } from './body-geometry.js';

const geographic = (latitude, longitude) => [
  THREE.MathUtils.euclideanModulo(longitude + 180, 360) / 360,
  (latitude + 90) / 180,
];

export const landmarks = {
  sun: [
    { id: 'prominence', name: '日珥', dynamic: 'prominence', zoom: 1.5, location: '太阳边缘 / 磁场活动示意', text: '等离子体沿磁场形成拱环。标记对应当前模拟日珥，不代表实时太阳活动。', source: 'https://science.nasa.gov/blogs/the-sun-spot/2019/07/03/fridays-solar-prominence/' },
    { id: 'solar-eruption', name: '物质喷发', dynamic: 'solar-eruption', zoom: 2, location: '活动区域 / 喷发示意', text: '标记随当前模拟喷发出现和消失，位置与演示时间不代表实时观测。', source: 'https://science.nasa.gov/blogs/the-sun-spot/2019/07/03/fridays-solar-prominence/' },
  ],
  earth: [
    {
      id: "beijing",
      name: "北京与华北平原",
      uv: geographic(39.9, 116.4),
      location: "39.9°N / 116.4°E",
      text: "山地与平原在这里交汇。夜侧的灯光勾勒出城市与交通走廊。",
      source:
        "https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/",
    },
    {
      id: "himalaya",
      name: "喜马拉雅山脉",
      uv: geographic(28, 86.9),
      location: "28.0°N / 86.9°E",
      text: "弧形山脉沿青藏高原南缘延伸，积雪与周围高原形成鲜明对比。",
      source: "https://science.nasa.gov/earth/",
    },
    {
      id: "nile",
      name: "尼罗河流域",
      uv: geographic(27, 31),
      location: "27.0°N / 31.0°E",
      text: "绿色河谷穿过沙漠。夜间灯光沿河流聚集，向北汇入三角洲。",
      source:
        "https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/",
    },
  ],
  mars: [
    { id: 'north-pole', name: '北极冰冠', uv: geographic(90, 0), location: '90°N / 北极地区', text: '北极高原保存着水冰与尘埃层，周围季节性冰霜随季节变化。此处为固定地图，未模拟极冠季节伸缩。', source: 'https://www.usgs.gov/maps/geologic-map-north-polar-region-mars' },
    {
      id: "olympus",
      name: "奥林帕斯山",
      uv: geographic(18.65, 226.2),
      location: "18.65°N / 226.20°E",
      text: "宽广的盾状火山，山顶可辨认出相互重叠的火山口。",
      source: "https://planetarynames.wr.usgs.gov/Feature/4453",
    },
    {
      id: "marineris",
      name: "水手号峡谷",
      uv: geographic(-13.74, 300.8),
      location: "13.74°S / 300.80°E",
      text: "横贯赤道以南的巨大峡谷群，分支与断裂向两侧延伸。",
      source: "https://planetarynames.wr.usgs.gov/Feature/6288",
    },
  ],
  jupiter: [
    {
      id: "red-spot",
      name: "大红斑",
      uv: [0.365, 0.39],
      location: "南半球 / 云顶风暴（示意位置）",
      text: "长期存在的巨大风暴。这里定位的是当前贴图中的大红斑，位置不代表实时经度。",
      source: "https://science.nasa.gov/jupiter/jupiter-facts/",
    },
  ],
  saturn: [
    { id: 'ring-shadow', name: '土星环阴影', dynamic: 'ring-shadow', location: '云顶 / 环系投影', text: '光环挡住阳光，在云层上形成暗带。标记依据当前日照与环面计算，阴影对比度经过展示增强。', source: 'https://science.nasa.gov/saturn/facts/' },
    { id: 'hexagon', name: '北极六边形风暴', uv: geographic(90, 0), location: '北极 / 六边形急流示意', text: '北极周围的高速急流形成近六边形边界，中心另有极地涡旋。形状和云纹为程序示意，不代表同期观测。', source: 'https://science.nasa.gov/photojournal/saturns-north-pole-hexagon-and-aurora/' },
  ],
  io: [
    { id: 'volcanic-plume', name: '火山喷发', dynamic: 'volcanic-plume', zoom: 1.3, location: '模拟热点 / 火山喷发', text: '喷发物从当前演示热点拱起并散落。此位置不指代某座已命名火山，强度与时间均为示意。', source: 'https://science.nasa.gov/jupiter/moons/io/' },
  ],
  enceladus: [
    { id: 'south-pole', name: '南极虎纹区', uv: geographic(-90, 0), location: '南极 / 虎纹裂缝区域', text: '南极裂缝向外输送水蒸气和冰粒，标记指向南极区域而非单条裂缝的测量坐标。', source: 'https://science.nasa.gov/mission/cassini/science/enceladus/' },
    { id: 'ice-plume', name: '南极冰粒喷流', dynamic: 'ice-plume', zoom: 1.4, location: '南极 / 喷流示意', text: '冰粒沿当前动画中的南极喷口向外扩散，亮度与规模为演示效果。', source: 'https://science.nasa.gov/mission/cassini/science/enceladus/' },
  ],
  pluto: [
    {
      id: "sputnik",
      name: "斯普特尼克平原",
      uv: [0.505, 0.6],
      location: "北半球 / 氮冰平原（示意位置）",
      text: "明亮的氮冰平原构成心形区域的一部分，与周围的深色高地形成鲜明对比。",
      source: "https://science.nasa.gov/resource/pluto-global-color-map/",
    },
  ],
  mimas: [
    { id: "herschel", name: "赫歇尔撞击坑", uv: geographic(-1.4, 114.4), location: "赤道附近 / 巨型撞击坑", text: "直径约 130 千米的赫歇尔撞击坑几乎占据土卫一半球，坑中央峰在低角度光照下尤其醒目。", source: "https://science.nasa.gov/saturn/moons/mimas/" },
  ],
  tethys: [
    { id: "odysseus", name: "奥德修斯撞击坑", uv: geographic(-32, 128), location: "西半球 / 多环盆地", text: "巨大的奥德修斯撞击坑横跨土卫三表面，低地形起伏让它看起来像一只浅色的眼睛。", source: "https://science.nasa.gov/saturn/moons/tethys/" },
  ],
  dione: [
    { id: "wispy", name: "亮纹地形", uv: geographic(-10, 235), location: "背土半球 / 构造条纹", text: "明亮的条纹沿断裂地形延展，可能由冰质物质沿裂缝暴露或喷出形成。", source: "https://science.nasa.gov/saturn/moons/dione/" },
  ],
  rhea: [
    { id: "rhea-craters", name: "稠密撞击坑区", uv: geographic(-18, 35), location: "南半球 / 古老高地", text: "土卫五的古老冰壳保存着密集撞击坑，坑壁上的亮色冰屑在晨昏线附近最容易辨认。", source: "https://science.nasa.gov/saturn/moons/rhea/" },
  ],
  iapetus: [
    { id: "cassini-regio", name: "卡西尼区域", uv: geographic(5, 240), location: "前进半球 / 深暗地形", text: "卡西尼区域的暗色覆盖与明亮冰质地形形成强烈边界，是土卫八最独特的全球特征。", source: "https://science.nasa.gov/saturn/moons/iapetus/" },
  ],
  miranda: [
    { id: "verona-rupes", name: "维罗纳断崖", uv: geographic(-18, 316), location: "南半球 / 巨型断崖", text: "维罗纳断崖是太阳系最高的已知悬崖之一，冰质断层在斜射光下呈现出清晰阴影。", source: "https://science.nasa.gov/uranus/moons/miranda/" },
  ],
};

export function landmarkFrame(feature, body, dynamicAnchor = () => null, shadows = true) {
  body.mesh.updateWorldMatrix(true, false);
  let anchor;
  if (feature.dynamic === 'ring-shadow') {
    const sun = body.sunDirection.clone().transformDirection(body.mesh.matrixWorld.clone().invert());
    // The anchor is already the exact ellipsoid intersection, so it must not be
    // scaled onto the surface a second time.
    const point = shadows && ringShadowAnchor(sun, body.shape);
    if (point) anchor = { point: point.multiplyScalar(1.017), extent: 1 };
  } else if (feature.dynamic) anchor = dynamicAnchor(body.id, feature.dynamic);
  else {
    const local = shapeSurfacePoint(body, uvDirection(feature.uv));
    // Point the camera along the true surface normal, not the radius vector.
    anchor = {
      point: local.clone().multiplyScalar(1.017),
      viewDirection: shapeSurfaceNormal(body, local.clone()),
      extent: 1,
    };
  }
  if (!anchor) return null;
  return {
    point: anchor.point.clone().applyMatrix4(body.mesh.matrixWorld),
    direction: (anchor.viewDirection || anchor.point).clone().transformDirection(body.mesh.matrixWorld),
    extent: anchor.extent ?? (anchor.viewDirection ? Math.max(1, anchor.point.length()) : 1),
  };
}

export function landingFrame(site, body) {
  body.mesh.updateWorldMatrix(true, false);
  const local = shapeSurfacePoint(body, uvDirection(geographic(site.latitude, site.longitude)));
  return {
    point: local.clone().applyMatrix4(body.mesh.matrixWorld),
    direction: local.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(body.mesh.matrixWorld)).normalize(),
    extent: 1,
  };
}

export function landingPointVisible(frame, body, observer, bodies) {
  const towardCamera = observer.clone().sub(frame.point);
  if (frame.direction.dot(towardCamera) <= 1e-8 * towardCamera.length()) return false;
  const sightline = new THREE.Raycaster(observer, towardCamera.negate().normalize(), 0, observer.distanceTo(frame.point));
  const occluders = [];
  for (const other of bodies) {
    if (other.id === body.id || other.physicalAvailable === false || !other.root.visible) continue;
    other.mesh.updateWorldMatrix(true, false);
    occluders.push(other.mesh);
  }
  return sightline.intersectObjects(occluders, false).length === 0;
}

export function createLandmarks(objects, camera, onSelect, dynamicAnchor, { landingSites = {}, onLanding = () => {} } = {}) {
  const container = document.getElementById("landmark-markers");
  const picker = document.getElementById("landmark-select");
  let bodyId = null;
  let active = null;
  let markers = [];
  let landingMarker = null;
  let shadows = true;
  const frameFor = feature => objects.has(bodyId) ? landmarkFrame(feature, objects.get(bodyId), dynamicAnchor, shadows) : null;
  picker.addEventListener("change", () => onSelect(picker.value));

  return {
    setBody(id) {
      bodyId = id;
      active = null;
      const features = landmarks[id] || [];
      picker.replaceChildren(
        new Option("选择地标", ""),
        ...features.map((feature) => new Option(feature.name, feature.id)),
      );
      picker.parentElement.hidden = features.length === 0;
      container.replaceChildren();
      landingMarker = null;
      markers = features.map((feature) => {
        const button = document.createElement("button");
        button.className = "landmark-marker";
        button.setAttribute("aria-label", `定位${feature.name}`);
        button.setAttribute("aria-pressed", "false");
        button.dataset.landmark = feature.id;
        const dot = document.createElement("span");
        dot.className = "landmark-dot";
        const label = document.createElement("span");
        label.className = "landmark-name";
        label.textContent = feature.name;
        button.append(dot, label);
        button.addEventListener("click", () => onSelect(feature.id));
        container.append(button);
        return { feature, button, label, option: picker.options[features.indexOf(feature) + 1], available: false, x: 0, y: 0, visible: false };
      });
      const site = landingSites[id];
      if (site) {
        const button = document.createElement("button");
        button.className = "landmark-marker landing-marker";
        button.setAttribute("aria-label", `降落到${site.name}表面 · ${site.title}`);
        button.dataset.landingBody = id;
        button.hidden = true;
        const pin = createElement(MapPin, { 'aria-hidden': 'true', width: 13, height: 13 });
        const label = document.createElement("span");
        label.className = "landmark-name";
        label.textContent = `降落 · ${site.title}`;
        button.title = `${label.textContent} · ${Math.abs(site.latitude)}°${site.latitude < 0 ? 'S' : 'N'} / ${site.longitude}°E`;
        button.append(pin, label);
        button.addEventListener("click", () => { if (landingMarker?.enabled && landingMarker.visible && !button.disabled) onLanding(id); });
        container.append(button);
        landingMarker = { site, button, label, x: 0, y: 0, visible: false, exposed: false, enabled: false };
      }
    },
    select(id) {
      const feature = (landmarks[bodyId] || []).find((feature) => feature.id === id);
      active = feature && frameFor(feature) ? feature : null;
      picker.value = active?.id || "";
      for (const marker of markers) {
        marker.button.classList.toggle("active", marker.feature === active);
        marker.button.setAttribute(
          "aria-pressed",
          String(marker.feature === active),
        );
      }
      return active;
    },
    setLandingAvailable(enabled) {
      if (!landingMarker) return;
      landingMarker.enabled = Boolean(enabled);
      landingMarker.button.setAttribute("aria-disabled", String(!enabled));
      landingMarker.button.tabIndex = enabled ? 0 : -1;
    },
    setLandingBusy(busy) {
      if (landingMarker) landingMarker.button.disabled = Boolean(busy);
    },
    focusLanding() {
      if (landingMarker?.enabled && landingMarker.visible) landingMarker.button.focus({ preventScroll: true });
      else {
        const info = document.getElementById('body-details-button');
        (info.checkVisibility() ? info : document.getElementById('landmark-brief-close')).focus({ preventScroll: true });
      }
    },
    focusActive() {
      const marker = markers.find(marker => marker.feature === active && marker.visible);
      if (marker) marker.button.focus({ preventScroll: true });
      else document.getElementById('observation-settings').querySelector('summary').focus({ preventScroll: true });
    },
    get active() {
      return active;
    },
    get frame() { return active ? frameFor(active) : null; },
    update({ width, height, hidden, reserved, shadows: showShadows }) {
      shadows = showShadows;
      const body = objects.get(bodyId);
      const occupied = [];
      const priority = marker => marker.feature === active ? 2 : marker.site ? 1 : 0;
      for (const marker of [...markers, ...(landingMarker ? [landingMarker] : [])].sort((a, b) => priority(b) - priority(a))) {
        marker.visible = false;
        const frame = marker.site ? body && landingFrame(marker.site, body) : frameFor(marker.feature);
        marker.available = Boolean(frame);
        if (marker.option) {
          marker.option.disabled = !frame;
          marker.option.hidden = !frame;
        }
        if (marker.site) marker.exposed = Boolean(frame && body.physicalAvailable && landingPointVisible(frame, body, camera.position, objects.values()));
        if (!hidden && body && frame && (!marker.site || (marker.enabled && marker.exposed))) {
          const point = frame.point;
          const normal = point.clone().sub(body.root.position).normalize();
          const towardCamera = camera.position.clone().sub(point);
          const projected = point.clone().project(camera);
          const x = (projected.x * 0.5 + 0.5) * width;
          const y = (-projected.y * 0.5 + 0.5) * height;
          // Include the entire label in collision checks, including on touch screens.
          marker.button.hidden = false;
          const labelWidth = marker.label.scrollWidth || marker.label.textContent.length * 11 + 12;
          const leftLabel = x + 11 + labelWidth > width - 16;
          const bounds = { left: x - (leftLabel ? 11 + labelWidth : 22),
            right: x + (leftLabel ? 22 : 11 + labelWidth), top: y - 22, bottom: y + 22 };
          const overlaps = (r) =>
            bounds.left < r.right &&
            bounds.right > r.left &&
            bounds.top < r.bottom &&
            bounds.bottom > r.top;
          marker.visible =
            (normal.dot(towardCamera) > 0 || (marker.feature?.dynamic && point.clone().sub(camera.position).normalize().cross(body.root.position.clone().sub(camera.position)).length() > body.radius)) &&
            projected.z > -1 &&
            projected.z < 1 &&
            bounds.left > 12 &&
            bounds.right < width - 12 &&
            bounds.top > 12 &&
            bounds.bottom < height - 12 &&
            !reserved.some(overlaps) &&
            !occupied.some(overlaps);
          marker.x = x;
          marker.y = y;
          if (marker.visible) {
            marker.button.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
            marker.button.classList.toggle("label-left", leftLabel);
            occupied.push(bounds);
          }
        }
        marker.button.hidden = !marker.visible;
      }
    },
    snapshot() {
      return {
        body: bodyId,
        active: active?.id || null,
        markers: markers.map(({ feature, x, y, visible, available }) => ({
          id: feature.id,
          x,
          y,
          visible,
          available,
        })),
        landing: landingMarker ? { body: bodyId, latitude: landingMarker.site.latitude, longitude: landingMarker.site.longitude, visible: landingMarker.visible, exposed: landingMarker.exposed, enabled: landingMarker.enabled, x: landingMarker.x, y: landingMarker.y } : null,
      };
    },
  };
}
