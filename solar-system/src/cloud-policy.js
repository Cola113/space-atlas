export const CLOUD_CHECK_MS = 60 * 60 * 1000;
export const CLOUD_STALE_MS = 6 * 60 * 60 * 1000;
export const CLOUD_BLEND_SECONDS = 3;

export function validCloudFrame(frame) {
  return Boolean(frame && /^clouds-[a-f0-9]{20}\.png$/.test(frame.file || "") &&
    Number.isFinite(Date.parse(frame.observedAt)) && frame.width === 2048 &&
    frame.height === 1024 && frame.projection === "EPSG:4326");
}

export function cloudAge(frame, now = Date.now()) {
  if (!validCloudFrame(frame)) return { ageMs: null, stale: true };
  const ageMs = Math.max(0, now - Date.parse(frame.observedAt));
  return { ageMs, stale: ageMs > CLOUD_STALE_MS };
}
