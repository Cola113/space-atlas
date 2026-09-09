import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { cloudPlugin } from "./solar-system/server/cloud-service.js";
import { scenes } from "./platform/scenes.js";

const localPath = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [cloudPlugin(process.env.CLOUD_CACHE_DIR || localPath("./data/clouds/"))],
  server: { watch: { usePolling: process.platform === "win32", interval: 350 } },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: localPath("./index.html"),
        ...Object.fromEntries(scenes.map(scene => [scene.id, localPath(`.${scene.path}index.html`)])),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three";
          if (id.includes("node_modules/lucide/")) return "icons";
        },
      },
    },
  },
});
