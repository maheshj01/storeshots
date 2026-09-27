import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The template fonts live with the templates in packages/ops. */
const FONTS_DIR = fileURLToPath(new URL("../../packages/ops/fonts", import.meta.url));

/** Serves packages/ops/fonts at /fonts/ in dev and copies it into the build. */
function bundledFonts(): Plugin {
  const files = () => readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf|txt|md)$/.test(f));
  return {
    name: "storeshots-bundled-fonts",
    configureServer(server) {
      server.middlewares.use("/fonts", (req, res) => {
        const name = decodeURIComponent((req.url ?? "").replace(/^\//, "").split("?")[0] ?? "");
        if (!files().includes(name)) {
          res.statusCode = 404;
          return res.end(`no bundled font ${name}`);
        }
        res.setHeader("Content-Type", name.endsWith(".ttf") ? "font/ttf" : name.endsWith(".otf") ? "font/otf" : "text/plain");
        res.end(readFileSync(join(FONTS_DIR, name)));
      });
    },
    generateBundle() {
      for (const name of files()) {
        this.emitFile({ type: "asset", fileName: `fonts/${name}`, source: readFileSync(join(FONTS_DIR, name)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), bundledFonts()],
  worker: { format: "es" },
  build: { target: "es2023" },
});
