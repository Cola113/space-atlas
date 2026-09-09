import { fileURLToPath } from "node:url";
import { createAtlasServer } from "./app.js";

const { server, clouds } = createAtlasServer({
  publicDirectory: fileURLToPath(new URL("../dist/", import.meta.url)),
  cloudDirectory: process.env.CLOUD_CACHE_DIR || fileURLToPath(new URL("../data/clouds/", import.meta.url)),
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Space Atlas: http://${host}:${port}`);
  void clouds.start().catch(error => console.error("Cloud cache:", error.message));
});
const stop = () => { clouds.stop(); server.close(() => process.exit(0)); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
