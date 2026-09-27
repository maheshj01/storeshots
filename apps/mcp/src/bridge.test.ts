import { afterEach, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Bridge } from "./bridge.ts";
import { createServer } from "./server.ts";

/**
 * A stand-in for the web editor: holds a project in memory and answers the
 * server's get / file / apply requests over the live link, like the tab does.
 */
async function fakeEditor(port: number, origin = "http://localhost:5180") {
  const fixture = fileURLToPath(new URL("../../../examples/epoch/", import.meta.url));
  let doc = await readFile(join(fixture, "storeshots.json"), "utf8");
  const files = new Map<string, Buffer>();
  for (const dir of ["captures/en", "fonts"]) for (const f of await readdir(join(fixture, dir))) files.set(`${dir}/${f}`, await readFile(join(fixture, dir, f)));
  let rev = 1;
  const applied: string[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  const send = (m: object) => ws.send(JSON.stringify(m));
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === "welcome") return send({ t: "state", rev, project: { id: "p1", name: "Epoch" } });
    if (m.t !== "req") return;
    if (m.op === "get") return send({ t: "res", id: m.id, ok: true, rev, doc, files: [...files].map(([path, b]) => ({ path, size: b.length, mod: 1 })) });
    if (m.op === "file") return send({ t: "res", id: m.id, ok: true, data: files.get(m.path)!.toString("base64") });
    if (m.op === "apply") {
      if (m.doc) doc = m.doc;
      for (const f of m.files ?? []) files.set(f.path, Buffer.from(f.data, "base64"));
      applied.push(m.label);
      rev++;
      send({ t: "state", rev, project: { id: "p1", name: "Epoch" } });
      return send({ t: "res", id: m.id, ok: true, rev });
    }
  });
  send({ t: "hello", v: 1, app: "storeshots-web" });
  await new Promise((r) => setTimeout(r, 100));
  return {
    ws,
    applied,
    get doc() {
      return JSON.parse(doc);
    },
    files,
    /** Simulates the person editing in the browser. */
    edit(fn: (d: Record<string, any>) => void) {
      const d = JSON.parse(doc);
      fn(d);
      doc = JSON.stringify(d);
      rev++;
      send({ t: "state", rev, project: { id: "p1", name: "Epoch" } });
    },
  };
}

let bridge: Bridge;
afterEach(() => bridge?.close());

async function setup() {
  bridge = new Bridge({ version: "test" });
  expect(await bridge.start(0)).toBe(true);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer("live", { bridge, exportRoot: "/tmp/storeshots-bridge-test" }).connect(a), client.connect(b)]);
  const call = async (name: string, args: object = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text?: string }> };
    return { error: !!r.isError, text: r.content.map((c) => c.text ?? "").join("\n") };
  };
  return { call };
}

describe("live link to the web editor", { timeout: 30_000 }, () => {
  it("explains how to connect when no editor is there", async () => {
    const { call } = await setup();
    const r = await call("storeshots_get_project");
    expect(r.error).toBe(true);
    expect(r.text).toContain("click AI → Connect");
  });

  it("refuses pages from other origins", async () => {
    await setup();
    await expect(fakeEditor(bridge.port, "https://evil.example")).rejects.toThrow(/401|403|HTTP/);
  });

  it("reads the open project, edits it in the editor, and sees the person's edits", async () => {
    const { call } = await setup();
    const editor = await fakeEditor(bridge.port);
    const overview = await call("storeshots_get_project");
    expect(overview.text).toContain('the project "Epoch" open in the storeshots editor (live)');

    const upd = await call("storeshots_update_layer", { screen: "progress", layer: 0, set: { text: "From the agent" } });
    expect(upd.error).toBe(false);
    expect(editor.doc.captions["progress.title"].en).toBe("From the agent");
    expect(editor.applied).toEqual(["Changes from your AI agent"]);

    editor.edit((d) => (d.captions["progress.title"].en = "From the person"));
    await new Promise((r) => setTimeout(r, 50));
    const seen = await call("storeshots_inspect_screen", { screen: "progress" });
    expect(seen.text).toContain('"From the person"');
  });

  it("sends new files to the editor with the change that uses them", async () => {
    const { call } = await setup();
    const editor = await fakeEditor(bridge.port);
    const r = await call("storeshots_update_layer", { screen: "profile", layer: 0, set: { font: "fonts/DMSerifDisplay-Regular.ttf" } });
    expect(r.error).toBe(false);
    expect(editor.files.has("fonts/DMSerifDisplay-Regular.ttf")).toBe(true);
    expect(editor.doc.screens[3].layers[0].font).toBe("fonts/DMSerifDisplay-Regular.ttf");
  });
});
