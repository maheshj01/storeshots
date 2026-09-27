// Bundles the server and the storeshots packages it uses into one file for
// npm. The native canvas module, the MCP SDK and zod stay real dependencies;
// the template fonts are copied next to the bundle, where the ops package
// looks for them (../fonts from dist/).
import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";

const here = new URL(".", import.meta.url);
await rm(new URL("dist", here), { recursive: true, force: true });
await rm(new URL("fonts", here), { recursive: true, force: true });
await build({
  entryPoints: [new URL("src/main.ts", here).pathname],
  outfile: new URL("dist/storeshots-mcp-server.js", here).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@napi-rs/canvas", "@modelcontextprotocol/sdk", "zod", "ws"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
await cp(new URL("../../packages/ops/fonts", here), new URL("fonts", here), { recursive: true });
console.log("built dist/storeshots-mcp-server.js");
