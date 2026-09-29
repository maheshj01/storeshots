import { create } from "zustand";
import { parseProject, serializeProject } from "@storeshots/schema";
import { useEditor } from "../state/store.ts";
import { applyExternalProject } from "../state/external.ts";
import { addProjectAssets } from "../state/actions.ts";

/**
 * The live link to the storeshots MCP server on this computer. Once the
 * person clicks Connect, the editor keeps a WebSocket to 127.0.0.1 open
 * (reconnecting as the server comes and goes) and answers the server's
 * requests: the open project, its files, and edits to apply. An agent's
 * edits arrive as one undoable step and appear on screen immediately.
 *
 * Nothing leaves the computer: the socket only reaches the local server,
 * which only accepts this site's origin.
 */

export const BRIDGE_PORT = 47821;
const URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
const OPT_IN = "storeshots.live-link";
const VERSION = 1;

/**
 * "replaced": another storeshots tab took the link (the server serves one
 * tab at a time). This tab then stays off until the person takes it back,
 * so two open tabs don't keep taking the link from each other.
 */
export type BridgeStatus = "off" | "waiting" | "connected" | "replaced";

/** Close code the server uses when a newer tab takes the link. */
const REPLACED = 4000;

export const useBridge = create<{ status: BridgeStatus; server: string | null; lastAgentEdit: number }>(() => ({
  status: "off",
  server: null,
  lastAgentEdit: 0,
}));

let socket: WebSocket | null = null;
let retry: number | undefined;
let backoff = 1000;
let rev = 0;
let unsubscribe: (() => void) | null = null;

// A stable number per file version, so the server can skip files it already has.
const versions = new WeakMap<Blob, number>();
let nextVersion = 1;
const versionOf = (b: Blob) => {
  let v = versions.get(b);
  if (!v) versions.set(b, (v = nextVersion++));
  return v;
};

function optedIn(): boolean {
  try {
    return localStorage.getItem(OPT_IN) === "1";
  } catch {
    return false;
  }
}

function setOptIn(on: boolean) {
  try {
    if (on) localStorage.setItem(OPT_IN, "1");
    else localStorage.removeItem(OPT_IN);
  } catch {
    // private mode: the link just won't be remembered
  }
}

function send(msg: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function sendState() {
  const { doc, projectId } = useEditor.getState();
  send({ t: "state", rev, project: doc && projectId ? { id: projectId, name: doc.name } : null });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data: string, path: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = /\.png$/i.test(path) ? "image/png" : /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : /\.json$/i.test(path) ? "application/json" : /\.(ttf|otf)$/i.test(path) ? "font/ttf" : "application/octet-stream";
  return new File([bytes], path.split("/").pop()!, { type });
}

async function handle(req: { id: number; op: string; path?: string; doc?: string | null; files?: Array<{ path: string; data: string }>; label?: string }) {
  const { doc, assets } = useEditor.getState();
  const reply = (body: object) => send({ t: "res", id: req.id, ok: true, ...body });
  const fail = (error: string) => send({ t: "res", id: req.id, ok: false, error });
  if (!doc) return fail("no project is open in the storeshots editor");
  switch (req.op) {
    case "get":
      return reply({
        rev,
        doc: serializeProject(doc),
        files: [...assets].map(([path, blob]) => ({ path, size: blob.size, mod: versionOf(blob) })),
      });
    case "file": {
      const blob = req.path ? assets.get(req.path) : undefined;
      if (!blob) return fail(`no file ${req.path} in the project`);
      return reply({ data: await toBase64(blob) });
    }
    case "apply": {
      // Files first, so the design that uses them renders complete.
      const files = (req.files ?? []).filter((f) => !f.path.split("/").includes("..") && !f.path.startsWith("/"));
      if (files.length) await addProjectAssets(files.map((f) => [f.path, fromBase64(f.data, f.path)]));
      if (req.doc) {
        let parsed;
        try {
          parsed = parseProject(JSON.parse(req.doc));
        } catch (e) {
          return fail(`the agent sent invalid JSON: ${(e as Error).message}`);
        }
        if (!parsed.ok) return fail(`the agent's change is invalid: ${parsed.issues[0]?.path} ${parsed.issues[0]?.message}`);
        applyExternalProject(parsed.project, req.label || "Changes from your AI agent");
      }
      useBridge.setState({ lastAgentEdit: Date.now() });
      return reply({ rev });
    }
    default:
      return fail(`unknown request ${req.op}`);
  }
}

function open() {
  window.clearTimeout(retry);
  if (!optedIn() || socket) return;
  useBridge.setState({ status: "waiting" });
  let ws: WebSocket;
  try {
    ws = new WebSocket(URL);
  } catch {
    return schedule();
  }
  socket = ws;
  ws.onopen = () => {
    backoff = 1000;
    ws.send(JSON.stringify({ t: "hello", v: VERSION, app: "storeshots-web" }));
  };
  ws.onmessage = (e) => {
    let msg: { t?: string; name?: string; version?: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (msg.t === "welcome") {
      useBridge.setState({ status: "connected", server: `${msg.name ?? "storeshots-mcp-server"} ${msg.version ?? ""}`.trim() });
      sendState();
    } else if (msg.t === "req") {
      void handle(msg as unknown as Parameters<typeof handle>[0]).catch((err) =>
        send({ t: "res", id: msg.id, ok: false, error: (err as Error).message }),
      );
    }
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    if (e.code === REPLACED) {
      window.clearTimeout(retry);
      return useBridge.setState({ status: "replaced", server: null });
    }
    useBridge.setState({ status: optedIn() ? "waiting" : "off", server: null });
    schedule();
  };
  ws.onerror = () => ws.close();
}

function schedule() {
  if (!optedIn() || useBridge.getState().status === "replaced") return;
  window.clearTimeout(retry);
  retry = window.setTimeout(open, backoff);
  backoff = Math.min(backoff * 1.6, 8000);
}

/** Starts the link if this browser has connected before. Call once at startup. */
export function resumeBridge() {
  if (!unsubscribe) {
    // Every change to the project bumps the revision the server syncs from.
    unsubscribe = useEditor.subscribe((st, prev) => {
      if (st.doc === prev.doc && st.assets === prev.assets && st.projectId === prev.projectId) return;
      rev++;
      sendState();
    });
  }
  if (optedIn()) open();
}

/** Connects this tab (taking the link from another tab, if one has it). */
export function connectBridge() {
  setOptIn(true);
  if (useBridge.getState().status === "replaced") useBridge.setState({ status: "off" });
  backoff = 1000;
  resumeBridge();
  open();
}

export function disconnectBridge() {
  setOptIn(false);
  window.clearTimeout(retry);
  socket?.close();
  socket = null;
  useBridge.setState({ status: "off", server: null });
}
