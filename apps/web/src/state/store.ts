import { create } from "zustand";
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type { Project } from "@storeshots/schema";

enablePatches();

interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
  label: string;
  /** Edits with the same merge key within a moment fold into one undo step. */
  merge?: string | undefined;
  at?: number;
}

const MERGE_WINDOW_MS = 1000;

export interface Selection {
  screen: string | null;
  layer: number | null;
}

export interface EditorState {
  projectId: string | null;
  doc: Project | null;
  /** Project files by relative path: captures, fonts, frames, images. */
  assets: Map<string, Blob>;
  /** Bumped whenever assets change, so renders know to reload. */
  assetsVersion: number;
  /** A linked folder on disk (Chromium), saved on request. */
  folder: FileSystemDirectoryHandle | null;
  /** Asset paths added since the last folder save. */
  unsavedAssets: Set<string>;
  docSavedToFolder: boolean;

  selection: Selection;
  /** The layer under the pointer, on the canvas or in the layers list; shown on both. */
  hover: Selection;
  locale: string;
  target: string;
  zoom: number;

  past: HistoryEntry[];
  future: HistoryEntry[];
  gesture: HistoryEntry | null;

  open(args: { id: string; doc: Project; assets: Map<string, Blob>; folder?: FileSystemDirectoryHandle | null }): void;
  close(): void;
  /** Applies an edit as one undo step, or folds it into the running gesture. */
  edit(label: string, recipe: (draft: Draft<Project>) => void, merge?: string): void;
  beginGesture(label: string): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  /** Adds project files; `fromFolder` marks ones read from the linked folder, which needn't be written back. */
  addAssets(files: Array<[string, Blob]>, opts?: { fromFolder?: boolean }): void;
  setFolder(folder: FileSystemDirectoryHandle | null): void;
  select(sel: Partial<Selection>): void;
  setHover(hover: Selection): void;
  setLocale(locale: string): void;
  setTarget(target: string): void;
  setZoom(zoom: number): void;
  markFolderSaved(): void;
}

const HISTORY_LIMIT = 200;

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  doc: null,
  assets: new Map(),
  assetsVersion: 0,
  folder: null,
  unsavedAssets: new Set(),
  docSavedToFolder: true,
  selection: { screen: null, layer: null },
  hover: { screen: null, layer: null },
  locale: "en",
  target: "",
  zoom: 1,
  past: [],
  future: [],
  gesture: null,

  open({ id, doc, assets, folder = null }) {
    set({
      projectId: id,
      doc,
      assets,
      assetsVersion: get().assetsVersion + 1,
      folder,
      unsavedAssets: new Set(),
      docSavedToFolder: true,
      selection: { screen: doc.screens[0]?.id ?? null, layer: null },
      locale: doc.locales.default,
      target: doc.targets[0]?.id ?? "",
      past: [],
      future: [],
      gesture: null,
    });
  },

  close() {
    set({ projectId: null, doc: null, assets: new Map(), folder: null, past: [], future: [], gesture: null });
  },

  edit(label, recipe, merge) {
    const { doc, gesture, past } = get();
    if (!doc) return;
    const [next, patches, inverse] = produceWithPatches(doc, recipe);
    if (patches.length === 0) return;
    if (gesture) {
      gesture.patches.push(...patches);
      gesture.inverse.unshift(...inverse);
      set({ doc: next, docSavedToFolder: false });
      return;
    }
    const last = past[past.length - 1];
    const now = Date.now();
    if (merge && last?.merge === merge && now - (last.at ?? 0) < MERGE_WINDOW_MS) {
      const merged = { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now };
      set({ doc: next, docSavedToFolder: false, past: [...past.slice(0, -1), merged], future: [] });
      return;
    }
    set({
      doc: next,
      docSavedToFolder: false,
      past: [...past, { patches, inverse, label, merge, at: now }].slice(-HISTORY_LIMIT),
      future: [],
    });
  },

  beginGesture(label) {
    if (!get().gesture) set({ gesture: { patches: [], inverse: [], label } });
  },

  endGesture() {
    const g = get().gesture;
    if (!g) return;
    set({ gesture: null });
    if (g.patches.length > 0) set({ past: [...get().past, g].slice(-HISTORY_LIMIT), future: [] });
  },

  undo() {
    const { past, doc } = get();
    const entry = past[past.length - 1];
    if (!entry || !doc) return;
    set({
      doc: applyPatches(doc, entry.inverse),
      past: past.slice(0, -1),
      future: [entry, ...get().future],
      docSavedToFolder: false,
    });
    fixSelection();
  },

  redo() {
    const { future, doc } = get();
    const entry = future[0];
    if (!entry || !doc) return;
    set({
      doc: applyPatches(doc, entry.patches),
      past: [...get().past, entry],
      future: future.slice(1),
      docSavedToFolder: false,
    });
    fixSelection();
  },

  addAssets(files, opts) {
    const assets = new Map(get().assets);
    const unsaved = new Set(get().unsavedAssets);
    for (const [path, blob] of files) {
      assets.set(path, blob);
      if (opts?.fromFolder) unsaved.delete(path);
      else unsaved.add(path);
    }
    set({ assets, assetsVersion: get().assetsVersion + 1, unsavedAssets: unsaved });
  },

  select(sel) {
    set({ selection: { ...get().selection, ...sel } });
  },
  setHover(hover) {
    const h = get().hover;
    if (h.screen !== hover.screen || h.layer !== hover.layer) set({ hover });
  },
  setFolder: (folder) => set({ folder }),
  setLocale: (locale) => set({ locale }),
  setTarget: (target) => set({ target }),
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.25, zoom)) }),
  markFolderSaved: () => set({ unsavedAssets: new Set(), docSavedToFolder: true }),
}));

/** Keeps the selection pointing at something that exists after undo and redo. */
function fixSelection() {
  const { doc, selection, select } = useEditor.getState();
  if (!doc) return;
  const screen = doc.screens.find((s) => s.id === selection.screen) ?? doc.screens[0];
  const layer =
    screen && selection.layer !== null && selection.layer < screen.layers.length ? selection.layer : null;
  select({ screen: screen?.id ?? null, layer });
}

/** The selected screen, or null. */
export function useSelectedScreen() {
  return useEditor((s) => s.doc?.screens.find((x) => x.id === s.selection.screen) ?? null);
}

export function useTarget() {
  return useEditor((s) => s.doc?.targets.find((t) => t.id === s.target) ?? s.doc?.targets[0] ?? null);
}
