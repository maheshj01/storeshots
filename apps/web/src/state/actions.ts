import type { Layer, Project } from "@storeshots/schema";
import * as ops from "@storeshots/ops";
import type { Background } from "@storeshots/schema";
import { selectedLayerRefs, selectedScreenIds, useEditor } from "./store.ts";
import { saveAssets } from "./persist.ts";
import { fetchBundledFonts } from "./fonts.ts";
import { decodeImage } from "../engine/host.ts";

/**
 * Editor actions: each runs a shared edit operation from @storeshots/ops as
 * one undoable step, then updates the selection. The same operations back
 * the MCP server, so agents and people edit projects identically.
 */

const S = () => useEditor.getState();
const target = () => {
  const doc = S().doc!;
  return doc.targets.find((t) => t.id === S().target) ?? doc.targets[0]!;
};

export const layerText = ops.layerText;

/** Adds files to the project and persists them. */
export async function addProjectAssets(files: Array<[string, Blob]>) {
  S().addAssets(files);
  const id = S().projectId;
  if (id) await saveAssets(id, files);
}

/** Makes sure bundled fonts used by the theme or a layer are in the project. */
export async function ensureFonts(files: string[]) {
  const missing = files.filter((f) => !S().assets.has(`fonts/${f}`));
  if (missing.length) await addProjectAssets(await fetchBundledFonts(missing));
}

// Screens ----------------------------------------------------------------

export function addScreen(afterId?: string): string | undefined {
  if (!S().doc) return;
  let id = "";
  S().edit("Add screen", (d) => void (id = ops.addScreen(d as Project, afterId)));
  S().select({ screen: id, layer: null });
  return id;
}

export function duplicateScreen(id: string) {
  let nid = "";
  S().edit("Duplicate screen", (d) => void (nid = ops.duplicateScreen(d as Project, id)));
  if (nid) S().select({ screen: nid, layer: null });
}

export function deleteScreen(id: string) {
  const doc = S().doc;
  if (!doc || doc.screens.length <= 1) return;
  const index = doc.screens.findIndex((s) => s.id === id);
  S().edit("Delete screen", (d) => ops.deleteScreen(d as Project, id));
  const next = S().doc!.screens[Math.min(index, S().doc!.screens.length - 1)]!;
  S().select({ screen: next.id, layer: null });
}

export function moveScreen(id: string, to: number) {
  const doc = S().doc;
  if (!doc || to < 0 || to >= doc.screens.length) return;
  S().edit("Reorder screens", (d) => ops.moveScreen(d as Project, id, to));
}

export function applyLayoutToAll(id: string) {
  S().edit("Copy layout to every screen", (d) => ops.applyLayoutToAll(d as Project, id));
}

/**
 * Re-lays out screens with a template: the given ones, or every screen,
 * which also makes the template the project's theme.
 */
export async function switchTemplate(templateId: string, screenIds?: string[]) {
  let fonts: string[] = [];
  S().edit(screenIds ? "Change layout" : "Change template", (d) => void (fonts = ops.applyTemplate(d as Project, templateId, screenIds)));
  await ensureFonts(fonts);
}

/** Changes the background of every selected screen. */
export function updateBackground(label: string, fn: (b: Background) => Background) {
  const ids = selectedScreenIds(S().selection);
  S().edit(
    label,
    (d) => {
      for (const s of d.screens) if (ids.includes(s.id)) s.background = fn(s.background as Background);
    },
    `bg:${ids.join(",")}:${label}`,
  );
}

// Layers -----------------------------------------------------------------

function selected() {
  const { doc, selection } = S();
  const screen = doc?.screens.find((s) => s.id === selection.screen);
  return { doc, screen, index: selection.layer };
}

/**
 * Changes a layer: the one given, or every selected layer. Recipes check
 * the layer's type, so a setting only lands on layers that have it.
 */
export function updateLayer(label: string, recipe: (l: Layer) => void, at?: { screen: string; layer: number }) {
  const refs = at ? [at] : selectedLayerRefs(S().selection);
  if (!refs.length) return;
  S().edit(
    label,
    (d) => {
      for (const r of refs) {
        const l = d.screens.find((s) => s.id === r.screen)?.layers[r.layer];
        if (l) recipe(l as Layer);
      }
    },
    `${label}:${refs.map((r) => `${r.screen}:${r.layer}`).join(",")}`,
  );
}

export function addLayer(type: Layer["type"]) {
  const { doc, screen } = selected();
  if (!doc || !screen) return;
  let index = 0;
  S().edit(`Add ${type}`, (d) => void (index = ops.addLayer(d as Project, screen.id, type, target())));
  const layer = S().doc!.screens.find((s) => s.id === screen.id)!.layers[index]!;
  if (layer.type === "text" && layer.font.startsWith("fonts/")) void ensureFonts([layer.font.slice(6)]);
  S().select({ layer: index });
}

export async function addImageLayer(file: File) {
  const { screen } = selected();
  if (!screen) return;
  const path = uniquePath(`images/${safeName(file.name)}`);
  await addProjectAssets([[path, file]]);
  const bmp = await decodeImage(file);
  const t = target();
  const w = 0.5;
  const h = (w * t.size[0] * (bmp.height / bmp.width)) / t.size[1];
  let index = 0;
  S().edit("Add image", (d) => {
    index = ops.addLayer(d as Project, screen.id, "image", t, { src: path, box: { x: 0.25, y: Math.max(0, (1 - h) / 2), w, h } } as Partial<Layer>);
  });
  S().select({ layer: index });
}

/** Deletes every selected layer, as one undo step. */
export function deleteLayer() {
  const refs = selectedLayerRefs(S().selection);
  if (!refs.length) return;
  // From the top of each stack down, so earlier deletions don't shift later indices.
  const order = [...refs].sort((a, b) => b.layer - a.layer);
  S().edit(refs.length > 1 ? `Delete ${refs.length} layers` : "Delete layer", (d) => {
    for (const r of order) ops.deleteLayer(d as Project, r.screen, r.layer);
  });
  S().select({ screen: refs[0]!.screen, layer: null });
}

export function duplicateLayer() {
  const { screen, index } = selected();
  if (!screen || index === null) return;
  let next = index;
  S().edit("Duplicate layer", (d) => void (next = ops.duplicateLayer(d as Project, screen.id, index)));
  S().select({ layer: next });
}

/** Moves the selected layer to a stacking position (0 = bottom) and keeps it selected. */
export function moveLayerTo(screenId: string, index: number, to: number) {
  const screen = S().doc?.screens.find((s) => s.id === screenId);
  if (!screen || to < 0 || to >= screen.layers.length || to === index) return;
  const label = to === screen.layers.length - 1 ? "Bring to front" : to === 0 ? "Send to back" : "Reorder layers";
  S().edit(label, (d) => ops.moveLayer(d as Project, screenId, index, to));
  S().select({ screen: screenId, layer: to });
}

export function setLayerText(screenId: string, index: number, value: string) {
  const { locale } = S();
  S().edit("Edit text", (d) => ops.setLayerText(d as Project, screenId, index, locale, value), `text:${screenId}:${index}:${locale}`);
}

// Captures ---------------------------------------------------------------

export function safeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "image";
  const ext = (dot > 0 ? name.slice(dot + 1) : "png").toLowerCase();
  return `${base}.${ext}`;
}

function uniquePath(path: string): string {
  const assets = S().assets;
  if (!assets.has(path)) return path;
  const dot = path.lastIndexOf(".");
  for (let n = 2; ; n++) {
    const p = `${path.slice(0, dot)}_${n}${path.slice(dot)}`;
    if (!assets.has(p)) return p;
  }
}

/** Stores captures under captures/<default locale>/ and returns their file names. */
export async function storeCaptures(files: File[]): Promise<Array<{ name: string; width: number; height: number }>> {
  const doc = S().doc;
  if (!doc) return [];
  const out: Array<{ name: string; width: number; height: number }> = [];
  const entries: Array<[string, Blob]> = [];
  for (const file of files) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) continue;
    const name = uniquePath(`captures/${doc.locales.default}/${safeName(file.name)}`).split("/").pop()!;
    const bmp = await decodeImage(file);
    entries.push([`captures/${doc.locales.default}/${name}`, file]);
    out.push({ name, width: bmp.width, height: bmp.height });
  }
  await addProjectAssets(entries);
  return out;
}

export function setCapture(screenId: string, layerIndex: number, capture: { name: string; width: number; height: number }) {
  const t = target();
  S().edit("Set screenshot", (d) => ops.setCapture(d as Project, screenId, layerIndex, capture, t));
}

/**
 * Drops screenshots onto the listing: fills devices that have no capture,
 * in order, then adds screens for the rest.
 */
export async function fillWithCaptures(files: File[], startScreen?: string) {
  const stored = await storeCaptures(files);
  for (const cap of stored) {
    const doc = S().doc!;
    const start = Math.max(0, doc.screens.findIndex((s) => s.id === startScreen));
    let placed = false;
    for (const screen of doc.screens.slice(start)) {
      const i = screen.layers.findIndex((l) => l.type === "device" && !l.capture);
      if (i >= 0) {
        setCapture(screen.id, i, cap);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const id = addScreen(doc.screens[doc.screens.length - 1]?.id);
      const screen = S().doc!.screens.find((s) => s.id === id)!;
      const i = screen.layers.findIndex((l) => l.type === "device");
      if (i >= 0) setCapture(screen.id, i, cap);
    }
  }
  return stored.length;
}

/** Captures in the project, from the default locale folder. */
export function captureList(assets: Map<string, Blob>, locale: string): string[] {
  const prefix = `captures/${locale}/`;
  return [...assets.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)).sort();
}

export async function addFont(file: File): Promise<string | null> {
  if (!/\.(ttf|otf)$/i.test(file.name)) return null;
  const path = uniquePath(`fonts/${file.name.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
  await addProjectAssets([[path, file]]);
  return path;
}

// Theme colours ------------------------------------------------------------

export function addThemeColor(value = "#888888"): string {
  let name = "";
  S().edit("Add theme colour", (d) => {
    name = ops.freshThemeColorName(d as Project);
    d.theme.colors[name] = value;
  });
  return name;
}

/** Renames a theme colour everywhere; returns an error message if the name can't be used. */
export function renameThemeColor(from: string, to: string): string | null {
  try {
    ops.renameThemeColor(structuredClone(S().doc!) as Project, from, to);
  } catch (e) {
    return (e as Error).message;
  }
  S().edit("Rename theme colour", (d) => ops.renameThemeColor(d as Project, from, to));
  return null;
}

export function deleteThemeColor(name: string) {
  S().edit("Remove theme colour", (d) => ops.deleteThemeColor(d as Project, name));
}
