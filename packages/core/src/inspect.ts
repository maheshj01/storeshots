import {
  resolveColor,
  resolveFont,
  resolveText,
  type Background,
  type DeviceLayer,
  type Layer,
  type Project,
  type Screen,
  type Target,
} from "@storeshots/schema";
import { AssetCache, frameGeometry, type Rect } from "./render.ts";
import { layoutTextBlock } from "./text.ts";

/**
 * What a screen will look like, as facts instead of pixels: where every
 * layer lands in output pixels, how captions wrap and shrink, where phones
 * bleed off the canvas, and what looks wrong. Computed with the renderer's
 * own layout code, so it agrees with the images. Lets agents and tests
 * check a design without rendering or reading a screenshot.
 */
export interface InspectedLayer {
  index: number;
  type: Layer["type"];
  /** The layer box in output pixels. */
  box: Rect;
  rotate: number;
  opacity: number;
  /** Axis-aligned bounds of what is actually drawn, after rotation, in output pixels. */
  bounds: Rect;
  text?: {
    value: string;
    /** `@caption.key` when the words come from captions. */
    caption?: string | undefined;
    font: string;
    requestedSize: number;
    size: number;
    lines: string[];
    overflow: boolean;
    color: string;
    align: string;
    valign: string;
  };
  device?: {
    frame: string;
    variant?: string | undefined;
    capture: string;
    /** The capture file found for this locale, and its size. */
    captureFile?: string | undefined;
    captureSize?: [number, number] | undefined;
    /** The display area, in output pixels (before rotation). */
    screen: Rect;
    /** How far the body extends past each canvas edge, in px; 0 when inside. */
    bleed: { left: number; top: number; right: number; bottom: number };
  };
  shape?: { shape: string; color: string };
  image?: { src: string; fit: string };
}

export interface Finding {
  severity: "error" | "warning" | "info";
  code:
    | "text_overflow"
    | "text_shrunk"
    | "text_clipped"
    | "text_empty"
    | "text_hidden"
    | "text_overlaps_device"
    | "low_contrast"
    | "missing_capture"
    | "capture_mismatch"
    | "offscreen"
    | "device_bleed"
    | "render_error";
  layer?: number | undefined;
  message: string;
}

export interface ScreenInspection {
  screen: string;
  target: string;
  locale: string;
  size: [number, number];
  background: string;
  layers: InspectedLayer[];
  findings: Finding[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const rect = (r: Rect): Rect => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) });

function rotatedBounds(r: Rect, center: Rect, deg: number): Rect {
  if (!deg) return r;
  const cx = center.x + center.w / 2;
  const cy = center.y + center.h / 2;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ].map(([x, y]) => [cx + (x! - cx) * cos - (y! - cy) * sin, cy + (x! - cx) * sin + (y! - cy) * cos] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// Colour ------------------------------------------------------------------

type RGBA = [number, number, number, number];

function parseHex(hex: string): RGBA {
  const v = hex.slice(1);
  const full = v.length === 3 ? [...v].map((c) => c + c).join("") : v;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
}

function over(top: RGBA, bottom: [number, number, number], alpha = 1): [number, number, number] {
  const a = top[3] * alpha;
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The background colour at a point, or null where it depends on an image or screenshot. */
function colorAt(p: Project, screen: Screen, below: InspectedLayer[], W: number, H: number, x: number, y: number): [number, number, number] | null {
  const bg = screen.background;
  let c: [number, number, number];
  if (bg.type === "solid") {
    c = over(parseHex(resolveColor(p, bg.color)), [255, 255, 255]);
  } else if (bg.type === "linear-gradient") {
    // Same geometry as the renderer's CSS-style gradient line.
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const t = Math.min(1, Math.max(0, ((x - W / 2) * dx + (y - H / 2) * dy) / (2 * half) + 0.5));
    const stops = bg.stops.map(([col, at]) => [parseHex(resolveColor(p, col)), at] as const);
    let i = stops.findIndex(([, at]) => at >= t);
    if (i <= 0) i = i === 0 ? 1 : stops.length - 1;
    const [ca, ta] = stops[i - 1]!;
    const [cb, tb] = stops[i]!;
    const k = tb === ta ? 0 : Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
    const mixed: RGBA = [0, 1, 2, 3].map((j) => ca[j]! * (1 - k) + cb[j]! * k) as RGBA;
    c = over(mixed, over(parseHex(resolveColor(p, bg.stops[0]![0])), [255, 255, 255]));
  } else {
    return null;
  }
  for (const l of below) {
    const layer = screen.layers[l.index]!;
    const inside = pointInLayer(l, x, y);
    if (!inside) continue;
    if (layer.type === "shape") c = over(parseHex(resolveColor(p, layer.color)), c, layer.opacity);
    else if (layer.type === "device" || layer.type === "image") return null;
  }
  return c;
}

function pointInLayer(l: InspectedLayer, x: number, y: number): boolean {
  const cx = l.box.x + l.box.w / 2;
  const cy = l.box.y + l.box.h / 2;
  const a = (-l.rotate * Math.PI) / 180;
  const qx = cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
  const qy = cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
  const body = l.device ? unrotatedBody(l) : l.box;
  return qx >= body.x && qx <= body.x + body.w && qy >= body.y && qy <= body.y + body.h;
}

const bodies = new WeakMap<InspectedLayer, Rect>();
function unrotatedBody(l: InspectedLayer): Rect {
  return bodies.get(l) ?? l.box;
}

function describeBackground(p: Project, bg: Background): string {
  if (bg.type === "solid") return `solid ${bg.color}${bg.color.startsWith("$") ? ` (${resolveColor(p, bg.color)})` : ""}`;
  if (bg.type === "linear-gradient") return `gradient ${bg.angle}° ${bg.stops.map(([c, at]) => `${c}@${at}`).join(" → ")}`;
  return `image ${bg.src}`;
}

function frameIdOf(l: DeviceLayer, target: Target): string {
  if (typeof l.frame === "string") return l.frame;
  const id = target.store === "play" ? l.frame.android : l.frame.ios;
  if (!id) throw new Error(`device layer has no ${target.store === "play" ? "android" : "ios"} frame`);
  return id;
}

/** Inspects one screen for one target and locale. */
export async function inspectScreen(
  project: Project,
  req: { screen: string; target?: string | undefined; locale?: string | undefined },
  cache: AssetCache,
): Promise<ScreenInspection> {
  const screen = project.screens.find((s) => s.id === req.screen);
  if (!screen) throw new Error(`no screen "${req.screen}"; screens are ${project.screens.map((s) => s.id).join(", ")}`);
  const target = project.targets.find((t) => t.id === (req.target ?? project.targets[0]!.id));
  if (!target) throw new Error(`no target "${req.target}"; targets are ${project.targets.map((t) => t.id).join(", ")}`);
  const locale = req.locale ?? project.locales.default;
  const [W, H] = target.size;
  const canvas: Rect = { x: 0, y: 0, w: W, h: H };
  const ctx = cache.host.createCanvas(1, 1).getContext("2d")!;
  const layers: InspectedLayer[] = [];
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  for (let i = 0; i < screen.layers.length; i++) {
    const l = screen.layers[i]!;
    const box: Rect = { x: l.box.x * W, y: l.box.y * H, w: l.box.w * W, h: l.box.h * H };
    const out: InspectedLayer = { index: i, type: l.type, box, rotate: l.rotate, opacity: l.opacity, bounds: box };
    try {
      if (l.type === "text") {
        const value = resolveText(project, l.text, locale);
        const font = resolveFont(project, l.font);
        const f = await cache.font(font);
        const layout = layoutTextBlock(ctx, {
          text: value,
          family: f.family,
          size: l.size * W,
          lineHeight: l.lineHeight,
          maxWidth: box.w,
          maxHeight: box.h,
          fit: l.fit,
          balance: l.balance,
        });
        const blockW = Math.max(0, ...layout.lines.map((x) => x.width));
        const blockH = layout.lines.length * layout.size * l.lineHeight;
        const bx = l.align === "left" ? box.x : l.align === "right" ? box.x + box.w - blockW : box.x + (box.w - blockW) / 2;
        const by = l.valign === "top" ? box.y : l.valign === "middle" ? box.y + (box.h - blockH) / 2 : box.y + box.h - blockH;
        out.bounds = rotatedBounds({ x: bx, y: by, w: blockW, h: blockH }, box, l.rotate);
        out.text = {
          value,
          caption: l.text.startsWith("@caption.") ? l.text : undefined,
          font,
          requestedSize: r1(l.size * W),
          size: r1(layout.size),
          lines: layout.lines.map((x) => x.text),
          overflow: layout.overflow,
          color: l.color.startsWith("$") ? `${l.color} (${resolveColor(project, l.color)})` : l.color,
          align: l.align,
          valign: l.valign,
        };
        if (!value.trim()) add({ severity: "warning", code: "text_empty", layer: i, message: `text is empty in "${locale}"` });
        if (layout.overflow) {
          add({ severity: "error", code: "text_overflow", layer: i, message: `"${value}" doesn't fit its ${Math.round(box.w)}×${Math.round(box.h)} box even at ${r1(layout.size)}px; widen or heighten the box or shorten the text` });
        } else if (layout.size < l.size * W * 0.8) {
          add({ severity: "warning", code: "text_shrunk", layer: i, message: `shrunk to ${Math.round((layout.size / (l.size * W)) * 100)}% (${r1(layout.size)}px of ${r1(l.size * W)}px) to fit its box` });
        }
      } else if (l.type === "device") {
        const frameId = frameIdOf(l, target);
        const frame = await cache.frame(frameId);
        const g = frameGeometry(frame, box);
        bodies.set(out, g.body);
        out.bounds = rotatedBounds(g.body, box, l.rotate);
        const found = l.capture ? await cache.capture(project, l.capture, locale) : null;
        out.device = {
          frame: frameId,
          variant: l.variant,
          capture: l.capture,
          captureFile: found?.path,
          captureSize: found ? [found.image.width, found.image.height] : undefined,
          screen: rect(g.screen),
          bleed: {
            left: r1(Math.max(0, -out.bounds.x)),
            top: r1(Math.max(0, -out.bounds.y)),
            right: r1(Math.max(0, out.bounds.x + out.bounds.w - W)),
            bottom: r1(Math.max(0, out.bounds.y + out.bounds.h - H)),
          },
        };
        if (!l.capture) add({ severity: "error", code: "missing_capture", layer: i, message: "device has no screenshot; set one before exporting" });
        else if (!found) add({ severity: "error", code: "missing_capture", layer: i, message: `screenshot "${l.capture}" not found in captures/${locale}/ or its fallbacks` });
        else {
          const [dw, dh] = frame.display;
          if (Math.abs(found.image.width / found.image.height - dw / dh) > 0.01) {
            add({ severity: "warning", code: "capture_mismatch", layer: i, message: `${found.path} is ${found.image.width}×${found.image.height} but ${frame.name} shows ${dw}×${dh}; it will be cropped` });
          }
        }
        const b = out.device.bleed;
        const edges = (["left", "top", "right", "bottom"] as const).filter((k) => b[k] > 0).map((k) => `${Math.round(b[k])}px past the ${k}`);
        if (edges.length) add({ severity: "info", code: "device_bleed", layer: i, message: `phone runs ${edges.join(", ")} edge (cropped in the export)` });
      } else if (l.type === "shape") {
        out.bounds = rotatedBounds(box, box, l.rotate);
        out.shape = { shape: l.shape, color: l.color };
      } else {
        out.bounds = rotatedBounds(box, box, l.rotate);
        out.image = { src: l.src, fit: l.fit };
      }
    } catch (e) {
      add({ severity: "error", code: "render_error", layer: i, message: (e as Error).message });
    }
    if (!intersect(out.bounds, canvas)) add({ severity: "warning", code: "offscreen", layer: i, message: "layer is entirely outside the canvas" });
    layers.push(out);
  }

  // Checks that compare layers.
  for (const t of layers) {
    if (!t.text || !t.text.value.trim()) continue;
    const b = t.bounds;
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5) {
      add({ severity: "error", code: "text_clipped", layer: t.index, message: "text runs past the canvas edge and will be cut off" });
    }
    for (const d of layers) {
      if (!d.device) continue;
      const hit = intersect(b, d.bounds);
      if (!hit) continue;
      const share = Math.round(((hit.w * hit.h) / (b.w * b.h)) * 100);
      if (d.index > t.index) {
        add({ severity: share > 50 ? "error" : "warning", code: "text_hidden", layer: t.index, message: `${share}% of the text is behind the phone (layer ${d.index}); move it or bring the text forward` });
      } else {
        add({ severity: "warning", code: "text_overlaps_device", layer: t.index, message: `text sits over the phone (layer ${d.index}) on ${share}% of its area` });
      }
    }
    // Contrast against what's under the text: sample the centre and four inset points.
    const layer = screen.layers[t.index]!;
    if (layer.type !== "text") continue;
    const fg = parseHex(resolveColor(project, layer.color));
    const below = layers.filter((l) => l.index < t.index);
    const pts = [
      [0.5, 0.5],
      [0.15, 0.25],
      [0.85, 0.25],
      [0.15, 0.75],
      [0.85, 0.75],
    ].map(([fx, fy]) => [b.x + b.w * fx!, b.y + b.h * fy!] as const);
    let worst = Infinity;
    for (const [x, y] of pts) {
      const bg = colorAt(project, screen, below, W, H, x, y);
      if (!bg) continue;
      worst = Math.min(worst, contrastRatio(over(fg, bg, layer.opacity), bg));
    }
    // WCAG: 3:1 for large text (24px+ at 1x is generous for 1080-wide canvases), 4.5:1 otherwise.
    const need = t.text.size >= 36 ? 3 : 4.5;
    if (worst < need) {
      add({ severity: "warning", code: "low_contrast", layer: t.index, message: `contrast ${worst.toFixed(1)}:1 against the background, below ${need}:1; change the text or background colour` });
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.layer ?? -1) - (b.layer ?? -1));
  return {
    screen: screen.id,
    target: target.id,
    locale,
    size: [W, H],
    background: describeBackground(project, screen.background),
    layers: layers.map((l) => ({ ...l, box: rect(l.box), bounds: rect(l.bounds) })),
    findings,
  };
}
