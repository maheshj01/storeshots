#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME } from "./server.ts";

const { values } = parseArgs({
  options: { project: { type: "string", short: "p" }, help: { type: "boolean", short: "h" } },
});

if (values.help) {
  console.error(`${SERVER_NAME}: MCP server over stdio for storeshots projects.

  storeshots-mcp-server [--project <folder with storeshots.json>]

The project defaults to the current folder; every tool also takes project_dir.`);
  process.exit(0);
}

const server = createServer(values.project ?? process.cwd());
await server.connect(new StdioServerTransport());
// stdout carries the protocol; log to stderr only.
console.error(`${SERVER_NAME} ready for ${values.project ?? process.cwd()}`);
