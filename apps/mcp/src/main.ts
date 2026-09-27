import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME } from "./server.ts";
import { Bridge, DEFAULT_BRIDGE_PORT, DEFAULT_ORIGINS } from "./bridge.ts";

const VERSION = "0.1.0";

const { values } = parseArgs({
  options: {
    project: { type: "string", short: "p" },
    port: { type: "string" },
    "no-live": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.error(`${SERVER_NAME} ${VERSION}: MCP server over stdio for storeshots screenshot designs.

  storeshots-mcp-server [--project <folder>] [--port <n>] [--no-live]

Works on the folder given with --project, else a storeshots.json in the
current folder, else the project open in the storeshots web editor, which
connects to this server on 127.0.0.1:${DEFAULT_BRIDGE_PORT} (click AI → Connect).
Every tool also takes project_dir: a folder, or "live".

Environment: STORESHOTS_PORT, STORESHOTS_ALLOWED_ORIGINS (comma-separated
extra origins allowed to connect).`);
  process.exit(0);
}

const cwd = process.cwd();
const project = values.project ?? (existsSync(join(cwd, "storeshots.json")) ? cwd : "live");

let bridge: Bridge | undefined;
if (!values["no-live"]) {
  const extra = (process.env.STORESHOTS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  bridge = new Bridge({ origins: [...DEFAULT_ORIGINS, ...extra], version: VERSION });
  const port = Number(values.port ?? process.env.STORESHOTS_PORT ?? DEFAULT_BRIDGE_PORT);
  if (await bridge.start(port)) console.error(`${SERVER_NAME}: live link for the web editor on 127.0.0.1:${bridge.port}`);
  else console.error(`${SERVER_NAME}: live link unavailable: ${bridge.error}`);
}

const server = createServer(project, { bridge, exportRoot: cwd });
const transport = new StdioServerTransport();
// When the AI tool closes the session, stop: the live link's port must be
// free for the next session.
const shutdown = () => {
  bridge?.close();
  process.exit(0);
};
transport.onclose = shutdown;
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
await server.connect(transport);
// stdout carries the protocol; log to stderr only.
console.error(`${SERVER_NAME} ready: ${project === "live" ? "the project open in the web editor" : project}`);
