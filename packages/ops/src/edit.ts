import { captionKey, type DeviceLayer, type Layer, type Project, type Screen, type TextLayer } from "@storeshots/schema";
import { CATALOG, findFrame } from "@storeshots/frames";
import { frameAspect } from "@storeshots/core";
import { DEFAULT_FRAME } from "./templates.ts";

/**
 * Editing operations shared by the editor and the MCP server. Each one
 * mutates the project it is given, so it works on a plain object and on an
 * Immer draft alike, and throws an Error with an actionable message when
 * the request can't be applied.
 */

/** Deep copy that also works on Immer drafts (structuredClone doesn't). */
export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function getScreen(p: Project, id: string): Screen {
  const s = p.screens.find((x) => x.id === id);
  if (!s) throw new Error(`no screen "${id}"; screens are ${p.screens.map((x) => x.id).join(", ")}`);
  return s;
}

export function getLayer(p: Project, screenId: string, index: number): Layer {
  const s = getScreen(p, screenId);
  const l = s.layers[index];
  if (!l) throw new Error(`screen "${screenId}" has no layer ${index}; it has layers 0 to ${s.layers.length - 1}`);
  return l;
}

/** A screen id not yet used in the project. */
export function freshScreenId(p: Project, base = "screen"): string {
  const ids = new Set(p.screens.map((s) => s.id));
  for (let n = p.screens.length + 1; ; n++) {
    const id = `${base}-${n}`;
    if (!ids.has(id)) return id;
  }
}

// Screens ----------------------------------------------------------------

/**
 * Adds a screen after `afterId` (default: the last), copying that screen's
 * layout with fresh placeholder captions and no captures. Returns its id.
 */
export function addScreen(p: Project, afterId?: string, id = freshScreenId(p)): string {
  if (p.screens.some((s) => s.id === id)) throw new Error(`screen "${id}" already exists`);
  const from = afterId ? getScreen(p, afterId) : p.screens[p.screens.length - 1];
  const at = from ? p.screens.indexOf(from) + 1 : p.screens.length;
  const layers: Layer[] = clone(from?.layers ?? []).map((l, i) => {
    if (l.type === "device") return { ...l, capture: "" };
    if (l.type === "text") {
      const key = `${id}.${i === 0 ? "title" : `text-${i}`}`;
      p.captions[key] = { [p.locales.default]: i === 0 ? "Say what this screen does" : "One short line of detail" };
      return { ...l, text: `@caption.${key}` };
    }
    return l;
  });
  p.screens.splice(at, 0, { id, background: clone(from?.background ?? { type: "solid", color: "#FFFFFF" }), layers });
  return id;
}

/** Copies a screen, with its own copies of the captions. Returns the new id. */
export function duplicateScreen(p: Project, id: string): string {
  const src = getScreen(p, id);
  const nid = freshScreenId(p);
  const layers = clone(src.layers).map((l) => {
    if (l.type !== "text") return l;
    const key = captionKey(l.text);
    if (!key) return l;
    const nkey = key.startsWith(`${id}.`) ? `${nid}.${key.slice(id.length + 1)}` : `${nid}.${key}`;
    p.captions[nkey] = clone(p.captions[key] ?? {});
    return { ...l, text: `@caption.${nkey}` };
  });
  p.screens.splice(p.screens.indexOf(src) + 1, 0, { id: nid, background: clone(src.background), layers });
  return nid;
}

/** Deletes a screen and captions nothing else uses. The last screen can't be deleted. */
export function deleteScreen(p: Project, id: string) {
  const src = getScreen(p, id);
  if (p.screens.length <= 1) throw new Error("a project needs at least one screen");
  p.screens.splice(p.screens.indexOf(src), 1);
  const used = new Set(p.screens.flatMap((s) => s.layers.flatMap((l) => (l.type === "text" ? [captionKey(l.text)] : []))));
  for (const l of src.layers) {
    const key = l.type === "text" ? captionKey(l.text) : null;
    if (key && !used.has(key)) delete p.captions[key];
  }
}

export function moveScreen(p: Project, id: string, to: number) {
  const from = p.screens.indexOf(getScreen(p, id));
  if (to < 0 || to >= p.screens.length) throw new Error(`position ${to} is out of range 0 to ${p.screens.length - 1}`);
  const [s] = p.screens.splice(from, 1);
  p.screens.splice(to, 0, s!);
}

/** Copies one screen's background and layer positions onto every other screen, keeping their text and captures. */
export function applyLayoutToAll(p: Project, id: string) {
  const src = clone(getScreen(p, id));
  for (const screen of p.screens) {
    if (screen.id === id) continue;
    const texts = screen.layers.filter((l): l is TextLayer => l.type === "text");
    const devices = screen.layers.filter((l): l is DeviceLayer => l.type === "device");
    let ti = 0;
    let di = 0;
    screen.background = clone(src.background);
    screen.layers = clone(src.layers).map((l) => {
      if (l.type === "text") {
        const mine = texts[ti++];
        return mine ? { ...l, text: mine.text } : l;
      }
      if (l.type === "device") return { ...l, capture: devices[di++]?.capture ?? "" };
      return l;
    });
  }
}

// Layers -----------------------------------------------------------------

export interface TargetSize {
  /** Output width and height in px, to keep device boxes the frame's shape. */
  size: [number, number];
}

/** A new layer of a type with sensible defaults. Text layers get a caption key. */
export function addLayer(p: Project, screenId: string, type: Layer["type"], target: TargetSize, init: Partial<Layer> = {}, at?: number): number {
  const screen = getScreen(p, screenId);
  const aspect = target.size[0] / target.size[1];
  let layer: Layer;
  if (type === "text") {
    const key = `${screenId}.text-${Date.now().toString(36)}`;
    p.captions[key] = { [p.locales.default]: "New caption" };
    const font = p.theme.fonts.body ? "$body" : p.theme.fonts.heading ? "$heading" : "fonts/Poppins-Regular.ttf";
    layer = {
      type: "text", text: `@caption.${key}`, font, size: 0.05, color: "#111111", box: { x: 0.1, y: 0.4, w: 0.8, h: 0.08 },
      rotate: 0, opacity: 1, lineHeight: 1.15, align: "center", valign: "middle", fit: "shrink", balance: true,
    };
  } else if (type === "device") {
    const frame = findFrame(DEFAULT_FRAME)!;
    const w = 0.6;
    const h = (w * aspect) / frameAspect(frame);
    layer = { type: "device", frame: DEFAULT_FRAME, capture: "", box: { x: 0.2, y: Math.max(0.02, (1 - h) / 2), w, h }, rotate: 0, opacity: 1, shadow: true };
  } else if (type === "shape") {
    layer = { type: "shape", shape: "rect", color: "#FFFFFF", radius: 0.03, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 }, rotate: 0, opacity: 1 };
  } else {
    layer = { type: "image", src: "", fit: "contain", radius: 0, box: { x: 0.25, y: 0.35, w: 0.5, h: 0.3 }, rotate: 0, opacity: 1 };
  }
  Object.assign(layer, init, { type });
  const index = at === undefined ? screen.layers.length : Math.max(0, Math.min(at, screen.layers.length));
  screen.layers.splice(index, 0, layer);
  return index;
}

export function deleteLayer(p: Project, screenId: string, index: number) {
  getLayer(p, screenId, index);
  getScreen(p, screenId).layers.splice(index, 1);
}

/** Copies a layer just above itself, nudged so both are visible. Text gets its own caption. Returns the new index. */
export function duplicateLayer(p: Project, screenId: string, index: number): number {
  const copy = clone(getLayer(p, screenId, index));
  copy.box = { ...copy.box, x: copy.box.x + 0.03, y: copy.box.y + 0.02 };
  if (copy.type === "text") {
    const key = captionKey(copy.text);
    if (key) {
      const nkey = `${key}-copy-${Date.now().toString(36)}`;
      p.captions[nkey] = clone(p.captions[key] ?? {});
      copy.text = `@caption.${nkey}`;
    }
  }
  getScreen(p, screenId).layers.splice(index + 1, 0, copy);
  return index + 1;
}

/** Moves a layer in the stacking order; 0 is the bottom. */
export function moveLayer(p: Project, screenId: string, index: number, to: number) {
  const layers = getScreen(p, screenId).layers;
  getLayer(p, screenId, index);
  if (to < 0 || to >= layers.length) throw new Error(`position ${to} is out of range 0 to ${layers.length - 1}`);
  const [l] = layers.splice(index, 1);
  layers.splice(to, 0, l!);
}

/** The text a layer shows in a locale, falling back to the default locale. */
export function layerText(p: Project, l: TextLayer, locale: string): string {
  const key = captionKey(l.text);
  if (!key) return l.text;
  const entry = p.captions[key];
  return entry?.[locale] ?? entry?.[p.locales.default] ?? "";
}

/** Sets a text layer's words for a locale: its caption if it has one, else the literal text. */
export function setLayerText(p: Project, screenId: string, index: number, locale: string, value: string) {
  const l = getLayer(p, screenId, index);
  if (l.type !== "text") throw new Error(`layer ${index} of "${screenId}" is a ${l.type} layer, not text`);
  const key = captionKey(l.text);
  if (key) {
    p.captions[key] ??= {};
    p.captions[key]![locale] = value;
  } else if (locale === p.locales.default) {
    l.text = value;
  } else {
    // Literal text can't vary by locale; turn it into a caption first.
    const nkey = `${screenId}.text-${index}`;
    p.captions[nkey] = { [p.locales.default]: l.text, [locale]: value };
    l.text = `@caption.${nkey}`;
  }
}

// Captures ---------------------------------------------------------------

/**
 * Picks the catalog frame for a capture: one whose display is exactly the
 * capture's resolution wins; otherwise keep the current frame if its shape
 * fits, else take the first frame of the right shape.
 */
export function frameFor(current: string, width: number, height: number): string {
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

/**
 * Puts a capture on a device layer. If another catalog frame matches the
 * capture better, switches to it, keeping the device's width, centre and
 * bottom edge.
 */
export function setCapture(p: Project, screenId: string, index: number, capture: { name: string; width: number; height: number }, target: TargetSize) {
  const l = getLayer(p, screenId, index);
  if (l.type !== "device") throw new Error(`layer ${index} of "${screenId}" is a ${l.type} layer, not a device`);
  l.capture = capture.name;
  if (typeof l.frame !== "string") return;
  const next = frameFor(l.frame, capture.width, capture.height);
  if (next === l.frame) return;
  const cx = l.box.x + l.box.w / 2;
  const bottom = l.box.y + l.box.h;
  l.frame = next;
  l.variant = undefined;
  l.box.h = (l.box.w * target.size[0]) / target.size[1] / frameAspect(findFrame(next)!);
  l.box.x = cx - l.box.w / 2;
  l.box.y = bottom - l.box.h;
}

// Theme colours -----------------------------------------------------------

/** Names a theme colour can have: a letter, then letters, digits, _ or -. */
export const THEME_COLOR_NAME = /^[A-Za-z][\w-]*$/;

/** Replaces every `$name` colour reference in the screens and the theme. */
function replaceColorRefs(p: Project, name: string, next: string) {
  const ref = `$${name}`;
  const walk = (v: unknown): unknown => {
    if (v === ref) return next;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = walk(x);
    }
    return v;
  };
  walk(p.screens);
  walk(p.theme.colors);
}

/** A theme colour's name that isn't taken yet: "colour", "colour2", … */
export function freshThemeColorName(p: Project, base = "colour"): string {
  if (!(base in p.theme.colors)) return base;
  for (let n = 2; ; n++) if (!(`${base}${n}` in p.theme.colors)) return `${base}${n}`;
}

/** Renames a theme colour and every reference to it. */
export function renameThemeColor(p: Project, from: string, to: string) {
  if (from === to) return;
  if (!THEME_COLOR_NAME.test(to)) throw new Error(`"${to}" isn't a valid colour name: use letters, digits, _ or -, starting with a letter`);
  if (to in p.theme.colors) throw new Error(`there's already a theme colour called "${to}"`);
  const value = p.theme.colors[from];
  if (value === undefined) throw new Error(`no theme colour called "${from}"`);
  // Rebuilt so the renamed colour keeps its place in the list.
  p.theme.colors = Object.fromEntries(Object.entries(p.theme.colors).map(([k, v]) => [k === from ? to : k, v]));
  replaceColorRefs(p, from, `$${to}`);
}

/** Removes a theme colour; anything using it keeps the colour as a plain value. */
export function deleteThemeColor(p: Project, name: string) {
  const colors = p.theme.colors;
  let value = colors[name];
  if (value === undefined) return;
  for (let i = 0; i < 5 && value.startsWith("$"); i++) value = colors[value.slice(1)] ?? "#000000";
  delete colors[name];
  replaceColorRefs(p, name, value.startsWith("$") ? "#000000" : value);
}

/** How many places (backgrounds, layers, other theme colours) use a theme colour. */
export function themeColorUses(p: Project, name: string): number {
  return (JSON.stringify([p.screens, p.theme.colors]).match(new RegExp(`"\\$${name.replace(/[-]/g, "\\-")}"`, "g")) ?? []).length;
}
