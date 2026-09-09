import * as THREE from "three";
import { CLOUD_BLEND_SECONDS, cloudAge, validCloudFrame, cloudImageUrl } from "./cloud-policy.js";

const CACHE_NAME = "solar-atlas-clouds-v1";
const $ = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai",
});

async function storedFrame(value) {
  if (!("indexedDB" in window)) return null;
  return new Promise(resolve => {
    const request = indexedDB.open(CACHE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("frames");
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("frames", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("frames");
      const operation = value ? store.put(value, "latest") : store.get("latest");
      let result = null;
      operation.onsuccess = () => { result = operation.result; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = transaction.onabort = () => { db.close(); resolve(null); };
    };
  });
}

async function textureFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    if (texture.image.width !== 2048 || texture.image.height !== 1024) {
      texture.dispose(); throw new Error("云图尺寸不匹配");
    }
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    return texture;
  } finally { URL.revokeObjectURL(url); }
}

export function createObservedClouds({ dynamics, isPaused, reducedMotion, onChange, initialEnabled = true, autoStart = true }) {
  let enabled = initialEnabled, current = null, previous = null, pending = null;
  let mix = 1, busy = false, failed = false, server = null, lastPoll = 0, disposed = false;
  let started = false;
  const original = dynamics.earthCloudTexture();
  const publish = () => dynamics.setEarthClouds({ enabled,
    available: Boolean(current), previous: previous?.texture || current?.texture || original,
    next: current?.texture || original, mix });
  function renderStatus() {
    if (disposed) return;
    const frame = current?.frame;
    const { ageMs, stale } = cloudAge(frame);
    let label = !frame ? (failed ? "暂不可用" : "正在获取")
      : stale ? "数据已过期" : failed ? "使用缓存" : "近实时";
    if (!enabled) label = "动态模拟";
    if (enabled && frame && isPaused()) label = "画面已暂停";
    $("cloud-status").textContent = label;
    $("cloud-panel").dataset.status = !enabled ? "simulation" : stale || failed ? "stale" : "ready";
    $("cloud-observed-at").textContent = frame
      ? `${dateFormat.format(new Date(frame.observedAt))}（UTC+8）` : "等待卫星影像";
    if (frame) $("cloud-observed-at").dateTime = frame.observedAt;
    else $("cloud-observed-at").removeAttribute("datetime");
    const age = ageMs === null ? "" : ageMs < 3600000
      ? `${Math.floor(ageMs / 60000)} 分钟前` : `${(ageMs / 3600000).toFixed(1)} 小时前`;
    let detail = !enabled ? "演示云层与风暴，可调节活动速度。"
      : !frame ? (failed ? "数据暂未取得，当前不显示观测云层。" : "首次获取中，完成后自动显示。")
      : `红外云系估计 · ${age}${stale ? "，已超过 6 小时" : ""}。`;
    if (enabled && frame && failed) detail += navigator.onLine ? "更新暂不可达，保留最近一帧。" : "已离线，保留最近一帧。";
    else if (enabled && pending) detail += "新云图已就绪，继续播放后更新。";
    else if (enabled && frame && server?.error) detail += "卫星源暂不可达，保留最近一帧。";
    $("cloud-detail").textContent = detail;
    $("cloud-refresh").hidden = !enabled;
    $("cloud-refresh").disabled = busy || Boolean(server?.refreshing);
    $("cloud-refresh").textContent = busy || server?.refreshing ? "更新中" : "检查更新";
    $("cloud-mode").value = enabled ? "observed" : "simulation";
  }
  async function accept(frame, blob) {
    if (!validCloudFrame(frame) || !(blob instanceof Blob) || !blob.size) return;
    const newest = pending?.frame || current?.frame;
    if (newest && Date.parse(frame.observedAt) <= Date.parse(newest.observedAt)) return;
    if (current && (isPaused() || mix < 1)) { pending = { frame, blob }; renderStatus(); return; }
    const texture = await textureFromBlob(blob);
    if (disposed) { texture.dispose(); return; }
    if (current && Date.parse(frame.observedAt) <= Date.parse(current.frame.observedAt)) {
      texture.dispose(); return;
    }
    previous?.texture.dispose();
    previous = current;
    current = { frame, blob, texture };
    mix = previous && !reducedMotion ? 0 : 1;
    if (mix === 1) { previous?.texture.dispose(); previous = null; }
    publish(); renderStatus();
    void storedFrame({ frame, blob });
  }
  async function poll(force = false) {
    if (busy || disposed || !enabled) return;
    busy = true; lastPoll = Date.now(); renderStatus();
    try {
      if (force) {
        const refresh = await fetch("/api/clouds/refresh", { method: "POST", signal: AbortSignal.timeout(12000) });
        if (!refresh.ok) throw new Error("云图服务不可用");
      }
      const response = await fetch("/api/clouds", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("云图服务不可用");
      const result = await response.json();
      if (!result || !Object.hasOwn(result, "frame")) throw new Error("云图响应格式错误");
      server = result;
      const frame = result.frame;
      if (frame && !validCloudFrame(frame)) throw new Error("云图元数据无效");
      const newest = pending?.frame || current?.frame;
      if (frame && (!newest || Date.parse(frame.observedAt) > Date.parse(newest.observedAt))) {
        const image = await fetch(cloudImageUrl(frame), { signal: AbortSignal.timeout(45000) });
        if (!image.ok || !image.headers.get("content-type")?.startsWith("image/png")) throw new Error("云图加载失败");
        const blob = await image.blob();
        if (blob.size > 12 * 1024 * 1024) throw new Error("云图过大");
        await accept(frame, blob);
      }
      failed = Boolean(result.error);
    } catch { failed = true; }
    finally { busy = false; renderStatus(); }
  }
  async function start() {
    if (started || disposed) return;
    started = true;
    const saved = await storedFrame();
    if (disposed) return;
    if (saved) {
      try { await accept(saved.frame, saved.blob); } catch { /* Corrupt browser cache is replaceable. */ }
    }
    await poll();
  }
  const timer = autoStart ? setInterval(() => {
    renderStatus();
    if (enabled && !document.hidden && Date.now() - lastPoll >= (server?.refreshing || !current ? 15000 : 60000)) void poll();
  }, 5000) : null;
  const reconnect = () => { if (autoStart && enabled && !document.hidden) void poll(); };
  const disconnected = () => { failed = true; renderStatus(); };
  const modeChanged = () => {
    enabled = $("cloud-mode").value === "observed";
    publish(); onChange(enabled); renderStatus();
    if (enabled && autoStart) {
      if (started) void poll();
      else void start();
    }
  };
  const refreshClicked = () => { void poll(true); };
  $("cloud-mode").addEventListener("change", modeChanged);
  $("cloud-refresh").addEventListener("click", refreshClicked);
  window.addEventListener("online", reconnect);
  window.addEventListener("offline", disconnected);
  document.addEventListener("visibilitychange", reconnect);
  publish(); renderStatus(); if (autoStart && enabled) void start();
  return {
    get enabled() { return enabled; },
    update(dt) {
      if (isPaused()) return;
      if (previous) {
        mix = Math.min(1, mix + dt / CLOUD_BLEND_SECONDS);
        publish();
        if (mix === 1) { previous.texture.dispose(); previous = null; publish(); }
      }
      if (pending && mix === 1) {
        const next = pending; pending = null;
        void accept(next.frame, next.blob).catch(() => { failed = true; renderStatus(); });
      }
    },
    renderStatus,
    snapshot: () => ({ enabled, available: Boolean(current), frame: current?.frame || null,
      stale: cloudAge(current?.frame).stale, failed, refreshing: busy || Boolean(server?.refreshing),
      blend: mix, previousObservedAt: previous?.frame.observedAt || null,
      pendingObservedAt: pending?.frame.observedAt || null,
      textureCount: Number(Boolean(current)) + Number(Boolean(previous)) }),
    dispose() {
      disposed = true; clearInterval(timer);
      current?.texture.dispose(); previous?.texture.dispose();
      $("cloud-mode").removeEventListener("change", modeChanged);
      $("cloud-refresh").removeEventListener("click", refreshClicked);
      window.removeEventListener("online", reconnect); window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", reconnect);
    },
  };
}
