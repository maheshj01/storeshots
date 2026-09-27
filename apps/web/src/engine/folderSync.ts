import { useEffect } from "react";
import { create } from "zustand";
import { parseProject, serializeProject, type Project } from "@storeshots/schema";
import { useEditor } from "../state/store.ts";
import { saveAssets, saveDoc } from "../state/persist.ts";
import { ensureWritable, readFolderFiles, writeFolderFile } from "../state/io.ts";

/**
 * Two-way sync between the open project and a folder on disk (Chromium's
 * File System Access API). The editor writes changes to the folder as you
 * make them, and picks up changes other tools make there, such as an AI
 * agent working through the storeshots MCP server, within about a second.
 * Changes from the folder arrive as one undoable step.
 */

export type SyncState =
  | { kind: "off" }
  | { kind: "reconnect" }
  | { kind: "synced"; at: number }
  | { kind: "saving" }
  | { kind: "error"; message: string };

export const useSyncStatus = create<{ status: SyncState; lastExternal: number }>(() => ({ status: { kind: "off" }, lastExternal: 0 }));
const setStatus = (status: SyncState) => useSyncStatus.setState({ status });

const POLL_MS = 1000;
const ASSET_SCAN_EVERY = 4; // polls
const SAVE_DEBOUNCE_MS = 500;

interface SyncSession {
  handle: FileSystemDirectoryHandle;
  /** What we believe storeshots.json on disk says. */
  diskText: string | null;
  /** lastModified of every other file we've seen, by path. */
  seen: Map<string, number>;
  busy: boolean;
  stopped: boolean;
}

async function permitted(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as { queryPermission(o: object): Promise<PermissionState> };
  return (await h.queryPermission({ mode: "readwrite" })) === "granted";
}

async function readText(handle: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const file = await (await handle.getFileHandle("storeshots.json")).getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/** Applies a project read from disk as one undoable edit. */
function applyExternal(next: Project) {
  const { edit, select, selection } = useEditor.getState();
  edit("Changes from the folder", (d) => {
    for (const key of Object.keys(next) as Array<keyof Project>) (d as Record<string, unknown>)[key] = next[key];
  });
  // Keep the selection pointing at something that still exists.
  const doc = useEditor.getState().doc!;
  const screen = doc.screens.find((s) => s.id === selection.screen) ?? doc.screens[0];
  const layer = screen && selection.layer !== null && selection.layer < screen.layers.length ? selection.layer : null;
  select({ screen: screen?.id ?? null, layer });
  useSyncStatus.setState({ lastExternal: Date.now() });
}

/** Loads files that are new or changed in the folder since we last looked. */
async function scanAssets(s: SyncSession) {
  const files = await readFolderFiles(s.handle);
  const changed: Array<[string, Blob]> = [];
  for (const [path, file] of files) {
    if (path === "storeshots.json") continue;
    const mod = (file as File).lastModified;
    if (s.seen.get(path) === mod) continue;
    s.seen.set(path, mod);
    const current = useEditor.getState().assets.get(path);
    if (current && current.size === file.size && (current as File).lastModified === mod) continue;
    changed.push([path, file]);
  }
  if (changed.length) {
    useEditor.getState().addAssets(changed, { fromFolder: true });
    const id = useEditor.getState().projectId;
    if (id) await saveAssets(id, changed);
  }
  return changed.length;
}

async function poll(s: SyncSession, tick: number) {
  // Runs in background tabs too (browsers slow the timer there), so an
  // agent's work is already applied when you come back to the tab.
  if (s.busy || s.stopped) return;
  s.busy = true;
  try {
    const text = await readText(s.handle);
    if (text === null) return setStatus({ kind: "error", message: `${s.handle.name}/storeshots.json is missing` });
    const assetsFirst = s.diskText === null || text !== s.diskText || tick % ASSET_SCAN_EVERY === 0;
    // New files first, so a design that uses them renders complete.
    if (assetsFirst) await scanAssets(s);
    if (text !== s.diskText) {
      const doc = useEditor.getState().doc;
      if (s.diskText === null && doc && serializeProject(doc) === text) {
        s.diskText = text;
      } else {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return; // mid-write; try again next poll
        }
        const r = parseProject(json);
        if (!r.ok) {
          return setStatus({ kind: "error", message: `storeshots.json in the folder is invalid: ${r.issues[0]?.path} ${r.issues[0]?.message}` });
        }
        s.diskText = text;
        applyExternal(r.project);
      }
    }
    setStatus({ kind: "synced", at: Date.now() });
  } catch (e) {
    setStatus({ kind: "error", message: (e as Error).message });
  } finally {
    s.busy = false;
  }
}

async function save(s: SyncSession) {
  // Until the folder has been read once we don't know what's there, and
  // writing could overwrite changes made while the editor was away.
  if (s.busy || s.stopped || s.diskText === null) return false;
  const { doc, assets, unsavedAssets } = useEditor.getState();
  if (!doc) return true;
  const text = serializeProject(doc);
  if (text === s.diskText && unsavedAssets.size === 0) return true;
  s.busy = true;
  try {
    // If something else changed the file since we last read it, take that
    // change first instead of overwriting it; the next poll applies it.
    const onDisk = await readText(s.handle);
    if (onDisk !== null && onDisk !== s.diskText) return false;
    setStatus({ kind: "saving" });
    for (const path of unsavedAssets) {
      const blob = assets.get(path);
      if (!blob) continue;
      const file = await writeFolderFile(s.handle, path, blob);
      s.seen.set(path, file.lastModified);
    }
    if (text !== s.diskText) {
      await writeFolderFile(s.handle, "storeshots.json", text);
      s.diskText = text;
    }
    useEditor.getState().markFolderSaved();
    setStatus({ kind: "synced", at: Date.now() });
    return true;
  } catch (e) {
    setStatus({ kind: "error", message: `couldn't save to ${s.handle.name}: ${(e as Error).message}` });
    return true;
  } finally {
    s.busy = false;
  }
}

let restart: (() => void) | null = null;

/** Runs sync for the open project while it's linked to a folder. */
export function useFolderSync() {
  const folder = useEditor((st) => st.folder);
  const projectId = useEditor((st) => st.projectId);

  useEffect(() => {
    if (!folder) return void setStatus({ kind: "off" });
    const s: SyncSession = { handle: folder, diskText: null, seen: new Map(), busy: false, stopped: false };
    let timer: number | undefined;
    let tick = 0;
    let saveTimer: number | undefined;

    const start = async () => {
      if (!(await permitted(folder))) return setStatus({ kind: "reconnect" });
      if (s.stopped) return;
      await poll(s, tick++);
      timer = window.setInterval(() => void poll(s, tick++), POLL_MS);
    };
    restart = () => void start();

    const unsubscribe = useEditor.subscribe((st, prev) => {
      if (st.doc === prev.doc && st.unsavedAssets === prev.unsavedAssets) return;
      window.clearTimeout(saveTimer);
      const attempt = () => {
        if (s.stopped || timer === undefined) return;
        void save(s).then((done) => {
          if (!done) saveTimer = window.setTimeout(attempt, SAVE_DEBOUNCE_MS);
        });
      };
      saveTimer = window.setTimeout(attempt, SAVE_DEBOUNCE_MS);
    });
    void start();

    return () => {
      s.stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(saveTimer);
      unsubscribe();
      restart = null;
    };
  }, [folder, projectId]);
}

/** Asks for folder access again (browsers forget it between visits). Needs a click. */
export async function reconnectFolder() {
  const folder = useEditor.getState().folder;
  if (!folder) return;
  if (await ensureWritable(folder)) restart?.();
}

/**
 * Links a browser-only project to a folder: writes storeshots.json and its
 * files there, then keeps them in sync. This is how a project made on the
 * web becomes something an AI agent can edit.
 */
export async function linkFolder(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker?(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ mode: "readwrite", id: "storeshots-project" });
  const { doc, assets, projectId } = useEditor.getState();
  if (!doc || !projectId) return null;
  if ((await readText(handle)) !== null && !confirm(`${handle.name} already has a storeshots.json. Replace it with this project?`)) return null;
  for (const [path, blob] of assets) await writeFolderFile(handle, path, blob);
  await writeFolderFile(handle, "storeshots.json", serializeProject(doc));
  useEditor.getState().setFolder(handle);
  useEditor.getState().markFolderSaved();
  await saveDoc(projectId, doc, { folder: handle });
  return handle.name;
}
