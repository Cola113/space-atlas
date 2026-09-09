import * as THREE from "three";

const geographic = (latitude, longitude) => [
  THREE.MathUtils.euclideanModulo(longitude + 180, 360) / 360,
  (latitude + 90) / 180,
];

export const landmarks = {
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
      location: "南半球 / 云顶风暴",
      text: "长期存在的巨大风暴。这里定位的是当前贴图中的大红斑，位置不代表实时经度。",
      source: "https://science.nasa.gov/jupiter/jupiter-facts/",
    },
  ],
  pluto: [
    {
      id: "sputnik",
      name: "斯普特尼克平原",
      uv: [0.505, 0.6],
      location: "北半球 / 氮冰平原",
      text: "明亮的氮冰平原构成心形区域的一部分，与周围的深色高地形成鲜明对比。",
      source: "https://science.nasa.gov/resource/pluto-global-color-map/",
    },
  ],
};

export function landmarkDirection(feature, body) {
  const [u, v] = feature.uv;
  const phi = u * Math.PI * 2;
  const theta = (1 - v) * Math.PI;
  body.mesh.updateWorldMatrix(true, false);
  return new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  ).transformDirection(body.mesh.matrixWorld);
}

export function createLandmarks(objects, camera, onSelect) {
  const container = document.getElementById("landmark-markers");
  const picker = document.getElementById("landmark-select");
  let bodyId = null;
  let active = null;
  let markers = [];
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
        return { feature, button, x: 0, y: 0, visible: false };
      });
    },
    select(id) {
      active =
        (landmarks[bodyId] || []).find((feature) => feature.id === id) || null;
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
    get active() {
      return active;
    },
    update({ width, height, hidden, reserved }) {
      const body = objects.get(bodyId);
      const occupied = [];
      for (const marker of [...markers].sort(
        (a, b) => Number(b.feature === active) - Number(a.feature === active),
      )) {
        marker.visible = false;
        if (!hidden && body) {
          const normal = landmarkDirection(marker.feature, body);
          const point = normal
            .clone()
            .multiplyScalar(body.radius * 1.017)
            .add(body.root.position);
          const towardCamera = camera.position.clone().sub(point);
          const projected = point.clone().project(camera);
          const x = (projected.x * 0.5 + 0.5) * width;
          const y = (-projected.y * 0.5 + 0.5) * height;
          const bounds = {
            left: x - 22,
            right: x + 22,
            top: y - 22,
            bottom: y + 22,
          };
          const overlaps = (r) =>
            bounds.left < r.right &&
            bounds.right > r.left &&
            bounds.top < r.bottom &&
            bounds.bottom > r.top;
          marker.visible =
            normal.dot(towardCamera) > 0 &&
            projected.z > -1 &&
            projected.z < 1 &&
            x > 24 &&
            x < width - 24 &&
            y > 76 &&
            y < height - 180 &&
            !reserved.some(overlaps) &&
            !occupied.some(overlaps);
          marker.x = x;
          marker.y = y;
          if (marker.visible) {
            marker.button.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
            marker.button.classList.toggle("label-left", x > width - 180);
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
        markers: markers.map(({ feature, x, y, visible }) => ({
          id: feature.id,
          x,
          y,
          visible,
        })),
      };
    },
  };
}
