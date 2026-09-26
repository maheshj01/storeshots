import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  // No SPA fallback: missing files must 404 so locale fallbacks work.
  appType: "mpa",
  define: { __REPO__: JSON.stringify(repo) },
  server: { fs: { allow: [repo] } },
});
