import { createServer } from "node:http";
import sirv from "sirv";
import { createCloudService } from "../solar-system/server/cloud-service.js";
import { scenes } from "../platform/scenes.js";

export function createAtlasServer({ publicDirectory, cloudDirectory, fetcher } = {}) {
  const clouds = createCloudService({ directory: cloudDirectory, fetcher });
  const assets = sirv(publicDirectory, {
    etag: true,
    setHeaders(res, path) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", path.endsWith(".html") ? "no-cache" : "public, max-age=3600");
    },
  });
  const notFound = (_req, res) => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = scenes.find(scene => scene.path.slice(0, -1) === url.pathname);
    if (url.pathname === "/" || route) {
      res.writeHead(302, { Location: (route?.path || scenes[0].path) + url.search });
      return res.end();
    }
    void clouds.middleware(req, res, () => {
      if (req.method !== "GET" && req.method !== "HEAD") return notFound(req, res);
      assets(req, res, () => notFound(req, res));
    });
  });
  server.on("close", () => clouds.stop());
  return { server, clouds };
}
