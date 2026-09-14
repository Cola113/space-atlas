import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { cloudPlugin } from "./solar-system/server/cloud-service.js";
import { scenes } from "./platform/scenes.js";

const localPath = (path) => fileURLToPath(new URL(path, import.meta.url));

// Emit the maintained sources once at build time, so published citations do
// not point at missing repository-only files or diverging copied documents.
const scientificSources = {
  name: 'scientific-sources',
  async generateBundle() {
    for (const [fileName, sourcePath] of [
      ['solar-system/BODY_MODELS.md', './solar-system/BODY_MODELS.md'],
      ['solar-system/GROUND_AUDIT.md', './solar-system/GROUND_AUDIT.md'],
      ['REALISM_STANDARD.md', './REALISM_STANDARD.md'],
      ['TODO.md', './TODO.md'],
      ['PERFORMANCE_VALIDATION.md', './PERFORMANCE_VALIDATION.md'],
      ['RELEASE_ACCEPTANCE.md', './RELEASE_ACCEPTANCE.md'],
      ['solar-system/physical-definitions.json', './solar-system/src/physics/body-definitions.json'],
    ]) {
      let source = await readFile(localPath(sourcePath),'utf8');
      // Repository Markdown links retain public/; Vite serves that directory
      // from the site root. Rewrite only these local link prefixes on publish.
      if (fileName.endsWith('.md')) source = source.replace(/\]\(((?:\.\.\/)*)(?:public\/)/g, ']($1');
      this.emitFile({type:'asset',fileName,source});
    }
  },
};

export default defineConfig({
  plugins: [cloudPlugin(process.env.CLOUD_CACHE_DIR || localPath("./data/clouds/")), scientificSources],
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
