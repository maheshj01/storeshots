import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Project } from "@storeshots/schema";
import { ProjectFolder } from "./project.ts";

/**
 * The live link between this server and the storeshots editor open in a
 * browser. The editor connects to a WebSocket on 127.0.0.1; the server keeps
 * a private mirror of the open project in a temporary folder, so every tool
 * works on it exactly as on a folder on disk. Before a tool reads, the
 * mirror catches up with the browser; after a tool edits, the changes go
 * back to the editor as one undoable step.
 *
 * Protocol (JSON, version 1):
 *   editor → server  {t:"hello", v, app}          server → editor {t:"welcome", v, name, version}
 *   editor → server  {t:"state", rev, project}    the open project and a revision that bumps on every change
 *   server → editor  {t:"req", id, op, ...}       op "get" | "file" | "apply"
 *   editor → server  {t:"res", id, ok, ...}       the answer, or {ok:false, error}
 */

export const BRIDGE_VERSION = 1;
export const DEFAULT_BRIDGE_PORT = 47821;

/** Pages allowed to connect: the hosted editor and local development. */
export const DEFAULT_ORIGINS = ["https://storeshots-mcp.vercel.app", /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

interface EditorState {
  rev: number;
  project: { id: string; name: string } | null;
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class Bridge {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  state: EditorState = { rev: 0, project: null };
  port = 0;
  error: string | null = null;
  readonly origins: Array<string | RegExp>;
  readonly version: string;

  constructor(opts: { origins?: Array<string | RegExp>; version: string }) {
    this.origins = opts.origins ?? DEFAULT_ORIGINS;
    this.version = opts.version;
  }

  get connected(): boolean {
    return this.socket !== null;
  }

  private allowed(origin: string | undefined): boolean {
    if (!origin) return false;
    return this.origins.some((o) => (typeof o === "string" ? o === origin : o.test(origin)));
  }

  /** Starts listening on 127.0.0.1; resolves false (and records why) if the port is taken. */
  start(port = DEFAULT_BRIDGE_PORT): Promise<boolean> {
    return new Promise((done) => {
      const wss = new WebSocketServer({
        host: "127.0.0.1",
        port,
        maxPayload: 256 << 20,
        verifyClient: ({ origin }: { origin: string }) => this.allowed(origin),
      });
      wss.once("listening", () => {
        this.wss = wss;
        this.port = (wss.address() as { port: number }).port;
        done(true);
      });
      wss.once("error", (e: NodeJS.ErrnoException) => {
        this.error =
          e.code === "EADDRINUSE"
            ? `port ${port} is already used, probably by another storeshots MCP server; close the other one to link this one to the browser`
            : e.message;
        done(false);
      });
      wss.on("connection", (ws) => this.attach(ws));
    });
  }

  private attach(ws: WebSocket) {
    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === "hello") {
        // The newest editor tab wins; an older one is told why it's dropped.
        if (this.socket && this.socket !== ws) this.socket.close(4000, "another storeshots tab connected");
        this.socket = ws;
        ws.send(JSON.stringify({ t: "welcome", v: BRIDGE_VERSION, name: "storeshots-mcp-server", version: this.version }));
      } else if (msg.t === "state" && ws === this.socket) {
        this.state = { rev: Number(msg.rev) || 0, project: (msg.project as EditorState["project"]) ?? null };
      } else if (msg.t === "res") {
        const p = this.pending.get(Number(msg.id));
        if (!p) return;
        this.pending.delete(Number(msg.id));
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg);
        else p.reject(new Error(String(msg.error ?? "the editor refused the request")));
      }
    });
    ws.on("close", () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.state = { rev: 0, project: null };
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("the storeshots editor disconnected"));
      }
      this.pending.clear();
    });
  }

  request(op: string, body: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const ws = this.socket;
    if (!ws) return Promise.reject(new Error(notConnected(this)));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the storeshots editor didn't answer "${op}" in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ t: "req", id, op, ...body }));
    });
  }

  close() {
    this.socket?.close();
    this.wss?.close();
  }
}

export function notConnected(bridge: Bridge): string {
  if (!bridge.port) return `the live link to the browser isn't running: ${bridge.error ?? "unknown error"}`;
  return (
    "no storeshots editor is connected. Open https://storeshots-mcp.vercel.app, open a project, click AI → Connect, then try again. " +
    "Or pass project_dir to work on a folder with a storeshots.json."
  );
}

/** A project-relative path that can't escape the mirror. */
function safePath(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!path || isAbsolute(path) || rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error(`unsafe path from the editor: ${path}`);
  return full;
}

async function walk(dir: string, base = ""): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let entries: string[] = [];
  try {
    entries = await readdir(join(dir, base));
  } catch {
    return out;
  }
  for (const name of entries) {
    const rel = base ? `${base}/${name}` : name;
    if (rel === "store" || rel === "storeshots.json") continue;
    const st = await stat(join(dir, rel));
    if (st.isDirectory()) for (const [k, v] of await walk(dir, rel)) out.set(k, v);
    else out.set(rel, st.mtimeMs);
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/**
 * The project open in the browser, mirrored into a temporary folder. It
 * behaves like any ProjectFolder for the tools; pulls from the editor when
 * the editor's revision has moved, and pushes edits back.
 */
export class LiveFolder extends ProjectFolder {
  private readonly bridge: Bridge;
  private readonly exportRoot: string;
  private projectId: string | null = null;
  private pulledRev = -1;
  private docText = "";
  /** Local file mtimes as of the last pull or push, to find what a tool wrote. */
  private snapshot = new Map<string, number>();
  /** The editor's lastModified for each file we copied, to skip unchanged ones. */
  private remote = new Map<string, number>();

  constructor(bridge: Bridge, exportRoot: string) {
    super(join(tmpdir(), `storeshots-live-${process.pid}`));
    this.bridge = bridge;
    this.exportRoot = exportRoot;
  }

  get isLive() {
    return true;
  }

  describe(): string {
    const p = this.bridge.state.project;
    return p ? `the project "${p.name}" open in the storeshots editor (live)` : "the storeshots editor (not connected)";
  }

  outputDir(project: Project): string {
    return join(this.exportRoot, "storeshots-export", slug(project.name));
  }

  /** Brings the mirror up to date with the editor. */
  async pull(): Promise<void> {
    if (!this.bridge.connected) throw new Error(notConnected(this.bridge));
    const { project, rev } = this.bridge.state;
    if (!project) throw new Error("the storeshots editor is connected but no project is open; open one in the browser and try again");
    if (project.id !== this.projectId) {
      await rm(this.dir, { recursive: true, force: true });
      this.projectId = project.id;
      this.pulledRev = -1;
      this.remote.clear();
    }
    if (rev === this.pulledRev) return;
    await mkdir(this.dir, { recursive: true });
    const res = await this.bridge.request("get");
    const files = (res.files as Array<{ path: string; size: number; mod: number }>) ?? [];
    const wanted = new Set(files.map((f) => f.path));
    for (const f of files) {
      const full = safePath(this.dir, f.path);
      if (this.remote.get(f.path) === f.mod) {
        try {
          if ((await stat(full)).size === f.size) continue;
        } catch {
          // missing locally: fetch it
        }
      }
      const file = await this.bridge.request("file", { path: f.path }, 60_000);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, Buffer.from(String(file.data), "base64"));
      this.remote.set(f.path, f.mod);
    }
    for (const [path] of await walk(this.dir)) {
      if (!wanted.has(path)) await rm(join(this.dir, path), { force: true });
    }
    this.docText = String(res.doc);
    await writeFile(this.file, this.docText);
    this.snapshot = await walk(this.dir);
    this.pulledRev = Number(res.rev);
  }

  /** Sends what tools changed in the mirror back to the editor, as one undoable step. */
  async flush(label = "Changes from your AI agent"): Promise<void> {
    if (!this.projectId) return;
    const text = await readFile(this.file, "utf8");
    const now = await walk(this.dir);
    const files: Array<{ path: string; data: string }> = [];
    for (const [path, mtime] of now) {
      if (this.snapshot.get(path) === mtime) continue;
      files.push({ path, data: (await readFile(join(this.dir, path))).toString("base64") });
    }
    if (text === this.docText && files.length === 0) return;
    const res = await this.bridge.request("apply", { doc: text === this.docText ? null : text, files, label }, 60_000);
    this.docText = text;
    this.snapshot = now;
    // The editor's revision moved because of our own change; nothing to pull back.
    this.pulledRev = Number(res.rev);
    this.bridge.state = { ...this.bridge.state, rev: Number(res.rev) };
  }

  override async load(): Promise<Project> {
    await this.pull();
    return super.load();
  }

  override async edit<T>(fn: (p: Project) => T | Promise<T>): Promise<{ project: Project; result: T }> {
    await this.pull();
    const out = await super.edit(fn);
    await this.flush();
    return out;
  }

  override async captures(locale: string): Promise<string[]> {
    await this.pull();
    return super.captures(locale);
  }

  override async importedFrames(): Promise<string[]> {
    await this.pull();
    return super.importedFrames();
  }
}
