import "./style.css";
import { mountNavigation } from "../../platform/navigation.ts";
import { readSession, rememberScene } from "../../platform/session.ts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createIcons,
  Orbit,
  GalleryHorizontalEnd,
  Info,
  Maximize,
  Minimize,
  ArrowUpRight,
  ArrowLeft,
  ScanSearch,
  Tags,
  Plus,
  Minus,
  Scan,
  Pause,
  Play,
  X,
  Waves,
  Zap,
  Crosshair,
  MapPin,
  SunMoon,
  MoonStar,
  Layers,
} from "lucide";
import { bodies, ORBIT_SPACING, SYSTEM_RADIUS } from "./data.js";
import { createDynamics, activityProfiles } from "./dynamics.js";
import { createLandmarks, landmarks, landmarkDirection } from "./landmarks.js";
import {
  cameraPath,
  occludedByBody,
  smoothProgress,
} from "./camera-navigation.js";
import {
  orbitPoint,
  updatePrimaryOrbits,
  updateSatelliteOrbits,
  updateBodyRotations,
} from "./orbits.js";
import { physicalData } from "./physical-scale.js";
import { createObservedClouds } from "./observed-clouds.js";
import { alignObservedEarth, subsolarPoint } from "./earth-observation.js";
import { createStarfield } from "./starfield.js";
import { simulationElapsed, simulationRates, defaultSimulationRate, restoreSimulationRate,
  defaultSimulationDate, restoreSimulationDate, formatSimulationRate, simulationRateEquivalent } from "./simulation-time.js";

const icons = {
  Orbit,
  GalleryHorizontalEnd,
  Info,
  Maximize,
  Minimize,
  ArrowUpRight,
  ArrowLeft,
  ScanSearch,
  Tags,
  Plus,
  Minus,
  Scan,
  Pause,
  Play,
  X,
  Waves,
  Zap,
  Crosshair,
  MapPin,
  SunMoon,
  MoonStar,
  Layers,
};
const $ = (id) => document.getElementById(id);
const refreshIcons = () =>
  createIcons({ icons, attrs: { "aria-hidden": "true" } });
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = {
  selected: null,
  close: false,
  playing: !reducedMotion,
  speed: defaultSimulationRate,
  orbits: true,
  labels: false,
  atlas: false,
  date: defaultSimulationDate,
  ready: false,
  dynamics: true,
  lockSpin: false,
  activityRate: 1,
  nightLights: true,
  shadows: true,
  nightView: false,
  system: false,
  catalog: "planets",
  observedEarth: false,
};
const objects = new Map();
const highTextures = new Map();
const highInFlight = new Map();
const failedTextures = new Set();
let scene,
  camera,
  renderer,
  controls,
  starfield,
  belt,
  sunLight,
  keyLight,
  fillLight,
  ambientLight,
  dynamics,
  landmarkView;
let landmarkSpin = null;
let observedClouds;
let observationSecond = -1;
let observedSun = null;
let flight = null;
let lastFrame = 0;
let lastActivityUi = 0;
let width = innerWidth;
let height = innerHeight;
let mobile = width <= 760;
let toastTimeout;
let viewOffset = new THREE.Vector2();
let contextLost = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const scratch = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraUp = new THREE.Vector3();
const epochDate = new Date(state.date);
let disposed = false;
let surfaceView = null;
let landingBusy = false;
let surfaceOrbitPose = null;

function saveObservation() {
  const body = objects.get(state.selected);
  const center = body?.root.position || new THREE.Vector3();
  return {
    selected: state.selected, system: state.system, close: state.close,
    playing: state.playing, speed: state.speed, speedUnit: "realtime", orbits: state.orbits, labels: state.labels,
    dynamics: state.dynamics, lockSpin: state.lockSpin, activityRate: state.activityRate,
    nightLights: state.nightLights, shadows: state.shadows, nightView: state.nightView,
    observedEarth: state.observedEarth, date: state.date, timelineEpoch: defaultSimulationDate,
    offset: (flight?.endOffset || surfaceOrbitPose?.offsetFromBody || camera.position.clone().sub(center)).toArray(),
    portrait: width < height,
    rotations: [...objects.values()].map(item => [item.id, item.mesh.rotation.y]),
    layerVisible: body?.layerVisible,
  };
}

function restoreObservation() {
  const saved = readSession("solar-system");
  if (!saved) return;
  for (const key of ["playing", "orbits", "labels", "dynamics", "lockSpin", "nightLights", "shadows"])
    if (typeof saved[key] === "boolean") state[key] = saved[key];
  state.speed = restoreSimulationRate(saved);
  if ([0.5, 1, 2, 4].includes(saved.activityRate)) state.activityRate = saved.activityRate;
  state.date = restoreSimulationDate(saved);
  if (typeof saved.observedEarth === "boolean") {
    $("cloud-mode").value = saved.observedEarth ? "observed" : "simulation";
    $("cloud-mode").dispatchEvent(new Event("change"));
  }
  updatePositions();
  if (objects.has(saved.selected)) {
    if (saved.system && familyOf(objects.get(saved.selected))) selectSystem(saved.selected);
    else {
      selectBody(saved.selected);
      if (saved.nightView && saved.selected === "earth") $("night-view").click();
      if (saved.close) toggleClose();
      if (typeof saved.layerVisible === "boolean") setLayer(saved.layerVisible);
    }
  }
  if (saved.timelineEpoch === defaultSimulationDate && Array.isArray(saved.rotations)) for (const entry of saved.rotations) {
    if (Array.isArray(entry) && objects.has(entry[0]) && Number.isFinite(entry[1]))
      objects.get(entry[0]).mesh.rotation.y = entry[1];
  }
  if (isEarthObservation()) syncObservedEarth();
  if (Array.isArray(saved.offset) && saved.offset.length === 3 && saved.offset.every(n => Number.isFinite(n) && Math.abs(n) < 1e5)) {
    const offset = new THREE.Vector3().fromArray(saved.offset);
    if (offset.length() > 0.1) {
      const body = objects.get(state.selected);
      if (saved.portrait !== (width < height)) offset.setLength(body ? currentFocusOffset(body).length() : overviewPosition().length());
      flight = null;
      controls.target.copy(body?.root.position || new THREE.Vector3());
      camera.position.copy(controls.target).add(offset);
      viewOffset.copy(desiredOffset());
      applyViewOffset();
      controls.update();
      applyDistanceLimits();
    }
  }
  for (const [id, key] of [["orbit-toggle", "orbits"], ["label-toggle", "labels"], ["activity-toggle", "dynamics"]]) {
    $(id).classList.toggle("active", state[key]);
    $(id).setAttribute("aria-pressed", String(state[key]));
  }
  updateTimeRateUi();
  $("activity-rate").value = String(state.activityRate);
  dynamics.setEnabled(state.dynamics);
  dynamics.setRate(state.activityRate);
  setSceneVisibility(); updatePlayButton(); updateObservationTools(); updateSimulationDate();
}

function disposeScene() {
  if (disposed) return;
  disposed = true;
  contextLost = true;
  surfaceView?.dispose();
  observedClouds?.dispose();
  starfield?.dispose();
  controls?.dispose();
  dynamics?.dispose();
  const textures = new Set(highTextures.values());
  scene?.traverse(object => {
    object.geometry?.dispose();
    for (const material of [object.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
  renderer?.dispose();
  renderer?.forceContextLoss();
}

function thumb(body) {
  return `<span class="planet-thumb ${body.id}" style="--body-color:${body.color};--texture:url('/solar-system/textures/${body.baseTexture || `2k_${body.texture}.jpg`}')" aria-hidden="true"></span>`;
}

function makeNavigation() {
  $("planet-dock").innerHTML = bodies
    .map(
      (body, index) =>
        `<button class="planet-choice" data-body="${body.id}" aria-label="探索${body.name}" aria-pressed="false"><span class="choice-number">${String(index).padStart(2, "0")}</span>${thumb(body)}<span class="choice-name">${body.name}</span><span class="choice-en">${body.english}</span></button>`,
    )
    .join("");
  $("atlas-grid").innerHTML = bodies
    .map(
      (body) =>
        `<button class="atlas-item" data-body="${body.id}" aria-label="近距离探索${body.name}">${thumb(body)}<div><small>${body.english}</small><h2>${body.name}</h2><p>${body.category}</p></div></button>`,
    )
    .join("");
  document
    .querySelectorAll("[data-body]")
    .forEach((button) =>
      button.addEventListener("click", () => selectBody(button.dataset.body)),
    );
  for (const body of bodies) {
    const label = document.createElement("button");
    label.className = "planet-label";
    label.dataset.label = body.id;
    label.style.setProperty("--body-color", body.color);
    label.setAttribute("aria-label", `查看${body.name}`);
    label.innerHTML = `${body.name}<span class="label-en">${body.english}</span>`;
    label.addEventListener("click", () => selectBody(body.id));
    $("planet-labels").append(label);
  }
  refreshIcons();
  setCatalog(state.catalog);
  $("body-count").textContent = `${bodies.length} 个可探索天体`;
  filterAtlas();
}

function setCatalog(group) {
  state.catalog = group;
  $("catalog-filter").value = group;
  document.querySelectorAll(".planet-choice").forEach((button) => {
    const body = bodies.find((item) => item.id === button.dataset.body);
    button.hidden = (body.group || "planets") !== group;
  });
  $("planet-dock").scrollLeft = 0;
}

function filterAtlas() {
  const query = $("atlas-search").value.trim().toLocaleLowerCase();
  const group = $("atlas-filter").value;
  let count = 0;
  document.querySelectorAll(".atlas-item").forEach((button) => {
    const body = bodies.find((item) => item.id === button.dataset.body);
    const visible =
      (group === "all" || (body.group || "planets") === group) &&
      `${body.name} ${body.english} ${body.category}`
        .toLocaleLowerCase()
        .includes(query);
    button.hidden = !visible;
    if (visible) count++;
  });
  $("atlas-count").textContent = `${count} 个天体`;
  $("atlas-empty").hidden = count !== 0;
}

function familyOf(body) {
  const parent = body?.parent ? objects.get(body.parent) : body;
  return parent &&
    [...objects.values()].some((item) => item.parent === parent.id)
    ? parent
    : null;
}

function updateFamilyPicker() {
  const parent = familyOf(objects.get(state.selected));
  $("family-picker").hidden = !parent;
  if (!parent) return;
  const name = parent.id === "earth" ? "地月系" : `${parent.name}系`;
  const members = [parent, ...objects.values()].filter(
    (item, index) => index === 0 || item.parent === parent.id,
  );
  $("family-select").innerHTML =
    `<option value="">${name}${state.system ? "全景" : ""}</option>` +
    `<option value="system:${parent.id}">${name}全景</option>` +
    members
      .map(
        (item) =>
          `<option value="${item.id}">${item.name}${item.id === parent.id ? " · 主星" : ""}</option>`,
      )
      .join("");
}

function selectSystem(id) {
  selectBody(id);
  if (!familyOf(objects.get(id))) return;
  state.system = true;
  $("app").classList.add("system-view");
  clearLandmark();
  state.nightView = false;
  $("surface-button").querySelector("span").textContent =
    `观测${objects.get(id).name}`;
  $("view-status").textContent = `${objects.get(id).name}系 / 卫星轨道示意`;
  $("caption-title").textContent =
    id === "earth" ? "地球与月球" : `${objects.get(id).name}与卫星`;
  $("caption-detail").textContent = systemDescription();
  $("layer-control").hidden = true;
  updateFamilyPicker();
  updateObservationTools();
  updateActivityUi();
  setSceneVisibility();
  flyTo(objects.get(id).root.position, currentFocusOffset(objects.get(id)));
}

function toast(message) {
  clearTimeout(toastTimeout);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimeout = setTimeout(() => {
    $("toast").hidden = true;
  }, 4500);
}

function fatal(message) {
  $("loading-screen").hidden = true;
  $("error-message").textContent = message;
  $("error-screen").hidden = false;
}

function configureTexture(texture, color = true, longitude = true) {
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = longitude ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  texture.needsUpdate = true;
  return texture;
}

async function loadBaseTextures() {
  const names = [
    ...new Set([
      ...bodies.map((body) => body.baseTexture || `2k_${body.texture}.jpg`),
      "2k_earth_clouds.jpg",
      "2k_venus_surface.jpg",
      "2k_saturn_ring_alpha.png",
      "earth_night_2016.jpg",
    ]),
  ];
  let loaded = 0;
  const loader = new THREE.TextureLoader();
  const textureMap = new Map();
  await Promise.all(
    names.map(async (name) => {
      try {
        const texture = await loader.loadAsync(`/solar-system/textures/${name}`);
        textureMap.set(
          name,
          configureTexture(texture, true, name !== "2k_saturn_ring_alpha.png"),
        );
      } catch {
        failedTextures.add(name);
      } finally {
        loaded++;
        $("loading-progress").style.width = `${(loaded / names.length) * 100}%`;
        $("loading-text").textContent = `${loaded} / ${names.length}`;
      }
    }),
  );
  return textureMap;
}

function addAtmosphere(group, radius, color, strength = 0.5) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      strength: { value: strength },
      sunPosition: { value: sunLight.position },
    },
    vertexShader: `varying vec3 vNormal; varying vec3 vView;
      varying vec3 vWorldNormal; varying vec3 vWorldPosition;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 tint; uniform float strength; uniform vec3 sunPosition;
      varying vec3 vNormal; varying vec3 vView; varying vec3 vWorldNormal; varying vec3 vWorldPosition;
      void main(){
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float daylight = smoothstep(-.12, .2, dot(normalize(vWorldNormal), normalize(sunPosition - vWorldPosition)));
        float glow = pow(1.0 - facing, 4.5) * strength * mix(.04, 1.0, daylight);
        gl_FragColor = vec4(tint, glow);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.025, 64, 48),
    material,
  );
  group.add(atmosphere);
  return atmosphere;
}

function createStars() {
  starfield = createStarfield(renderer);
  scene.add(starfield.group);
  let seed = 7813;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const beltBodies = bodies.filter((body) => ["vesta", "ceres"].includes(body.id));
  const beltInner = Math.min(...beltBodies.map((body) => body.orbit - body.radius)) - 0.35;
  const beltOuter = Math.max(...beltBodies.map((body) => body.orbit + body.radius)) + 0.35;
  const asteroidPositions = [];
  for (let index = 0; index < 2800; index++) {
    const angle = random() * Math.PI * 2;
    const radius = THREE.MathUtils.lerp(beltInner, beltOuter, random());
    asteroidPositions.push(
      Math.cos(angle) * radius,
      (random() - 0.5) * 0.55,
      Math.sin(angle) * radius,
    );
  }
  const asteroidGeometry = new THREE.BufferGeometry();
  asteroidGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(asteroidPositions, 3),
  );
  belt = new THREE.Points(
    asteroidGeometry,
    new THREE.PointsMaterial({
      color: "#8a8e77",
      size: 0.075,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    }),
  );
  scene.add(belt);
}

function createBodies(textures) {
  const sphere = new THREE.SphereGeometry(1, 112, 80);
  for (const body of bodies) {
    const root = new THREE.Group();
    const tilted = new THREE.Group();
    tilted.rotation.z = THREE.MathUtils.degToRad(body.tilt);
    root.add(tilted);
    const map = textures.get(body.baseTexture || `2k_${body.texture}.jpg`);
    const material =
      body.id === "sun"
        ? new THREE.MeshBasicMaterial({
            map,
            color: map ? "#ffffff" : body.color,
            toneMapped: false,
          })
        : new THREE.MeshStandardMaterial({
            map,
            color: map ? "#ffffff" : body.color,
            roughness: body.id === "earth" ? 0.76 : 1,
            metalness: 0,
          });
    if (["mercury", "mars"].includes(body.id)) {
      material.bumpMap = map;
      material.bumpScale = body.radius * 0.025;
    }
    const geometry = body.shape ? sphere.clone().scale(...body.shape) : sphere;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(body.radius);
    mesh.rotation.y =
      body.id === "earth" ? 3.3 : body.id === "jupiter" ? -1.0 : 0;
    mesh.userData.bodyId = body.id;
    tilted.add(mesh);
    let clouds = null,
      ring = null;
    if (body.id === "earth") {
      clouds = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({
          map: textures.get("2k_earth_clouds.jpg"),
          alphaMap: textures.get("2k_earth_clouds.jpg"),
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          roughness: 1,
        }),
      );
      clouds.scale.setScalar(body.radius * 1.012);
      clouds.rotation.y = mesh.rotation.y;
      tilted.add(clouds);
      addAtmosphere(tilted, body.radius, "#489dd8", 0.74);
    }
    if (body.id === "sun") {
      const corona = new THREE.Mesh(
        new THREE.SphereGeometry(body.radius * 1.13, 64, 48),
        new THREE.ShaderMaterial({
          vertexShader: `varying vec3 vN; varying vec3 vV; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
          fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){float f=abs(dot(normalize(vN),normalize(vV)));float a=pow(f,2.0)*.32;gl_FragColor=vec4(1.0,.18,.012,a);}`,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      );
      tilted.add(corona);
    }
    if (["venus", "uranus", "neptune", "titan"].includes(body.id))
      addAtmosphere(tilted, body.radius, body.color, 0.23);
    if (body.id === "saturn") {
      const geometry = new THREE.RingGeometry(
        body.radius * 1.28,
        body.radius * 2.35,
        192,
        1,
      );
      const positions = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      for (let index = 0; index < positions.count; index++) {
        scratch.fromBufferAttribute(positions, index);
        uv.setXY(
          index,
          (scratch.length() - body.radius * 1.28) / (body.radius * 1.07),
          0.5,
        );
      }
      ring = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          map: textures.get("2k_saturn_ring_alpha.png"),
          transparent: true,
          side: THREE.DoubleSide,
          roughness: 1,
          depthWrite: false,
          opacity: 0.95,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.userData.bodyId = body.id;
      tilted.add(ring);
    }
    let orbitLine = null;
    if (body.orbit) {
      const points = [];
      for (let index = 0; index < 256; index++) {
        const angle = (index / 256) * Math.PI * 2;
        points.push(orbitPoint(body, angle));
      }
      orbitLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: "#7e9f92",
          transparent: true,
          opacity: body.parent ? 0.28 : 0.17,
        }),
      );
      scene.add(orbitLine);
    }
    scene.add(root);
    objects.set(body.id, {
      ...body,
      root,
      tilted,
      mesh,
      clouds,
      ring,
      orbitLine,
      orbitCenter: new THREE.Vector3(),
      lowMap: map,
      nightMap:
        body.id === "earth" ? textures.get("earth_night_2016.jpg") : null,
      surfaceMap: textures.get("2k_venus_surface.jpg"),
      layerVisible: true,
      label: document.querySelector(`[data-label="${body.id}"]`),
    });
  }
}

function updatePositions() {
  const date = new Date(state.date);
  updatePrimaryOrbits(objects, date);
  updateSatelliteOrbits(
    objects,
    date,
    state.lockSpin ? state.selected : null,
  );
  updateBodyRotations(objects,date,state.lockSpin ? state.selected : null);
}

function updateSimulationDate() {
  const date = new Date(state.date);
  const label = `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
  if ($("simulation-date").textContent !== label) {
    $("simulation-date").textContent = label;
  }
  $("simulation-date").dateTime = date.toISOString();
  $("simulation-date").title = date.toISOString().replace("T", " ").slice(0,19) + " UTC";
}

function isEarthObservation() {
  return state.observedEarth && state.selected === "earth" && !state.system;
}

function syncObservedEarth() {
  const second = Math.floor(state.date / 1000);
  if (second !== observationSecond) {
    observedSun = subsolarPoint(new Date(state.date));
    observationSecond = second;
  }
  alignObservedEarth(objects.get("earth"), observedSun);
}

function updateCloudUi() {
  const earth = state.selected === "earth" && !state.system;
  $("cloud-panel").hidden = !earth;
  $("planet-info").classList.toggle("earth-cloud-view", earth);
  $("simulation-feature").hidden = earth && state.observedEarth;
  $("scene-mode-label").textContent = isEarthObservation() ? "卫星云层观测" : "动态模拟";
  updateTimeRateUi();
  observedClouds?.renderStatus();
}

function updateTimeRateUi() {
  const observed = isEarthObservation();
  const rate = observed ? 1 : state.speed;
  const slider = $("time-speed");
  slider.min = "0";
  slider.max = String(simulationRates.length - 1);
  slider.step = "1";
  slider.value = String(observed ? 0 : simulationRates.indexOf(rate));
  slider.disabled = observed;
  slider.title = observed ? "卫星观测使用当前时间" : `与地表同步 · ${simulationRateEquivalent(rate)}`;
  slider.setAttribute("aria-valuetext", `${rate} 倍真实时间，${simulationRateEquivalent(rate)}`);
  $("speed-value").textContent = formatSimulationRate(rate);
  $("speed-value").title = slider.title;
}

function changeCloudMode(enabled) {
  clearLandmark();
  state.observedEarth = enabled;
  if (isEarthObservation()) {
    const earth = objects.get("earth");
    const before = earth.root.position.clone();
    state.date = Date.now();
    updatePositions();
    syncObservedEarth();
    const delta = earth.root.position.clone().sub(before);
    camera.position.add(delta); controls.target.add(delta);
    flight = null;
  }
  updateCloudUi(); updateActivityUi(); updateSimulationDate();
}

function systemDescription() {
  return "大小、轨道间距与绕行速度为示意";
}

function compactSceneBounds() {
  if (width < 560 || height > 540) return null;
  const tools = $("observation-tools");
  return {
    left: 260,
    right: width - 76,
    top: state.selected && !tools.hidden ? 120 : 76,
    bottom: document.querySelector(".explorer-bottom").getBoundingClientRect().top - 44,
  };
}

function desiredOffset() {
  const compact = compactSceneBounds();
  if (compact) {
    return new THREE.Vector2(
      width / 2 - (compact.left + compact.right) / 2,
      height / 2 - (compact.top + compact.bottom) / 2,
    );
  }
  if (state.selected) {
    const top = mobile ? 128 : 156;
    const bottom = mobile
      ? $("planet-info").getBoundingClientRect().top - 14
      : height - 232;
    return new THREE.Vector2(
      mobile ? 0 : -width * 0.115,
      height / 2 - (top + bottom) / 2,
    );
  }
  return new THREE.Vector2(
    mobile ? 0 : -width * 0.055,
    mobile ? -height * 0.035 : height * (height < 800 ? 0.145 : 0.09),
  );
}

function applyViewOffset() {
  camera.setViewOffset(
    width,
    height,
    viewOffset.x,
    viewOffset.y,
    width,
    height,
  );
}

function overviewPosition() {
  const distance = mobile
    ? 205 / Math.max(camera.aspect, 0.45)
    : Math.max(192, 186 / camera.aspect);
  return new THREE.Vector3(0, 0.66, 1).normalize().multiplyScalar(distance * SYSTEM_RADIUS / 72);
}

function focusedOffset(body, close = false) {
  const compact = compactSceneBounds();
  const safeHeight = compact ? compact.bottom - compact.top : mobile
    ? Math.max(88, $("planet-info").getBoundingClientRect().top - 142)
    : height - 388;
  const safeWidth = compact ? compact.right - compact.left : mobile ? width - 80 : width - 460;
  const targetRadius = Math.max(
    40,
    Math.min(
      safeHeight * (mobile ? 0.39 : 0.45),
      safeWidth * (mobile ? 0.36 : 0.37),
    ),
  );
  const focalLength =
    height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  let distance = body.radius * Math.sqrt(1 + (focalLength / targetRadius) ** 2);
  if (body.id === "saturn" && !close) distance *= 1.6;
  if (body.id === "sun" && !close) distance *= 1.2;
  if (body.id === "enceladus" && !close) distance *= 1.25;
  if (close) distance *= mobile ? 0.64 : 0.62;
  let direction =
    body.id === "saturn"
      ? new THREE.Vector3(0.35, 0.45, 1)
      : new THREE.Vector3(0.2, 0.11, 1);
  if (body.viewUv) {
    const phi = body.viewUv[0] * Math.PI * 2;
    const theta = (1 - body.viewUv[1]) * Math.PI;
    body.mesh.updateWorldMatrix(true, false);
    direction
      .set(
        -Math.cos(phi) * Math.sin(theta),
        Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
      )
      .transformDirection(body.mesh.matrixWorld);
  }
  const sunlight = objects.get("sun").root.position.clone().sub(body.root.position).normalize();
  if (body.id !== "sun" && (!body.viewUv || direction.dot(sunlight) < .2 || body.id === "saturn")) {
    direction = sunlight.clone()
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        body.id === "earth" ? 0.95 : 0.72,
      );
    if (body.id === "saturn") {
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(
        body.tilted.getWorldQuaternion(new THREE.Quaternion()),
      );
      const side = Math.sign(normal.dot(sunlight)) || 1;
      direction
        .projectOnPlane(normal)
        .normalize()
        .addScaledVector(normal, side * 0.55);
    } else direction.y += 0.1;
  }
  return direction.normalize().multiplyScalar(distance);
}

function currentFocusOffset(body) {
  if (state.system) {
    const radius = Math.max(
      ...[...objects.values()]
        .filter((item) => item.parent === body.id)
        .map((item) => item.orbit + item.radius),
    );
    const distance = focusedOffset({ ...body, id: "system", radius }).length();
    return new THREE.Vector3(0.15, 0.85, 1)
      .normalize()
      .multiplyScalar(distance);
  }
  const offset = focusedOffset(body, state.close);
  if (landmarkView?.active)
    return landmarkDirection(landmarkView.active, body).multiplyScalar(
      offset.length(),
    );
  if (state.nightView && body.id === "earth")
    return body.root.position
      .clone()
      .normalize()
      .multiplyScalar(offset.length());
  return offset;
}

function flyTo(target, offset, duration = 1700, kind = "travel") {
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  // Flush residual drag inertia so it cannot pull the camera off its flight path.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  camera.position.copy(startPosition);
  controls.target.copy(startTarget);
  controls.minDistance = 0.025;
  controls.maxDistance = 800 * ORBIT_SPACING;
  flight = {
    elapsed: 0,
    duration: reducedMotion ? 0 : duration,
    kind,
    startTarget,
    endTarget: target.clone(),
    endOffset: offset.clone(),
    startOffset: viewOffset.clone(),
    endViewOffset: desiredOffset(),
    position: cameraPath(startPosition, target.clone(), offset, [
      ...objects.values(),
    ]),
  };
}

function applyDistanceLimits() {
  const body = objects.get(state.selected);
  controls.minDistance = body ? (body.renderRadius || body.radius) * 1.09 : 20;
  controls.maxDistance = 600 * ORBIT_SPACING;
}

function setSceneVisibility() {
  const focused = objects.get(state.selected);
  const context = focused
    ? THREE.MathUtils.smoothstep(
        camera.position.distanceTo(controls.target) / focused.radius,
        14,
        38,
      )
    : 1;
  for (const body of objects.values()) {
    body.root.visible = true;
    if (body.orbitLine)
      body.orbitLine.visible =
        state.orbits &&
        (state.selected
          ? (state.system && body.parent === state.selected) ||
            (!body.parent && context > 0.001)
          : !body.parent);
    if (body.orbitLine)
      body.orbitLine.material.opacity = body.parent ? 0.22 : 0.17 * context;
  }
  // The asteroid belt is part of the scene, not an orbit guide.
  belt.visible = context > 0.001;
  belt.material.opacity = 0.46 * context;
}

function arrivalOffset(body) {
  const distance = focusedOffset(body).length();
  const bearing = camera.position.clone().sub(body.root.position).normalize();
  const preferred = focusedOffset(body).normalize();
  const candidates = [bearing, preferred];
  const outward = body.root.position.clone().sub(objects.get("sun").root.position).normalize();
  if (outward.lengthSq() === 0) outward.copy(bearing);
  const sunward = outward.clone().negate();
  candidates.push(sunward);
  for (const base of [bearing, outward, sunward]) {
    for (const angle of [-1.1, -0.55, 0, 0.55, 1.1]) {
      for (const elevation of [-0.25, 0.05, 0.18, 0.4]) {
        const direction = base
          .clone()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        direction.y = elevation;
        candidates.push(direction.normalize());
      }
    }
  }
  for (const other of objects.values()) {
    if (other.parent !== body.id && other.id !== body.parent) continue;
    const away = body.root.position
      .clone()
      .sub(other.root.position)
      .normalize();
    for (const angle of [-0.85, -0.5, 0.5, 0.85])
      candidates.push(
        away.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle),
      );
  }
  // Pick a nearby approach bearing with useful background context at the real positions.
  const preview = camera.clone();
  const shift = desiredOffset();
  preview.setViewOffset(width, height, shift.x, shift.y, width, height);
  const reserved = [
    $("planet-info"),
    $("observation-tools"),
    document.querySelector(".scene-toolbar"),
  ]
    .filter((element) => !element.hidden)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    });
  const all = [...objects.values()];
  let best = preferred,
    bestScore = -Infinity;
  for (const direction of candidates) {
    // Start from the lit side; users can then freely orbit into the night side.
    if (body.id !== "sun" && direction.dot(outward) > -0.1)
      continue;
    preview.position
      .copy(body.root.position)
      .addScaledVector(direction, distance);
    preview.lookAt(body.root.position);
    preview.updateMatrixWorld();
    if (occludedByBody(body.root.position, preview.position, all, body.id))
      continue;
    let score = direction.dot(bearing) * 0.65;
    let contextScore = 0;
    if (body.id !== "sun")
      score -= direction.dot(outward) * 1.5;
    if (body.id === "saturn") score += direction.dot(preferred) * 5;
    const projected = all.map((other) => projectBody(other, preview));
    const subject = projected.find((item) => item.body.id === body.id);
    for (const item of projected) {
      if (
        item.body.id !== body.id &&
        item.body.id !== body.parent &&
        item.onScreen &&
        !item.occluded
      )
        score -= Math.min(
          20,
          Math.max(0, item.radius / subject.radius - 0.8) * 7,
        );
    }
    const disks = projected.filter((item) => item.onScreen && !item.occluded);
    const occupied = [...reserved];
    for (const item of disks) {
      const other = item.body;
      if (other.id === body.id || !item.inView) continue;
      if (
        preview.position.distanceTo(other.root.position) <
        other.radius * 1.2
      ) {
        score -= 100;
        continue;
      }
      const slot = labelPosition(item, disks, occupied);
      if (!slot) continue;
      occupied.push({ x: slot[0], y: slot[1], w: mobile ? 55 : 63, h: 28 });
      const family =
        other.parent === body.id ||
        other.id === body.parent ||
        (body.parent && other.parent === body.parent);
      contextScore += family ? 3 : other.parent ? 0.2 : 1;
    }
    score += Math.min(contextScore, 5);
    if (score > bestScore) {
      bestScore = score;
      best = direction;
    }
  }
  return best.clone().multiplyScalar(distance);
}

function setAtlas(open) {
  state.atlas = open;
  $("atlas-panel").hidden = !open;
  $("atlas-tab").classList.toggle("active", open);
  $("atlas-tab").setAttribute("aria-pressed", String(open));
  $("overview-tab").classList.toggle("active", !open);
  $("overview-tab").setAttribute("aria-pressed", String(!open));
  controls.enabled = !open;
  updateObservationTools();
}

function updateResolution(body) {
  const map =
    body.id === "venus" && body.layerVisible
      ? body.lowMap
      : body.mesh.material.map;
  const pixels = map?.image?.width;
  $("resolution-status").textContent = pixels
    ? `${(pixels / 1024).toFixed(pixels % 1024 ? 1 : 0)}K ${body.id === "venus" && !body.layerVisible ? "雷达地表" : "星球纹理"}`
    : "纹理暂不可用";
}

async function loadHighTexture(body) {
  if (!body.high) return;
  if (highTextures.has(body.id)) {
    applyHighTexture(body);
    return;
  }
  if (highInFlight.has(body.id)) return highInFlight.get(body.id);
  if (state.selected === body.id)
    $("resolution-status").textContent = "高清纹理加载中";
  const promise = (async () => {
    try {
      const loaded = await new THREE.TextureLoader().loadAsync(
        `/solar-system/textures/${body.high}`,
      );
      highTextures.set(body.id, configureTexture(loaded));
      applyHighTexture(body);
      // Keep at most three large GPU maps resident; base maps remain available for every planet.
      while (highTextures.size > 3) {
        const oldest = [...highTextures.keys()].find(
          (id) => id !== state.selected && id !== body.id,
        );
        if (!oldest) break;
        const oldBody = objects.get(oldest);
        const oldMap = highTextures.get(oldest);
        oldBody.mesh.material.map =
          oldBody.id === "venus" && !oldBody.layerVisible
            ? oldBody.surfaceMap
            : oldBody.lowMap;
        if (oldBody.mesh.material.bumpMap)
          oldBody.mesh.material.bumpMap = oldBody.lowMap;
        oldBody.mesh.material.needsUpdate = true;
        highTextures.delete(oldest);
        oldMap.dispose();
      }
    } catch {
      if (state.selected === body.id)
        toast("高清纹理暂未加载，当前显示基础纹理。");
    } finally {
      highInFlight.delete(body.id);
      if (state.selected === body.id) updateResolution(body);
    }
  })();
  highInFlight.set(body.id, promise);
  return promise;
}

function applyHighTexture(body) {
  if (body.id !== "venus" || !body.layerVisible) {
    body.mesh.material.map = highTextures.get(body.id);
    if (body.mesh.material.bumpMap)
      body.mesh.material.bumpMap = body.mesh.material.map;
    body.mesh.material.needsUpdate = true;
  }
  if (state.selected === body.id) updateResolution(body);
}

function setLayer(visible) {
  const body = objects.get(state.selected);
  if (!body?.layer) return;
  body.layerVisible = visible;
  if (body.clouds) body.clouds.visible = visible;
  if (body.id === "venus") {
    body.mesh.material.map = visible
      ? body.lowMap
      : highTextures.get(body.id) || body.surfaceMap;
    body.mesh.material.needsUpdate = true;
    $("caption-title").textContent = visible ? "金星云层" : "金星地表";
    $("caption-detail").textContent = visible
      ? "硫酸云 / 浓密大气"
      : "雷达地形 / 着色示意";
  }
  $("layer-toggle").checked = visible;
  updateResolution(body);
  updateActivityUi();
}

function selectBody(id) {
  if (!state.ready) return;
  const body = objects.get(id);
  if (!body) return;
  clearLandmark();
  setAtlas(false);
  state.selected = id;
  state.close = false;
  state.system = false;
  $("app").classList.remove("system-view");
  if (isEarthObservation()) {
    state.date = Date.now();
    updatePositions();
    syncObservedEarth();
  }
  setCatalog(body.group || "planets");
  state.nightView = false;
  $("app").classList.add("focused");
  $("intro").hidden = true;
  $("planet-info").hidden = false;
  $("planet-info").scrollTop = 0;
  $("planet-info-content").scrollTop = 0;
  $("focus-caption").hidden = false;
  $("planet-category").textContent = body.category;
  $("planet-title").textContent = body.name;
  $("planet-english").textContent = body.english;
  $("planet-description").textContent = body.description;
  $("planet-facts").innerHTML = body.facts
    .map(
      ([name, value, unit]) =>
        `<div><dt>${name}</dt><dd>${value}<small>${unit}</small></dd></div>`,
    )
    .join("");
  $("feature-title").textContent = activityProfiles[id].title;
  $("feature-description").textContent = activityProfiles[id].text;
  $("caption-title").textContent = body.caption;
  $("caption-detail").textContent = body.detail;
  $("surface-button").querySelector("span").textContent = body.closeName;
  $("layer-control").hidden = !body.layer;
  $("layer-label").textContent = body.layer || "";
  $("layer-toggle").checked = body.layerVisible;
  $("view-status").textContent = `${body.name} / 近轨道观测`;
  $("selection-announcement").textContent =
    `已选中${body.name}，${body.feature}。`;
  document.querySelectorAll(".planet-choice").forEach((button) => {
    const selected = button.dataset.body === id;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const dockButton = document.querySelector(
    `.planet-choice[data-body="${id}"]`,
  );
  const dock = $("planet-dock");
  dock.scrollTo({
    left:
      dockButton.offsetLeft -
      dock.offsetLeft -
      (dock.clientWidth - dockButton.clientWidth) / 2,
    behavior: reducedMotion ? "instant" : "smooth",
  });
  controls.minDistance = body.radius * 1.09;
  controls.maxDistance = 600 * ORBIT_SPACING;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.maxPolarAngle = Math.PI - 0.05;
  dynamics.setFocus(id);
  landmarkView.setBody(id);
  updateFamilyPicker();
  updateObservationTools();
  updateActivityUi();
  setSceneVisibility();
  flyTo(body.root.position, arrivalOffset(body));
  setLayer(body.layerVisible);
  updateResolution(body);
  loadHighTexture(body);
}

function goOverview() {
  if (!state.ready) return;
  setAtlas(false);
  clearLandmark();
  state.selected = null;
  state.close = false;
  state.system = false;
  $("app").classList.remove("system-view");
  $("app").classList.remove("focused");
  $("intro").hidden = false;
  $("planet-info").hidden = true;
  $("focus-caption").hidden = true;
  landmarkView.setBody(null);
  dynamics.setFocus(null);
  updateFamilyPicker();
  updateObservationTools();
  $("view-status").textContent = "日心轨道视图";
  $("resolution-status").textContent = "距离与大小为示意比例";
  document.querySelectorAll(".planet-choice").forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
  controls.minDistance = 20;
  controls.maxDistance = 600 * ORBIT_SPACING;
  controls.rotateSpeed = 0.45;
  controls.maxPolarAngle = Math.PI * 0.83;
  setSceneVisibility();
  flyTo(new THREE.Vector3(), overviewPosition(), 1500);
}

function toggleClose() {
  const body = objects.get(state.selected);
  if (!body) return;
  if (state.system) {
    selectBody(body.id);
    return;
  }
  clearLandmark();
  state.close = !state.close;
  $("focus-caption").hidden = state.close;
  if (state.close && body.id === "venus") setLayer(false);
  $("surface-button").querySelector("span").textContent = state.close
    ? "返回星球全貌"
    : body.closeName;
  $("view-status").textContent =
    `${body.name} / ${state.close ? "细节观测" : "近轨道观测"}`;
  const bearing = camera.position.clone().sub(body.root.position).normalize();
  flyTo(
    body.root.position,
    bearing.multiplyScalar(focusedOffset(body, state.close).length()),
    950,
    "zoom",
  );
  loadHighTexture(body);
}

function zoom(factor) {
  if (!state.ready || state.atlas) return;
  applyDistanceLimits();
  const target = objects.get(state.selected)?.root.position || controls.target;
  const offset = camera.position.clone().sub(target);
  const distance =
    flight?.kind === "zoom" ? flight.endOffset.length() : offset.length();
  const nextDistance = THREE.MathUtils.clamp(
    distance * factor,
    controls.minDistance,
    controls.maxDistance,
  );
  flyTo(target, offset.setLength(nextDistance), 380, "zoom");
}

function updatePlayButton() {
  const label = state.playing ? "暂停运动" : "继续运动";
  $("play-toggle").innerHTML =
    `<i data-lucide="${state.playing ? "pause" : "play"}"></i>`;
  $("play-toggle").setAttribute("aria-label", label);
  $("play-toggle").setAttribute("data-tip", label);
  $("play-toggle").setAttribute("aria-pressed", String(!state.playing));
  refreshIcons();
  updateActivityUi();
}

function updateActivityUi() {
  if (!dynamics || !state.selected) return;
  const profile = activityProfiles[state.selected];
  const status = dynamics.status();
  const label = !state.playing
    ? "已暂停"
    : state.system
      ? "卫星绕行"
    : status?.label || profile.idle;
  if ($("activity-state").textContent !== label) $("activity-state").textContent = label;
  $("activity-state").classList.toggle(
    "event-active",
    Boolean(status?.event && state.playing && state.dynamics),
  );
  if ($("event-label").textContent !== profile.trigger) $("event-label").textContent = profile.trigger;
  $("event-trigger").disabled =
    !state.playing || !state.dynamics || state.system || Boolean(status?.event);
  $("rotation-toggle").classList.toggle("active", state.lockSpin);
  $("rotation-toggle").setAttribute("aria-pressed", String(state.lockSpin));
}

function triggerActivity() {
  if (isEarthObservation()) return;
  if (!state.selected || !state.playing || !state.dynamics || state.system)
    return;
  const body = objects.get(state.selected);
  clearLandmark();
  state.nightView = false;
  updateObservationTools();
  if (body.layer && !body.layerVisible) setLayer(true);
  if (["sun", "saturn"].includes(body.id)) {
    if (state.close) toggleClose();
    else flyTo(body.root.position, focusedOffset(body), 850);
  } else {
    const direction = dynamics.eventViewDirection(body.id);
    if (direction) {
      const distance = Math.min(
        camera.position.distanceTo(controls.target),
        focusedOffset(body).length(),
      );
      flyTo(body.root.position, direction.multiplyScalar(distance), 850);
    }
  }
  dynamics.trigger();
  updateActivityUi();
}

function updateObservationTools() {
  updateCloudUi();
  const id = state.selected;
  $("landing-button").hidden = state.system || !["moon", "europa"].includes(id);
  const family = familyOf(objects.get(id));
  const visible =
    id &&
    !state.atlas &&
    (family || landmarks[id]?.length || ["earth", "saturn"].includes(id));
  $("observation-tools").hidden = !visible;
  document.querySelector(".landmark-picker").hidden =
    state.system || !landmarks[id]?.length;
  $("night-view").hidden = state.system || id !== "earth";
  $("night-control").hidden = state.system || id !== "earth";
  $("shadow-control").hidden =
    state.system || !["earth", "saturn"].includes(id);
  $("night-toggle").disabled = !objects.get("earth")?.nightMap;
  $("night-toggle").checked = state.nightLights;
  $("shadow-toggle").checked = state.shadows;
  $("shadow-control").title = id === "saturn" ? "环系投影" : "云层投影";
  $("shadow-toggle").setAttribute("aria-label", $("shadow-control").title);
  const label = state.nightView ? "观测昼侧" : "观测夜侧";
  $("night-view").setAttribute("aria-label", label);
  $("night-view").dataset.tip = label;
  $("night-view").classList.toggle("active", state.nightView);
  $("landmark-clear").hidden = !landmarkView?.active;
}

function clearLandmark() {
  if (!landmarkView?.active) return;
  landmarkView.select("");
  if (landmarkSpin !== null) state.lockSpin = landmarkSpin;
  landmarkSpin = null;
  $("app").classList.remove("has-landmark");
  const body = objects.get(state.selected);
  if (body) {
    $("planet-description").textContent = body.description;
    $("caption-title").textContent = body.caption;
    $("caption-detail").textContent = body.detail;
  }
  updateObservationTools();
  updateActivityUi();
}

function selectLandmark(id) {
  const body = objects.get(state.selected);
  if (!body) return;
  if (!id) {
    clearLandmark();
    selectBody(body.id);
    return;
  }
  const feature = landmarkView.select(id);
  if (!feature) return;
  if (landmarkSpin === null) landmarkSpin = state.lockSpin;
  state.lockSpin = true;
  state.close = true;
  state.nightView = false;
  $("app").classList.add("has-landmark");
  $("planet-description").textContent = `${feature.location} · ${feature.text}`;
  const source = document.createElement("a");
  source.href = feature.source;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.className = "landmark-source";
  source.textContent = "资料来源";
  $("planet-description").append(source);
  $("caption-title").textContent = feature.name;
  $("caption-detail").textContent = feature.location;
  $("focus-caption").hidden = false;
  $("surface-button").querySelector("span").textContent = "返回星球全貌";
  $("view-status").textContent = `${body.name} / ${feature.name}`;
  $("selection-announcement").textContent =
    `正在观测${feature.name}。${feature.text}`;
  updateActivityUi();
  updateObservationTools();
  flyTo(body.root.position, currentFocusOffset(body), 1100);
  loadHighTexture(body);
}

async function landOnSurface() {
  if (!state.ready || landingBusy || surfaceView || !["moon", "europa"].includes(state.selected)) return;
  const id = state.selected;
  const body = objects.get(id);
  const previousControls = controls.enabled;
  const pose = { position: camera.position.clone(), target: controls.target.clone(),
    quaternion: camera.quaternion.clone(), offset: viewOffset.clone(), width, height };
  const center = body.root.position.clone();
  surfaceOrbitPose = {offsetFromBody:pose.position.clone().sub(center)};
  const bearing = pose.position.clone().sub(center).normalize();
  const destination = center.clone().addScaledVector(bearing, (body.renderRadius || body.radius) * 1.14);
  const descentPath = cameraPath(pose.position, center, destination.clone().sub(center), [...objects.values()]);
  const recover = () => {
    surfaceOrbitPose = null;
    camera.position.copy(pose.position);camera.quaternion.copy(pose.quaternion);
    controls.target.copy(pose.target);
    viewOffset.copy(width===pose.width&&height===pose.height?pose.offset:desiredOffset());
    applyViewOffset();
    $("app").classList.remove("surface-journey-background");$("app").inert=false;
    controls.enabled=previousControls;
  };
  landingBusy = true;
  controls.enabled = false;
  $("app").inert = true;
  $("landing-button").disabled = true;
  try {
    const { createSurfaceView } = await import("./surface/SurfaceView.js");
    if (disposed) return;
    $("app").classList.add("surface-journey-background");
    surfaceView = createSurfaceView(id, {
      initialDate: state.date,
      initialRate: state.speed,
      onRateChange: rate => {
        state.speed = rate;
        updateTimeRateUi();
      },
      onTimeChange: time => {
        state.date = time;
        updateSimulationDate();
      },
      renderOrbit: progress => {
        descentPath(progress,camera.position);
        controls.target.lerpVectors(pose.target,center,progress);
        viewOffset.copy(pose.offset).multiplyScalar(1-progress);
        applyViewOffset();camera.lookAt(controls.target);
        renderer.render(scene,camera);
      },
      onClosed: finalTime => {
        if (Number.isFinite(finalTime)) state.date = finalTime;
        surfaceView = null;recover();
        const previous = body.root.position.clone();
        updatePositions();
        const delta = body.root.position.clone().sub(previous);
        camera.position.add(delta);controls.target.add(delta);
        updateSimulationDate();
        $("landing-button").focus();
      },
    });
  } catch {
    recover();
    toast("着陆场景未能加载，请稍后重试。");
  } finally {
    landingBusy = false;
    $("landing-button").disabled = false;
  }
}

function bindEvents() {
  $("catalog-filter").addEventListener("change", (event) =>
    setCatalog(event.target.value),
  );
  $("atlas-filter").addEventListener("change", filterAtlas);
  $("atlas-search").addEventListener("input", filterAtlas);
  $("family-select").addEventListener("change", (event) => {
    const value = event.target.value;
    if (value.startsWith("system:")) selectSystem(value.slice(7));
    else if (value) selectBody(value);
  });
  $("overview-tab").addEventListener("click", goOverview);
  $("back-button").addEventListener("click", goOverview);
  $("atlas-tab").addEventListener("click", () => {
    if (state.ready) setAtlas(!state.atlas);
  });
  $("explore-earth").addEventListener("click", () => selectBody("earth"));
  $("surface-button").addEventListener("click", toggleClose);
  $("landing-button").addEventListener("click", landOnSurface);
  $("event-trigger").addEventListener("click", triggerActivity);
  $("activity-toggle").addEventListener("click", () => {
    state.dynamics = !state.dynamics;
    dynamics.setEnabled(state.dynamics);
    $("activity-toggle").classList.toggle("active", state.dynamics);
    $("activity-toggle").setAttribute("aria-pressed", String(state.dynamics));
    updateActivityUi();
  });
  $("rotation-toggle").addEventListener("click", () => {
    state.lockSpin = !state.lockSpin;
    if (landmarkView.active) landmarkSpin = state.lockSpin;
    updateActivityUi();
  });
  $("activity-rate").addEventListener("change", (event) => {
    state.activityRate = Number(event.target.value);
    dynamics.setRate(state.activityRate);
  });
  $("layer-toggle").addEventListener("change", (event) =>
    setLayer(event.target.checked),
  );
  $("landmark-clear").addEventListener("click", () => selectLandmark(""));
  $("night-toggle").addEventListener("change", (event) => {
    state.nightLights = event.target.checked;
  });
  $("shadow-toggle").addEventListener("change", (event) => {
    state.shadows = event.target.checked;
  });
  $("night-view").addEventListener("click", () => {
    const body = objects.get(state.selected);
    if (body?.id !== "earth") return;
    clearLandmark();
    state.nightView = !state.nightView;
    state.close = false;
    $("surface-button").querySelector("span").textContent = body.closeName;
    $("focus-caption").hidden = false;
    $("caption-title").textContent = state.nightView
      ? "地球夜侧"
      : body.caption;
    $("caption-detail").textContent = state.nightView
      ? "NASA Black Marble / 2016"
      : body.detail;
    updateObservationTools();
    flyTo(body.root.position, currentFocusOffset(body), 1000);
  });
  $("zoom-in").addEventListener("click", () => zoom(0.8));
  $("zoom-out").addEventListener("click", () => zoom(1.25));
  $("reset-camera").addEventListener("click", () =>
    state.system
      ? selectSystem(state.selected)
      : state.selected
        ? selectBody(state.selected)
        : goOverview(),
  );
  $("play-toggle").addEventListener("click", () => {
    state.playing = !state.playing;
    updatePlayButton();
    observedClouds?.renderStatus();
  });
  $("time-speed").addEventListener("input", (event) => {
    state.speed = simulationRates[Number(event.target.value)];
    updateTimeRateUi();
  });
  $("orbit-toggle").addEventListener("click", () => {
    state.orbits = !state.orbits;
    $("orbit-toggle").classList.toggle("active", state.orbits);
    $("orbit-toggle").setAttribute("aria-pressed", String(state.orbits));
    setSceneVisibility();
  });
  $("label-toggle").addEventListener("click", () => {
    state.labels = !state.labels;
    $("label-toggle").classList.toggle("active", state.labels);
    $("label-toggle").setAttribute("aria-pressed", String(state.labels));
  });
  $("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("app").requestFullscreen();
    } catch {
      toast("当前浏览器未允许全屏显示。");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    $("fullscreen").innerHTML =
      `<i data-lucide="${active ? "minimize" : "maximize"}"></i>`;
    $("fullscreen").setAttribute("aria-label", active ? "退出全屏" : "全屏");
    $("fullscreen").dataset.tip = active ? "退出全屏" : "全屏";
    refreshIcons();
  });
  $("info-button").addEventListener("click", () =>
    $("credits-dialog").showModal(),
  );
  $("close-credits").addEventListener("click", () =>
    $("credits-dialog").close(),
  );
  $("credits-dialog").addEventListener("click", (event) => {
    if (event.target === $("credits-dialog")) {
      const rect = event.target.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        event.target.close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (surfaceView || landingBusy) return;
    if (
      $("credits-dialog").open ||
      /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)
    )
      return;
    if (event.key === "Escape") {
      if (state.atlas) setAtlas(false);
      else if (state.selected) goOverview();
    }
    if (event.code === "Space" && event.target === document.body) {
      event.preventDefault();
      state.playing = !state.playing;
      updatePlayButton();
    }
    if (event.key === "+" || event.key === "=") zoom(0.8);
    if (event.key === "-") zoom(1.25);
  });
  window.addEventListener("resize", resize);
  updatePlayButton();
}

function resize() {
  if (!renderer) return;
  width = innerWidth;
  height = innerHeight;
  mobile = width <= 760;
  camera.aspect = width / height;
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.75 : 2));
  if (surfaceView || landingBusy) { camera.updateProjectionMatrix(); return; }
  viewOffset.copy(desiredOffset());
  applyViewOffset();
  if (state.ready) {
    const body = objects.get(state.selected);
    const bearing = camera.position.clone().sub(controls.target).normalize();
    flyTo(
      body ? body.root.position : new THREE.Vector3(),
      body
        ? bearing.multiplyScalar(currentFocusOffset(body).length())
        : overviewPosition(),
      450,
    );
  }
}

function projectBody(body, view = camera) {
  const projected = body.root.position.clone().project(view);
  const depth = -body.root.position
    .clone()
    .applyMatrix4(view.matrixWorldInverse).z;
  const radius =
    ((body.renderRadius || body.radius) * height) /
    (2 *
      Math.tan(THREE.MathUtils.degToRad(view.fov / 2)) *
      Math.max(depth, 1e-12));
  const x = ((projected.x + 1) * width) / 2;
  const y = ((1 - projected.y) * height) / 2;
  return {
    body,
    x,
    y,
    radius,
    onScreen:
      depth > body.radius &&
      x + radius > 0 &&
      x - radius < width &&
      y + radius > 0 &&
      y - radius < height,
    inView:
      depth > 0 &&
      projected.z >= -1 &&
      projected.z <= 1 &&
      Math.abs(projected.x) < 1 &&
      Math.abs(projected.y) < 1,
    occluded: occludedByBody(
      body.root.position,
      view.position,
      objects.values(),
      body.id,
    ),
  };
}

function bodyAt(clientX, clientY) {
  pointer.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const clickable = [...objects.values()]
    .filter((body) => body.root.visible)
    .flatMap((body) => (body.ring ? [body.mesh, body.ring] : [body.mesh]));
  const hit = raycaster.intersectObjects(clickable, false)[0]?.object.userData
    .bodyId;
  if (hit) return hit;
  // Distant moons remain selectable even when their visible disk is subpixel-sized.
  const nearby = [...objects.values()]
    .map((body) => projectBody(body))
    .filter((item) => item.inView && !item.occluded && item.radius < 12)
    .map((item) => ({
      ...item,
      separation: Math.hypot(clientX - item.x, clientY - item.y),
    }))
    .filter((item) => item.separation <= (mobile ? 13 : 10))
    .sort((a, b) => a.separation - b.separation);
  return nearby[0]?.body.id;
}

function bindCanvas() {
  let down = null;
  let moved = false;
  let touching = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (event) => {
    touching++;
    if (touching === 1) {
      down = { x: event.clientX, y: event.clientY, time: performance.now() };
      moved = false;
    } else moved = true;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5)
      moved = true;
    if (!down && event.pointerType === "mouse")
      canvas.style.cursor = bodyAt(event.clientX, event.clientY)
        ? "pointer"
        : "grab";
  });
  canvas.addEventListener("pointerup", (event) => {
    touching = Math.max(0, touching - 1);
    if (down && !moved && performance.now() - down.time < 550) {
      const id = bodyAt(event.clientX, event.clientY);
      if (id) {
        if (state.selected === id) toggleClose();
        else selectBody(id);
      }
    }
    if (touching === 0) down = null;
  });
  canvas.addEventListener("pointercancel", () => {
    down = null;
    touching = 0;
    moved = false;
  });
  controls.addEventListener("start", () => {
    flight = null;
    applyDistanceLimits();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!controls.enabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const pixels =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      zoom(Math.exp(THREE.MathUtils.clamp(pixels * 0.0015, -0.7, 0.7)));
    },
    { capture: true, passive: false },
  );
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    fatal("图形连接已中断，请重新加载页面。");
  });
}

function labelPosition({ x, y, radius }, disks, reserved) {
  const w = mobile ? 55 : 63,
    h = 28;
  const candidates = [
    [x - w / 2, y + radius + 4],
    [x - w / 2, y - radius - h - 4],
    [x + radius + 4, y - h / 2],
    [x - radius - w - 4, y - h / 2],
  ];
  for (const dx of [-Math.SQRT1_2, Math.SQRT1_2]) {
    for (const dy of [-Math.SQRT1_2, Math.SQRT1_2])
      candidates.push([
        x + dx * (radius + 5) - (dx < 0 ? w : 0),
        y + dy * (radius + 5) - (dy < 0 ? h : 0),
      ]);
  }
  return candidates.find(
    ([left, top]) =>
      left >= 8 &&
      left + w <= width - 8 &&
      top >= 80 &&
      top + h < height - (mobile ? 190 : 211) &&
      !reserved.some(
        (rect) =>
          left < rect.x + rect.w &&
          left + w > rect.x &&
          top < rect.y + rect.h &&
          top + h > rect.y,
      ) &&
      !disks.some((disk) => {
        const nearX = THREE.MathUtils.clamp(disk.x, left, left + w);
        const nearY = THREE.MathUtils.clamp(disk.y, top, top + h);
        return Math.hypot(nearX - disk.x, nearY - disk.y) < disk.radius + 2;
      }),
  );
}

function updateLabels() {
  const projections = [...objects.values()].map((body) => projectBody(body));
  const bodyBounds = projections.filter(
    (item) => item.onScreen && !item.occluded,
  );
  const caption = $("focus-caption");
  const captionRect = caption.getBoundingClientRect();
  const captionOccluded =
    !caption.hidden &&
    bodyBounds.some(
      (item) =>
        item.body.id !== state.selected &&
        Math.hypot(
          THREE.MathUtils.clamp(item.x, captionRect.left, captionRect.right) -
            item.x,
          THREE.MathUtils.clamp(item.y, captionRect.top, captionRect.bottom) -
            item.y,
        ) <
          item.radius + 6,
    );
  caption.style.visibility = captionOccluded ? "hidden" : "";
  if (state.atlas || !state.labels) {
    for (const body of objects.values()) body.label.hidden = true;
    return;
  }
  const occupied = [];
  // Read fixed UI bounds once, before changing any of the moving labels.
  const reserved = [
    $(state.selected ? "planet-info" : "intro"),
    $("observation-tools"),
    document.querySelector(".scene-toolbar"),
  ].filter((element) => element.checkVisibility()).map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  });
  if (!caption.hidden && !captionOccluded)
    reserved.push({ x: captionRect.left, y: captionRect.top, w: captionRect.width, h: captionRect.height });
  const canvasEnd = height - (mobile ? 190 : 211);
  const priority = (body) =>
    body.id === state.selected
      ? 3
      : body.id === objects.get(state.selected)?.parent ||
          body.parent === state.selected
        ? 2
        : !body.parent
          ? 1
          : 0;
  projections.sort((a, b) => priority(b.body) - priority(a.body));
  for (const item of projections) {
    const { body, x, y } = item;
    if (
      !item.inView ||
      item.occluded ||
      (body.id === state.selected && !state.system)
    ) {
      body.label.hidden = true;
      continue;
    }
    const labelWidth = mobile ? 55 : 63;
    const labelHeight = 28;
    if (x < 0 || x > width || y < 75 || y > canvasEnd) {
      body.label.hidden = true;
      continue;
    }
    const position = labelPosition(item, bodyBounds, [...reserved, ...occupied]);
    if (!position) {
      body.label.hidden = true;
      continue;
    }
    const [labelX, labelY] = position;
    body.label.hidden = false;
    body.label.style.transform = `translate(${labelX.toFixed(1)}px,${labelY.toFixed(1)}px)`;
    occupied.push({ x: labelX, y: labelY, w: labelWidth, h: labelHeight });
  }
}

function brightSkyOccupancy() {
  let occupancy = 0;
  const sun = objects.get("sun").root.position;
  for (const body of objects.values()) {
    if (!body.root.visible || body.parent) continue;
    const view = body.root.position.clone().applyMatrix4(camera.matrixWorldInverse);
    if (view.z >= -body.radius) continue;
    const radius = body.radius * height / (-2 * view.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    if (radius < 5) continue;
    const center = body.root.position.clone().project(camera);
    const x = (center.x + 1) * width / 2, y = (1 - center.y) * height / 2;
    const visibleWidth = Math.max(0, Math.min(width, x + radius) - Math.max(0, x - radius));
    const visibleHeight = Math.max(0, Math.min(height, y + radius) - Math.max(0, y - radius));
    const phase = body.id === "sun" ? 1 : 0.5 + 0.5 * sun.clone().sub(body.root.position).normalize()
      .dot(camera.position.clone().sub(body.root.position).normalize());
    occupancy += visibleWidth * visibleHeight * Math.PI / 4 / (width * height) * phase;
  }
  return Math.min(1, occupancy);
}

function animate(now) {
  if (contextLost) return;
  requestAnimationFrame(animate);
  const elapsed = Math.max(0, now - (lastFrame || now));
  const dt = Math.min(elapsed / 1000, 0.05);
  lastFrame = now;
  if (document.hidden || surfaceView || landingBusy) return;
  const focused = objects.get(state.selected);
  const previous = focused?.root.position.clone();
  if (state.playing && !state.atlas && !$("credits-dialog").open) {
    if (isEarthObservation()) state.date = Date.now();
    else if (elapsed <= 1000) state.date += simulationElapsed(elapsed, state.speed);
    // The asteroid belt is also keyed to the shared simulation date.
    belt.rotation.y = ((state.date - Date.UTC(2000, 0, 1, 12)) / 86400000) * 0.001333;
    updatePositions();
    if (isEarthObservation()) syncObservedEarth();
  }
  observedClouds?.update(dt);
  if (focused && !flight) {
    const delta = focused.root.position.clone().sub(previous);
    camera.position.add(delta);
    controls.target.add(delta);
  }
  if (flight) {
    if (!state.atlas && !$("credits-dialog").open) flight.elapsed += dt * 1000;
    const t =
      flight.duration === 0 ? 1 : Math.min(flight.elapsed / flight.duration, 1);
    const eased = smoothProgress(t);
    const target = focused ? focused.root.position : flight.endTarget;
    flight.position(eased, camera.position);
    camera.position.addScaledVector(
      target.clone().sub(flight.endTarget),
      eased,
    );
    controls.target.lerpVectors(
      flight.startTarget,
      target,
      smoothProgress(Math.min(t * 1.5, 1)),
    );
    viewOffset.lerpVectors(flight.startOffset, flight.endViewOffset, eased);
    applyViewOffset();
    camera.lookAt(controls.target);
    if (t === 1) {
      flight = null;
      applyDistanceLimits();
    }
  }
  if (!flight) controls.update(dt);
  for (const body of objects.values()) {
    const away = camera.position.clone().sub(body.root.position);
    const clearance = (body.renderRadius || body.radius) * 1.08;
    if (away.lengthSq() < clearance * clearance) {
      if (away.lengthSq() === 0) away.set(0, 1, 0);
      camera.position.copy(body.root.position).add(away.setLength(clearance));
      camera.lookAt(controls.target);
    }
  }
  setSceneVisibility();
  dynamics.update({
    dt,
    moving: state.playing && !state.atlas && !$("credits-dialog").open,
    selected: state.system ? null : state.selected,
    isMobile: mobile,
    pixelScale: height * renderer.getPixelRatio(),
  });
  objects.get("sun").root.getWorldPosition(sunLight.position);
  dynamics.updateLighting(state);
  camera.updateMatrixWorld();
  starfield.update({ camera, date: state.date, dt, brightOccupancy: brightSkyOccupancy() });
  renderer.render(scene, camera);
  updateLabels();
  const reserved = [
    $("planet-info"),
    $("observation-tools"),
    document.querySelector(".scene-toolbar"),
    document.querySelector(".explorer-bottom"),
  ]
    .filter((element) => !element.hidden)
    .map((element) => element.getBoundingClientRect());
  landmarkView.update({
    width,
    height,
    hidden:
      !state.selected ||
      state.system ||
      state.atlas ||
      $("credits-dialog").open,
    reserved,
  });
  if (now - lastActivityUi > 160) {
    updateActivityUi();
    updateSimulationDate();
    lastActivityUi = now;
  }
}

async function init() {
  mountNavigation("solar-system");
  makeNavigation();
  $("reload-button").addEventListener("click", () => location.reload());
  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#07090b");
    camera = new THREE.PerspectiveCamera(42, width / height, 0.025, 2400);
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.75 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    $("universe").append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.rotateSpeed = 0.45;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 20;
    controls.maxDistance = 600 * ORBIT_SPACING;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI * 0.83;
    camera.position.copy(overviewPosition());
    viewOffset.copy(desiredOffset());
    applyViewOffset();
    controls.update();
    ambientLight = new THREE.AmbientLight("#d2e1df", 0.085);
    // Distances are illustrative; preserve exposure while deriving every body's
    // incident light direction from the Sun's actual scene position.
    sunLight = new THREE.PointLight("#fff6e8", 2.6, 0, 0);
    sunLight.name = "Sunlight";
    scene.add(ambientLight, sunLight);
    // Existing offline film hooks supply their own lighting rigs.
    sunLight.visible = !window.__promoOffline;
    keyLight = new THREE.DirectionalLight("#fff6e8", 2.6);
    fillLight = new THREE.DirectionalLight("#8eb6da", 0.48);
    keyLight.visible = fillLight.visible = Boolean(window.__promoOffline);
    scene.add(keyLight, keyLight.target, fillLight, fillLight.target);
    createStars();
    const textures = await loadBaseTextures();
    createBodies(textures);
    dynamics = createDynamics(objects);
    landmarkView = createLandmarks(objects, camera, selectLandmark);
    observedClouds = createObservedClouds({ dynamics, reducedMotion,
      initialEnabled: state.observedEarth, autoStart: !window.__promoOffline,
      isPaused: () => !state.playing || state.atlas || $("credits-dialog").open,
      onChange: changeCloudMode });
    updatePositions();
    updateSimulationDate();
    setSceneVisibility();
    bindEvents();
    bindCanvas();
    state.ready = true;
    state.date = epochDate.getTime();
    restoreObservation();
    updateTimeRateUi();
    document.documentElement.dataset.sceneReady = "true";
    rememberScene("solar-system", saveObservation);
    window.addEventListener("pagehide", disposeScene);
    window.addEventListener("pageshow", event => { if (event.persisted && disposed) location.reload(); });
    $("loading-screen").style.opacity = "0";
    setTimeout(
      () => {
        $("loading-screen").hidden = true;
      },
      reducedMotion ? 0 : 650,
    );
    if (failedTextures.size)
      toast(`${failedTextures.size} 张纹理未能加载，部分天体暂用基础色显示。`);
    requestAnimationFrame(animate);
    // Read-only diagnostics for verifying camera framing and rendered asset state.
    window.solarAtlas = {
      snapshot: () => ({
        ready: state.ready,
        selected: state.selected,
        close: state.close,
        system: state.system,
        catalog: state.catalog,
        scale: "display",
        playing: state.playing,
        speed: state.speed,
        date: state.date,
        earthObservation: isEarthObservation(),
        observedClouds: observedClouds.snapshot(),
        subsolarPoint: observedSun,
        orbits: state.orbits,
        labels: state.labels,
        starfield: starfield.snapshot(),
        atlas: state.atlas,
        lockSpin: state.lockSpin,
        nightLights: state.nightLights,
        nightView: state.nightView,
        shadows: state.shadows,
        landmarks: landmarkView.snapshot(),
        nightTextureWidth: objects.get("earth").nightMap?.image?.width || 0,
        lightDirection: state.selected
          ? sunLight.position.clone().sub(objects.get(state.selected).root.position).normalize().toArray()
          : [0, 0, 0],
        lighting: {
          type: sunLight.type,
          position: sunLight.position.toArray(),
          intensity: sunLight.intensity,
          ambient: ambientLight.intensity,
          cameraLightsVisible: keyLight.visible || fillLight.visible,
        },
        dynamics: dynamics.snapshot(),
        renderCalls: renderer.info.render.calls,
        programCount: renderer.info.programs.length,
        camera: camera.position.toArray(),
        fieldOfView: camera.fov,
        flight: flight
          ? {
              kind: flight.kind,
              progress: flight.duration ? flight.elapsed / flight.duration : 1,
            }
          : null,
        target: controls.target.toArray(),
        distance: camera.position.distanceTo(controls.target),
        minDistance: controls.minDistance,
        near: camera.near,
        far: camera.far,
        failedTextures: [...failedTextures],
        bodies: [...objects.values()].map((body) => {
          const projected = projectBody(body);
          return {
            id: body.id,
            meshId: body.mesh.uuid,
            radius: body.radius,
            radiusKm: physicalData[body.id].radiusKm,
            renderRadius: body.renderRadius || body.radius,
            parent: body.parent || null,
            position: body.root.position.toArray(),
            orbit: body.orbit,
            orbitVisible: body.orbitLine?.visible || false,
            visible: body.root.visible,
            x: projected.x,
            y: projected.y,
            radiusPx: projected.radius,
            inView: projected.inView,
            occluded: projected.occluded,
            labelVisible: !body.label.hidden,
            rotation: body.mesh.rotation.y,
            textureWidth: body.mesh.material.map?.image?.width || 0,
            cloudsVisible: body.clouds?.visible,
            cloudRotation: body.clouds?.rotation.y,
            layerVisible: body.layerVisible,
          };
        }),
      }),
    };
  } catch (error) {
    console.error(error);
    fatal(
      "浏览器无法初始化 3D 场景。请使用支持 WebGL 2 的浏览器，并启用硬件加速。",
    );
  }
}

init();
