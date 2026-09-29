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

/** One selected thing: a layer, or a whole screen when `layer` is null. */
export interface SelectionRef {
  screen: string;
  layer: number | null;
}

/**
 * The selection: the primary item (the last one clicked, whose values the
 * inspector shows) plus any others added with Shift. Everything selected is
 * the same kind: all layers (from any screens) or all screens.
 */
export interface MultiSelection extends Selection {
  more: SelectionRef[];
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

  selection: MultiSelection;
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
  /** Selects one thing, dropping anything added with Shift. */
  select(sel: Partial<Selection>): void;
  /** Shift-click: adds an item to the selection, or takes it out if it's in. */
  toggleSelect(ref: SelectionRef): void;
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
  selection: { screen: null, layer: null, more: [] },
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
      selection: { screen: doc.screens[0]?.id ?? null, layer: null, more: [] },
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
    const { screen, layer } = get().selection;
    set({ selection: { screen, layer, ...sel, more: [] } });
  },
  toggleSelect(ref) {
    const all = selectedRefs(get().selection);
    const kind = (r: SelectionRef) => r.layer !== null;
    if (all.length === 0 || kind(all[0]!) !== kind(ref)) return get().select(ref);
    const same = (r: SelectionRef) => r.screen === ref.screen && r.layer === ref.layer;
    if (all.some(same)) {
      const rest = all.filter((r) => !same(r));
      const [head, ...more] = rest;
      if (!head) return get().select(ref.layer === null ? { screen: null, layer: null } : { screen: ref.screen, layer: null });
      return set({ selection: { screen: head.screen, layer: head.layer, more } });
    }
    set({ selection: { screen: ref.screen, layer: ref.layer, more: all } });
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

/** Everything selected, primary first. */
export function selectedRefs(sel: MultiSelection): SelectionRef[] {
  return sel.screen ? [{ screen: sel.screen, layer: sel.layer }, ...sel.more] : [];
}

/** Keeps the selection pointing at things that exist, after undo, redo or an outside change. */
export function fixSelection() {
  const { doc, selection } = useEditor.getState();
  if (!doc) return;
  const exists = (r: SelectionRef) => {
    const s = doc.screens.find((x) => x.id === r.screen);
    return !!s && (r.layer === null || r.layer < s.layers.length);
  };
  const refs = selectedRefs(selection).filter(exists);
  if (refs.length) {
    const [head, ...more] = refs;
    return useEditor.setState({ selection: { screen: head!.screen, layer: head!.layer, more } });
  }
  // The primary layer is gone: fall back to its screen, if that's still there.
  const screen = doc.screens.find((s) => s.id === selection.screen);
  useEditor.setState({ selection: { screen: screen?.id ?? null, layer: null, more: [] } });
}

/** The selected layers, primary first; empty when screens are selected. */
export function selectedLayerRefs(sel: MultiSelection): Array<{ screen: string; layer: number }> {
  return sel.layer === null ? [] : (selectedRefs(sel) as Array<{ screen: string; layer: number }>);
}

/** The selected screen ids, primary first; empty when layers are selected. */
export function selectedScreenIds(sel: MultiSelection): string[] {
  return sel.layer === null ? selectedRefs(sel).map((r) => r.screen) : [];
}

/** Whether a layer is part of the selection. */
export function isLayerSelected(sel: MultiSelection, screen: string, layer: number): boolean {
  return sel.layer !== null && selectedRefs(sel).some((r) => r.screen === screen && r.layer === layer);
}

/** The selected screen, or null. */
export function useSelectedScreen() {
  return useEditor((s) => s.doc?.screens.find((x) => x.id === s.selection.screen) ?? null);
}

export function useTarget() {
  return useEditor((s) => s.doc?.targets.find((t) => t.id === s.target) ?? s.doc?.targets[0] ?? null);
}
