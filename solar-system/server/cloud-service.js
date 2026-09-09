import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { CLOUD_CHECK_MS, CLOUD_STALE_MS, cloudAge, validCloudFrame } from "../src/cloud-policy.js";

export const CLOUD_SOURCE = {
  name: "EUMETSAT · 全球红外拼接",
  url: "https://user.eumetsat.int/catalogue/EO:EUM:DAT:0330",
  license: "CC BY 4.0",
  layer: "mumi:worldcloudmap_ir108",
  intervalHours: 3,
};
const WMS = "https://view.eumetsat.int/geoserver/wms";
const WIDTH = 2048, HEIGHT = 1024;
const MAX_DOWNLOAD = 12 * 1024 * 1024;

export function observationTime(xml, now = Date.now()) {
  const marker = `<Name>${CLOUD_SOURCE.layer}</Name>`;
  const start = xml.indexOf(marker);
  if (start < 0) throw new Error("卫星数据目录未包含目标图层");
  const layer = xml.slice(start, xml.indexOf("</Layer>", start));
  const tag = layer.match(/<Dimension\b(?=[^>]*\bname="time")[^>]*>/)?.[0];
  const time = tag?.match(/\bdefault="([^"]+)"/)?.[1];
  const ms = Date.parse(time);
  if (!Number.isFinite(ms) || ms > now + 5 * 60 * 1000 || ms < Date.UTC(2021, 0, 1))
    throw new Error("卫星影像时间无效");
  return new Date(ms).toISOString();
}

export function imageRequest(time) {
  return `${WMS}?${new URLSearchParams({ service: "WMS", version: "1.3.0",
    request: "GetMap", layers: CLOUD_SOURCE.layer, styles: "", crs: "CRS:84",
    bbox: "-180,-90,180,90", width: String(WIDTH), height: String(HEIGHT),
    format: "image/png", transparent: "true", time })}`;
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export async function makeCloudTexture(input) {
  const { data, info } = await sharp(input, { limitInputPixels: WIDTH * HEIGHT })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== WIDTH || info.height !== HEIGHT || info.channels !== 4)
    throw new Error("卫星影像尺寸不匹配");
  const mask = Buffer.alloc(WIDTH * HEIGHT);
  let covered = 0, cloudy = 0;
  for (let y = 0; y < HEIGHT; y++) {
    const latitude = Math.abs(90 - (y + 0.5) * 180 / HEIGHT);
    // A single IR display channel is not a retrieval of cloud fraction/height.
    // Suppress warm background; the latitude adjustment reduces cold-land bias.
    // Polar regions and saturated/missing pixels are explicitly unobserved.
    const polar = 1 - smooth(68, 75, latitude);
    const threshold = 65 + latitude * 0.8;
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x, p = i * 4;
      const signal = data[p];
      const valid = data[p + 3] > 240 && signal < 254 && polar > 0;
      mask[i] = valid ? Math.round(255 * polar) : 0;
      const density = valid ? smooth(threshold, 225, signal) : 0;
      data[p] = data[p + 1] = data[p + 2] = Math.round(255 * density);
      if (valid) covered++;
      if (density > 0.15) cloudy++;
    }
  }
  if (covered < WIDTH * HEIGHT * 0.35 || cloudy < WIDTH * HEIGHT * 0.005)
    throw new Error("卫星影像为空或有效覆盖不足");
  // Feather the boundary of missing data, without filling it with synthetic clouds.
  const feather = await sharp(mask, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .blur(1.2).greyscale().raw().toBuffer();
  for (let i = 0; i < mask.length; i++) data[i * 4 + 3] = Math.min(mask[i], feather[i]);
  const png = await sharp(data, { raw: info }).png().toBuffer();
  return { png, coveragePercent: Math.round(covered / (WIDTH * HEIGHT) * 1000) / 10 };
}

async function download(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(40000),
    headers: { "User-Agent": "SolarAtlas/1.0 (satellite cloud visualization)" } });
  if (!response.ok) throw new Error(`卫星服务 HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_DOWNLOAD) throw new Error("卫星响应超过大小限制");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks);
}

export function createCloudService({ directory, fetcher = fetch, now = Date.now } = {}) {
  let frame = null, checkedAt = null, lastError = null, running = null, timer = null;
  let nextCheck = 0, initializing = null;
  const initialize = () => initializing ??= (async () => {
    await mkdir(directory, { recursive: true });
    try {
      const stored = JSON.parse(await readFile(join(directory, "latest.json"), "utf8"));
      if (validCloudFrame(stored)) {
        const bytes = await readFile(join(directory, stored.file));
        const metadata = await sharp(bytes).metadata();
        if (metadata.width === WIDTH && metadata.height === HEIGHT) frame = stored;
      }
    } catch { /* A missing or corrupt cache must not prevent a new download. */ }
  })().catch(error => { initializing = null; throw error; });
  function snapshot() {
    return { frame, source: CLOUD_SOURCE, checkedAt, refreshing: Boolean(running),
      error: lastError, nextCheckAt: nextCheck ? new Date(nextCheck).toISOString() : null,
      stale: cloudAge(frame, now()).stale, checkIntervalMs: CLOUD_CHECK_MS, staleAfterMs: CLOUD_STALE_MS };
  }
  async function update() {
    try {
      await initialize();
      const xml = (await download(`${WMS}?service=WMS&request=GetCapabilities&version=1.3.0`, fetcher)).toString();
      const time = observationTime(xml, now());
      if (!frame || Date.parse(time) > Date.parse(frame.observedAt)) {
        const input = await download(imageRequest(time), fetcher);
        const { png, coveragePercent } = await makeCloudTexture(input);
        const hash = createHash("sha256").update(time).update(png).digest("hex").slice(0, 20);
        const file = `clouds-${hash}.png`;
        const candidate = { file, imageUrl: `/api/clouds/images/${file}`, observedAt: time,
          fetchedAt: new Date(now()).toISOString(), width: WIDTH, height: HEIGHT,
          projection: "EPSG:4326", coveragePercent, source: CLOUD_SOURCE,
          method: "infrared-display-estimate-v1" };
        // Publish the metadata pointer only after a complete immutable image exists.
        await writeFile(join(directory, `${file}.tmp`), png);
        await rename(join(directory, `${file}.tmp`), join(directory, file));
        await writeFile(join(directory, "latest.json.tmp"), JSON.stringify(candidate, null, 2));
        await rename(join(directory, "latest.json.tmp"), join(directory, "latest.json"));
        frame = candidate;
        const files = (await readdir(directory)).filter(name => /^clouds-[a-f0-9]{20}\.png$/.test(name));
        // Retain a generous short history for clients that fetched an older manifest.
        if (files.length > 16) {
          const { stat } = await import("node:fs/promises");
          const dated = await Promise.all(files.map(async name => ({ name, mtime: (await stat(join(directory, name))).mtimeMs })));
          for (const old of dated.sort((a,b) => b.mtime-a.mtime).slice(16))
            if (old.name !== frame.file) await unlink(join(directory, old.name)).catch(() => {});
        }
      }
      lastError = null;
      nextCheck = now() + CLOUD_CHECK_MS;
    } catch (error) {
      lastError = error.message;
      nextCheck = now() + 15 * 60 * 1000;
    }
    checkedAt = new Date(now()).toISOString();
    return snapshot();
  }
  function refresh(force = false) {
    if (running) return running;
    // A manual retry is allowed after one minute; it cannot fan out upstream requests.
    if (nextCheck > now() && (!force || (checkedAt && now() - Date.parse(checkedAt) < 60000)))
      return Promise.resolve(snapshot());
    running = update().finally(() => { running = null; });
    return running;
  }
  async function middleware(req, res, next) {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/api/clouds")) return next();
    const json = (value, code = 200) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    try {
      await initialize();
      if (path === "/api/clouds" && req.method === "GET") {
        void refresh();
        return json(snapshot());
      }
      if (path === "/api/clouds/refresh" && req.method === "POST") {
        void refresh(true);
        return json(snapshot());
      }
      const match = path.match(/^\/api\/clouds\/images\/(clouds-[a-f0-9]{20}\.png)$/);
      if (match && req.method === "GET") {
        try {
          const image = await readFile(join(directory, match[1]));
          res.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.length,
            "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
          return res.end(image);
        } catch { return json({ error: "云图文件不存在" }, 404); }
      }
      return json({ error: "未找到接口" }, 404);
    } catch { return json({ error: "云图缓存暂不可用" }, 503); }
  }
  return { refresh, snapshot, middleware,
    async start() {
      await initialize();
      void refresh();
      timer ??= setInterval(() => { void refresh(); }, 60000);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

export function cloudPlugin(directory) {
  const service = createCloudService({ directory });
  const attach = server => {
    server.middlewares.use(service.middleware);
    void service.start().catch(error => console.error("Cloud cache:", error.message));
    server.httpServer?.once("close", () => service.stop());
  };
  return { name: "solar-atlas-observed-clouds", configureServer: attach, configurePreviewServer: attach };
}
