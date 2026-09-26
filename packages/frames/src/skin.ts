import type { BitmapFrame } from "./types.ts";

type Tree = { [key: string]: string | number | Tree };

/** Parses the Android Emulator's brace-delimited `layout` format. */
export function parseSkinLayout(text: string): Tree {
  const tokens = text.match(/\{|\}|[^\s{}]+/g) ?? [];
  const root: Tree = {};
  const stack: Tree[] = [];
  let cur = root;
  for (let i = 0; i < tokens.length; ) {
    const tok = tokens[i]!;
    if (tok === "}") {
      const parent = stack.pop();
      if (!parent) throw new Error("layout: unbalanced '}'");
      cur = parent;
      i += 1;
    } else if (tokens[i + 1] === "{") {
      const child: Tree = {};
      cur[tok] = child;
      stack.push(cur);
      cur = child;
      i += 2;
    } else {
      const value = tokens[i + 1] ?? "";
      cur[tok] = /^-?\d+$/.test(value) ? Number(value) : value;
      i += 2;
    }
  }
  return root;
}

const isTree = (v: unknown): v is Tree => typeof v === "object" && v !== null;
const num = (t: Tree, k: string, d = 0) => (typeof t[k] === "number" ? (t[k] as number) : d);

/**
 * Builds a bitmap frame from a skin's `layout` text. Image paths are
 * returned relative to the skin folder; the caller copies them.
 */
export function skinToFrame(id: string, layoutText: string): BitmapFrame {
  const tree = parseSkinLayout(layoutText);
  const parts = tree.parts;
  const layouts = tree.layouts;
  if (!isTree(parts) || !isTree(layouts)) throw new Error("layout: missing parts or layouts");
  const device = parts.device;
  if (!isTree(device) || !isTree(device.display)) throw new Error("layout: missing parts.device.display");
  const display = device.display;

  // Unfolded foldable skins have no "portrait" layout; take the first.
  const layout = isTree(layouts.portrait) ? layouts.portrait : Object.values(layouts).find(isTree);
  if (!layout) throw new Error("layout: no layouts");

  const offsets = new Map<string, [number, number]>();
  for (const part of Object.values(layout)) {
    if (isTree(part) && typeof part.name === "string") offsets.set(part.name, [num(part, "x"), num(part, "y")]);
  }
  const [dx, dy] = offsets.get("device") ?? [0, 0];

  let background: BitmapFrame["background"] | undefined;
  let mask: BitmapFrame["mask"];
  for (const [name, part] of Object.entries(parts)) {
    if (name === "device" || !isTree(part)) continue;
    const bg = part.background;
    if (isTree(bg) && typeof bg.image === "string") {
      const [x, y] = offsets.get(name) ?? [0, 0];
      background = { src: bg.image, x, y };
      const fg = part.foreground;
      if (isTree(fg) && typeof fg.mask === "string") mask = { src: fg.mask };
      break;
    }
  }
  if (!background) throw new Error("layout: no background image");

  const w = num(display, "width");
  const h = num(display, "height");
  return {
    kind: "bitmap",
    id,
    name: id,
    platform: "android",
    size: [num(layout, "width"), num(layout, "height")],
    display: [w, h],
    screen: { x: dx + num(display, "x"), y: dy + num(display, "y"), w, h, radius: num(display, "corner_radius") },
    background,
    mask,
  };
}
