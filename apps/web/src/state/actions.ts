import type { DeviceLayer, Layer, Project, TextLayer } from "@storeshots/schema";
import { captionKey } from "@storeshots/schema";
import { CATALOG, findFrame } from "@storeshots/frames";
import { frameAspect } from "@storeshots/core";
import { freshScreenId, useEditor } from "./store.ts";
import { saveAssets } from "./persist.ts";
import { applyTemplate, DEFAULT_FRAME, fetchBundledFonts } from "./templates.ts";
import { decodeImage } from "../engine/host.ts";

const S = () => useEditor.getState();

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

export function addScreen(afterId?: string) {
  const doc = S().doc;
  if (!doc) return;
  const id = freshScreenId(doc);
  const from = doc.screens.find((s) => s.id === afterId) ?? doc.screens[doc.screens.length - 1];
  S().edit("Add screen", (d) => {
    const at = from ? d.screens.findIndex((s) => s.id === from.id) + 1 : d.screens.length;
    // A new screen copies the layout of its neighbour with fresh captions
    // and no capture, so a set stays consistent by default.
    const layers: Layer[] = structuredClone(from?.layers ?? []).map((l: Layer, i: number) => {
      if (l.type === "device") return { ...l, capture: "" };
      if (l.type === "text") {
        const key = `${id}.${i === 0 ? "title" : `text-${i}`}`;
        d.captions[key] = { [d.locales.default]: i === 0 ? "Say what this screen does" : "One short line of detail" };
        return { ...l, text: `@caption.${key}` };
      }
      return l;
    });
    d.screens.splice(at, 0, { id, background: structuredClone(from?.background ?? { type: "solid", color: "#FFFFFF" }), layers });
  });
  S().select({ screen: id, layer: null });
  return id;
}

export function duplicateScreen(id: string) {
  const doc = S().doc;
  const src = doc?.screens.find((s) => s.id === id);
  if (!doc || !src) return;
  const nid = freshScreenId(doc);
  S().edit("Duplicate screen", (d) => {
    const layers = structuredClone(src.layers).map((l: Layer) => {
      if (l.type !== "text") return l;
      const key = captionKey(l.text);
      if (!key) return l;
      const nkey = key.startsWith(`${id}.`) ? `${nid}.${key.slice(id.length + 1)}` : `${nid}.${key}`;
      d.captions[nkey] = { ...doc.captions[key] };
      return { ...l, text: `@caption.${nkey}` };
    });
    const at = d.screens.findIndex((s) => s.id === id) + 1;
    d.screens.splice(at, 0, { id: nid, background: structuredClone(src.background), layers });
  });
  S().select({ screen: nid, layer: null });
}

export function deleteScreen(id: string) {
  const doc = S().doc;
  if (!doc || doc.screens.length <= 1) return;
  const index = doc.screens.findIndex((s) => s.id === id);
  S().edit("Delete screen", (d) => {
    const [removed] = d.screens.splice(index, 1);
    // Drop captions only this screen used.
    const used = new Set(d.screens.flatMap((s) => s.layers.flatMap((l) => (l.type === "text" ? [captionKey(l.text)] : []))));
    for (const l of removed?.layers ?? []) {
      const key = l.type === "text" ? captionKey(l.text) : null;
      if (key && !used.has(key)) delete d.captions[key];
    }
  });
  const next = S().doc!.screens[Math.min(index, S().doc!.screens.length - 1)]!;
  S().select({ screen: next.id, layer: null });
}

export function moveScreen(id: string, to: number) {
  S().edit("Reorder screens", (d) => {
    const from = d.screens.findIndex((s) => s.id === id);
    if (from < 0 || to < 0 || to >= d.screens.length || from === to) return;
    const [s] = d.screens.splice(from, 1);
    d.screens.splice(to, 0, s!);
  });
}

/** Copies the selected screen's layout onto every other screen, keeping their content. */
export function applyLayoutToAll(id: string) {
  const doc = S().doc;
  const src = doc?.screens.find((s) => s.id === id);
  if (!doc || !src) return;
  S().edit("Apply layout to all screens", (d) => {
    for (const screen of d.screens) {
      if (screen.id === id) continue;
      const texts = screen.layers.filter((l): l is TextLayer => l.type === "text");
      const devices = screen.layers.filter((l): l is DeviceLayer => l.type === "device");
      let ti = 0;
      let di = 0;
      screen.background = structuredClone(src.background);
      screen.layers = structuredClone(src.layers).map((l: Layer) => {
        if (l.type === "text") {
          const mine = texts[ti++];
          return mine ? { ...l, text: mine.text } : l;
        }
        if (l.type === "device") {
          const mine = devices[di++];
          return { ...l, capture: mine?.capture ?? "" };
        }
        return l;
      });
    }
  });
}

export async function switchTemplate(templateId: string) {
  let fonts: string[] = [];
  S().edit("Change template", (d) => {
    fonts = applyTemplate(d as Project, templateId);
  });
  await ensureFonts(fonts);
}

// Layers -----------------------------------------------------------------

function selected() {
  const { doc, selection } = S();
  const screen = doc?.screens.find((s) => s.id === selection.screen);
  return { doc, screen, layer: screen && selection.layer !== null ? screen.layers[selection.layer] : undefined, index: selection.layer };
}

export function updateLayer(label: string, recipe: (l: Layer) => void, target?: { screen: string; layer: number }) {
  const { selection } = S();
  const screenId = target?.screen ?? selection.screen;
  const index = target?.layer ?? selection.layer;
  if (!screenId || index === null) return;
  S().edit(
    label,
    (d) => {
      const l = d.screens.find((s) => s.id === screenId)?.layers[index];
      if (l) recipe(l as Layer);
    },
    `${label}:${screenId}:${index}`,
  );
}

export function addLayer(type: Layer["type"]) {
  const { doc, screen } = selected();
  if (!doc || !screen) return;
  const target = doc.targets.find((t) => t.id === S().target) ?? doc.targets[0]!;
  const aspect = target.size[0] / target.size[1];
  let layer: Layer;
  let caption: string | null = null;
  if (type === "text") {
    const key = `${screen.id}.text-${Date.now().toString(36)}`;
    caption = key;
    const font = doc.theme.fonts.body ? "$body" : doc.theme.fonts.heading ? "$heading" : "fonts/Poppins-Regular.ttf";
    layer = {
      type: "text", text: `@caption.${key}`, font, size: 0.05, color: "#111111", box: { x: 0.1, y: 0.4, w: 0.8, h: 0.08 },
      rotate: 0, opacity: 1, lineHeight: 1.15, align: "center", valign: "middle", fit: "shrink", balance: true,
    };
    if (font.startsWith("fonts/")) void ensureFonts(["Poppins-Regular.ttf"]);
  } else if (type === "device") {
    const frame = findFrame(DEFAULT_FRAME)!;
    const w = 0.6;
    const h = (w * aspect) / frameAspect(frame);
    layer = { type: "device", frame: DEFAULT_FRAME, capture: "", box: { x: 0.2, y: Math.max(0.02, (1 - h) / 2), w, h }, rotate: 0, opacity: 1, shadow: true };
  } else if (type === "shape") {
    layer = { type: "shape", shape: "rect", color: "#FFFFFF", radius: 0.03, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 }, rotate: 0, opacity: 1 };
  } else {
    return;
  }
  S().edit(`Add ${type}`, (d) => {
    if (caption) d.captions[caption] = { [d.locales.default]: "New caption" };
    d.screens.find((s) => s.id === screen.id)!.layers.push(layer);
  });
  S().select({ layer: S().doc!.screens.find((s) => s.id === screen.id)!.layers.length - 1 });
}

export async function addImageLayer(file: File) {
  const { screen } = selected();
  if (!screen) return;
  const path = uniquePath(`images/${safeName(file.name)}`);
  await addProjectAssets([[path, file]]);
  const bmp = await decodeImage(file);
  const doc = S().doc!;
  const t = doc.targets.find((x) => x.id === S().target) ?? doc.targets[0]!;
  const w = 0.5;
  const h = (w * t.size[0] * (bmp.height / bmp.width)) / t.size[1];
  S().edit("Add image", (d) => {
    d.screens.find((s) => s.id === screen.id)!.layers.push({
      type: "image", src: path, fit: "contain", radius: 0, box: { x: 0.25, y: Math.max(0, (1 - h) / 2), w, h }, rotate: 0, opacity: 1,
    });
  });
  S().select({ layer: S().doc!.screens.find((s) => s.id === screen.id)!.layers.length - 1 });
}

export function deleteLayer() {
  const { screen, index } = selected();
  if (!screen || index === null) return;
  S().edit("Delete layer", (d) => {
    d.screens.find((s) => s.id === screen.id)!.layers.splice(index, 1);
  });
  S().select({ layer: null });
}

export function duplicateLayer() {
  const { doc, screen, layer, index } = selected();
  if (!doc || !screen || !layer || index === null) return;
  S().edit("Duplicate layer", (d) => {
    const copy = structuredClone(layer) as Layer;
    copy.box = { ...copy.box, x: copy.box.x + 0.03, y: copy.box.y + 0.02 };
    if (copy.type === "text") {
      const key = captionKey(copy.text);
      if (key) {
        const nkey = `${key}-copy-${Date.now().toString(36)}`;
        d.captions[nkey] = { ...doc.captions[key] };
        copy.text = `@caption.${nkey}`;
      }
    }
    d.screens.find((s) => s.id === screen.id)!.layers.splice(index + 1, 0, copy);
  });
  S().select({ layer: index + 1 });
}

export function moveLayer(delta: number) {
  const { screen, index } = selected();
  if (!screen || index === null) return;
  const to = index + delta;
  if (to < 0 || to >= screen.layers.length) return;
  S().edit(delta > 0 ? "Bring forward" : "Send backward", (d) => {
    const layers = d.screens.find((s) => s.id === screen.id)!.layers;
    const [l] = layers.splice(index, 1);
    layers.splice(to, 0, l!);
  });
  S().select({ layer: to });
}

/** The text a layer shows in the current locale. */
export function layerText(doc: Project, l: TextLayer, locale: string): string {
  const key = captionKey(l.text);
  if (!key) return l.text;
  const entry = doc.captions[key];
  return entry?.[locale] ?? entry?.[doc.locales.default] ?? "";
}

export function setLayerText(screenId: string, index: number, value: string) {
  const { doc, locale } = S();
  const l = doc?.screens.find((s) => s.id === screenId)?.layers[index];
  if (!doc || !l || l.type !== "text") return;
  const key = captionKey(l.text);
  S().edit("Edit text", (d) => {
    if (key) {
      d.captions[key] ??= {};
      d.captions[key]![locale] = value;
    } else {
      (d.screens.find((s) => s.id === screenId)!.layers[index] as TextLayer).text = value;
    }
  }, `text:${screenId}:${index}:${locale}`);
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

/**
 * Picks the catalog frame for a capture: one whose display is exactly the
 * capture's resolution wins; otherwise keep the current frame if its shape
 * fits, else take the first frame of the right shape.
 */
function frameFor(current: string, width: number, height: number): string {
  const cur = findFrame(current);
  if (!cur) return current; // an imported skin: the person chose it
  const exact = (id: string) => {
    const f = findFrame(id);
    return !!f && f.display[0] === width && f.display[1] === height;
  };
  if (exact(current)) return current;
  const match = CATALOG.find((f) => exact(f.id));
  if (match) return match.id;
  const fits = (f: { display: [number, number] }) => Math.abs(f.display[0] / f.display[1] - width / height) < 0.01;
  if (fits(cur)) return current;
  return CATALOG.find(fits)?.id ?? current;
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
  S().edit("Set screenshot", (d) => {
    const l = d.screens.find((s) => s.id === screenId)?.layers[layerIndex];
    if (l?.type !== "device") return;
    l.capture = capture.name;
    if (typeof l.frame === "string") {
      const next = frameFor(l.frame, capture.width, capture.height);
      if (next !== l.frame) {
        const doc = S().doc!;
        const t = doc.targets.find((x) => x.id === S().target) ?? doc.targets[0]!;
        const cx = l.box.x + l.box.w / 2;
        const bottom = l.box.y + l.box.h;
        l.frame = next;
        l.variant = undefined;
        l.box.h = (l.box.w * t.size[0]) / t.size[1] / frameAspect(findFrame(next)!);
        l.box.x = cx - l.box.w / 2;
        l.box.y = bottom - l.box.h;
      }
    }
  });
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
