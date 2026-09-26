import {
  localeChain,
  resolveColor,
  resolveFont,
  resolveText,
  type Background,
  type Box,
  type DeviceLayer,
  type ImageLayer,
  type Layer,
  type Project,
  type Screen,
  type ShapeLayer,
  type Target,
  type TextLayer,
} from "@storeshots/schema";
import { findFrame, type BitmapFrame, type FrameDef, type VectorFrame } from "@storeshots/frames";
import type { CanvasLike, Ctx, ImageLike, RenderHost } from "./host.ts";
import { readFontMetrics, type FontMetrics } from "./fontmetrics.ts";
import { layoutTextBlock, fontString } from "./text.ts";
import { opaque } from "./color.ts";
import { drawShadow } from "./shadow.ts";

export interface RenderRequest {
  screen: string;
  target: string;
  locale: string;
  /** Output scale; 1 renders at the target's full size. Previews use less. */
  scale?: number;
  /**
   * What to do when a device layer's capture is missing. Exports fail;
   * the editor draws an empty screen so a design can start before captures.
   */
  missingCapture?: "error" | "placeholder";
}

export interface RenderWarning {
  layer: string;
  message: string;
}

export interface RenderResult {
  canvas: CanvasLike;
  target: Target;
  screen: Screen;
  warnings: RenderWarning[];
}

interface Loaded {
  images: Map<string, ImageLike | null>;
  fonts: Map<string, { family: string; metrics: FontMetrics }>;
  frames: Map<string, FrameDef>;
}

/** Stable, CSS-safe family name for a font path. */
function familyFor(path: string): string {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619);
  return `ss-${(h >>> 0).toString(36)}`;
}

function platformOf(target: Target): "android" | "ios" {
  return target.store === "play" ? "android" : "ios";
}

function frameIdFor(layer: DeviceLayer, target: Target): string {
  if (typeof layer.frame === "string") return layer.frame;
  const id = layer.frame[platformOf(target)];
  if (!id) throw new Error(`device layer has no ${platformOf(target)} frame for target "${target.id}"`);
  return id;
}

/**
 * Per-project asset cache. Hosts keep their own decode caches; this keeps
 * resolved fonts and frames so previews of many screens load each once.
 */
export class AssetCache {
  readonly loaded: Loaded = { images: new Map(), fonts: new Map(), frames: new Map() };
  readonly host: RenderHost;
  constructor(host: RenderHost) {
    this.host = host;
  }

  async image(path: string): Promise<ImageLike | null> {
    if (!this.loaded.images.has(path)) this.loaded.images.set(path, await this.host.loadImage(path));
    return this.loaded.images.get(path)!;
  }

  async font(path: string): Promise<{ family: string; metrics: FontMetrics }> {
    let f = this.loaded.fonts.get(path);
    if (!f) {
      const family = familyFor(path);
      const bytes = await this.host.loadFont(path, family);
      f = { family, metrics: readFontMetrics(bytes) };
      this.loaded.fonts.set(path, f);
    }
    return f;
  }

  /** Catalog frames first, then frames imported into the project's frames/ folder. */
  async frame(id: string): Promise<FrameDef> {
    let f: FrameDef | undefined = this.loaded.frames.get(id) ?? findFrame(id);
    if (!f) {
      const json = await this.host.loadJson(`frames/${id}/frame.json`);
      if (!json) throw new Error(`unknown frame "${id}": not in the catalog or frames/${id}/frame.json`);
      const bitmap = json as BitmapFrame;
      f = {
        ...bitmap,
        background: { ...bitmap.background, src: `frames/${id}/${bitmap.background.src}` },
        mask: bitmap.mask && { src: `frames/${id}/${bitmap.mask.src}` },
      };
    }
    this.loaded.frames.set(id, f);
    return f;
  }

  /** Finds a capture along the locale fallback chain. */
  async capture(project: Project, file: string, locale: string): Promise<{ path: string; image: ImageLike } | null> {
    for (const loc of localeChain(project, locale)) {
      const path = `captures/${loc}/${file}`;
      const image = await this.image(path);
      if (image) return { path, image };
    }
    const flat = `captures/${file}`;
    const image = await this.image(flat);
    return image ? { path: flat, image } : null;
  }
}

/** Renders one screen for one target and locale. The single renderer. */
export async function renderScreen(
  project: Project,
  req: RenderRequest,
  cache: AssetCache,
): Promise<RenderResult> {
  const screen = project.screens.find((s) => s.id === req.screen);
  if (!screen) throw new Error(`unknown screen "${req.screen}"`);
  const target = project.targets.find((t) => t.id === req.target);
  if (!target) throw new Error(`unknown target "${req.target}"`);
  const scale = req.scale ?? 1;
  const W = Math.round(target.size[0] * scale);
  const H = Math.round(target.size[1] * scale);

  const canvas = cache.host.createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const warnings: RenderWarning[] = [];

  const env: DrawEnv = {
    project,
    target,
    locale: req.locale,
    cache,
    ctx,
    W,
    H,
    warnings,
    missingCapture: req.missingCapture ?? "error",
  };
  await drawBackground(env, screen.background);
  for (let i = 0; i < screen.layers.length; i++) {
    const layer = screen.layers[i]!;
    await drawLayer(env, layer, `${screen.id}.layers[${i}]`);
  }
  return { canvas, target, screen, warnings };
}

interface DrawEnv {
  project: Project;
  target: Target;
  locale: string;
  cache: AssetCache;
  ctx: Ctx;
  W: number;
  H: number;
  warnings: RenderWarning[];
  missingCapture: "error" | "placeholder";
}

function px(env: DrawEnv, b: Box) {
  return { x: b.x * env.W, y: b.y * env.H, w: b.w * env.W, h: b.h * env.H };
}

async function drawBackground(env: DrawEnv, bg: Background) {
  const { ctx, W, H, project } = env;
  // Stores reject alpha, so every render starts from an opaque base colour
  // and anything translucent is flattened onto it.
  const base =
    bg.type === "solid" ? bg.color : bg.type === "linear-gradient" ? bg.stops[0]![0] : (bg.color ?? "#FFFFFF");
  ctx.fillStyle = opaque(resolveColor(project, base));
  ctx.fillRect(0, 0, W, H);

  if (bg.type === "solid") {
    ctx.fillStyle = resolveColor(project, bg.color);
    ctx.fillRect(0, 0, W, H);
  } else if (bg.type === "linear-gradient") {
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
    for (const [c, at] of bg.stops) g.addColorStop(at, resolveColor(project, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    const img = await env.cache.image(bg.src);
    if (!img) throw new Error(`background image not found: ${bg.src}`);
    drawFitted(ctx, img, { x: 0, y: 0, w: W, h: H }, bg.fit);
  }
}

async function drawLayer(env: DrawEnv, layer: Layer, name: string) {
  const { ctx } = env;
  const box = px(env, layer.box);
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  if (layer.rotate) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotate * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  try {
    switch (layer.type) {
      case "text":
        await drawText(env, layer, box, name);
        break;
      case "image":
        await drawImageLayer(env, layer, box);
        break;
      case "shape":
        drawShape(env, layer, box);
        break;
      case "device":
        await drawDevice(env, layer, box, name);
        break;
    }
  } finally {
    ctx.restore();
  }
}

async function drawText(env: DrawEnv, layer: TextLayer, box: Rect, name: string) {
  const { ctx, project } = env;
  const text = resolveText(project, layer.text, env.locale);
  if (!text) return;
  const font = await env.cache.font(resolveFont(project, layer.font));
  const layout = layoutTextBlock(ctx, {
    text,
    family: font.family,
    size: layer.size * env.W,
    lineHeight: layer.lineHeight,
    maxWidth: box.w,
    maxHeight: box.h,
    fit: layer.fit,
    balance: layer.balance,
  });
  if (layout.overflow) {
    env.warnings.push({ layer: name, message: `text overflows its box in "${env.locale}": ${JSON.stringify(text)}` });
  }
  const lineBox = layout.size * layer.lineHeight;
  const blockH = layout.lines.length * lineBox;
  const top =
    layer.valign === "top" ? box.y : layer.valign === "middle" ? box.y + (box.h - blockH) / 2 : box.y + box.h - blockH;
  const { ascent, descent } = font.metrics;
  const baselineOffset = (lineBox - (ascent + descent) * layout.size) / 2 + ascent * layout.size;

  ctx.font = fontString(font.family, layout.size);
  ctx.fillStyle = resolveColor(project, layer.color);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  layout.lines.forEach((line, i) => {
    const x =
      layer.align === "left" ? box.x : layer.align === "right" ? box.x + box.w - line.width : box.x + (box.w - line.width) / 2;
    ctx.fillText(line.text, x, top + i * lineBox + baselineOffset);
  });
}

async function drawImageLayer(env: DrawEnv, layer: ImageLayer, box: Rect) {
  const img = await env.cache.image(layer.src);
  if (!img) throw new Error(`image not found: ${layer.src}`);
  const { ctx } = env;
  if (layer.radius > 0) {
    ctx.save();
    roundRect(ctx, box.x, box.y, box.w, box.h, layer.radius * env.W);
    ctx.clip();
    drawFitted(ctx, img, box, layer.fit);
    ctx.restore();
  } else {
    drawFitted(ctx, img, box, layer.fit);
  }
}

function drawShape(env: DrawEnv, layer: ShapeLayer, box: Rect) {
  const { ctx } = env;
  ctx.fillStyle = resolveColor(env.project, layer.color);
  ctx.beginPath();
  if (layer.shape === "ellipse") {
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  } else {
    roundRect(ctx, box.x, box.y, box.w, box.h, layer.radius * env.W);
  }
  ctx.fill();
}

async function drawDevice(env: DrawEnv, layer: DeviceLayer, box: Rect, name: string) {
  const frame = await env.cache.frame(frameIdFor(layer, env.target));
  const found = layer.capture ? await env.cache.capture(env.project, layer.capture, env.locale) : null;
  if (!found && env.missingCapture === "error") {
    throw new Error(`capture not found for "${env.locale}": ${layer.capture || "(none)"}`);
  }
  const capture = found ?? { path: "", image: placeholderScreen(env, frame) };
  const [dw, dh] = frame.display;
  const { width: cw, height: ch } = capture.image;
  if (found && Math.abs(cw / ch - dw / dh) > 0.01) {
    env.warnings.push({
      layer: name,
      message: `${capture.path} is ${cw}×${ch}, but ${frame.name} displays ${dw}×${dh}; the capture is cropped to fit`,
    });
  }
  if (frame.kind === "vector") drawVectorFrame(env, frame, layer, box, capture.image);
  else await drawBitmapFrame(env, frame, layer, box, capture.image);
}

const placeholders = new WeakMap<AssetCache, Map<string, ImageLike>>();

/** A flat screen for device layers without a capture yet. */
function placeholderScreen(env: DrawEnv, frame: FrameDef): ImageLike {
  let byFrame = placeholders.get(env.cache);
  if (!byFrame) placeholders.set(env.cache, (byFrame = new Map()));
  let img = byFrame.get(frame.id);
  if (!img) {
    const [w, h] = [Math.round(frame.display[0] / 8), Math.round(frame.display[1] / 8)];
    const c = env.cache.host.createCanvas(w, h);
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#3A3E45");
    g.addColorStop(1, "#24272C");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    img = c;
    byFrame.set(frame.id, img);
  }
  return img;
}

export interface FrameGeometry {
  /** The device body, in canvas px. */
  body: Rect;
  /** The display area, in canvas px. */
  screen: Rect;
  screenRadius: number;
}

/** Where a frame draws inside a layer box: shared by the renderer and editor overlays. */
export function frameGeometry(frame: FrameDef, box: Rect): FrameGeometry {
  if (frame.kind === "vector") {
    const s = Math.min(box.w / frame.body.w, box.h / frame.body.h);
    const ox = box.x + (box.w - frame.body.w * s) / 2;
    const oy = box.y + (box.h - frame.body.h * s) / 2;
    return {
      body: { x: ox, y: oy, w: frame.body.w * s, h: frame.body.h * s },
      screen: { x: ox + frame.screen.x * s, y: oy + frame.screen.y * s, w: frame.screen.w * s, h: frame.screen.h * s },
      screenRadius: frame.screen.radius * s,
    };
  }
  const [fw, fh] = frame.size;
  const s = Math.min(box.w / fw, box.h / fh);
  const ox = box.x + (box.w - fw * s) / 2;
  const oy = box.y + (box.h - fh * s) / 2;
  return {
    body: { x: ox, y: oy, w: fw * s, h: fh * s },
    screen: { x: ox + frame.screen.x * s, y: oy + frame.screen.y * s, w: frame.screen.w * s, h: frame.screen.h * s },
    screenRadius: frame.screen.radius * s,
  };
}

/** Body aspect ratio (width / height) of a frame, for sizing device boxes. */
export function frameAspect(frame: FrameDef): number {
  return frame.kind === "vector" ? frame.body.w / frame.body.h : frame.size[0] / frame.size[1];
}

function drawVectorFrame(env: DrawEnv, f: VectorFrame, layer: DeviceLayer, box: Rect, shot: ImageLike) {
  const { ctx } = env;
  const variant = f.variants[layer.variant ?? f.defaultVariant] ?? f.variants[f.defaultVariant]!;
  const s = Math.min(box.w / f.body.w, box.h / f.body.h);
  const ox = box.x + (box.w - f.body.w * s) / 2;
  const oy = box.y + (box.h - f.body.h * s) / 2;
  const mm = (v: number) => v * s;
  const bodyPath = () => roundRect(ctx, ox, oy, mm(f.body.w), mm(f.body.h), mm(f.body.radius));

  if (layer.shadow) {
    const bounds = { x: ox, y: oy, w: mm(f.body.w), h: mm(f.body.h) };
    drawShadow(ctx, env.cache.host, bounds, { blur: mm(10), offsetX: 0, offsetY: mm(3), alpha: 0.3 }, (c) => {
      roundRect(c, ox, oy, mm(f.body.w), mm(f.body.h), mm(f.body.radius));
      c.fill();
    });
  }

  ctx.fillStyle = variant.button;
  for (const b of f.buttons) {
    const x = b.side === "right" ? ox + mm(f.body.w - 0.4) : ox - mm(b.depth);
    roundRect(ctx, x, oy + mm(b.from), mm(b.depth + 0.4), mm(b.to - b.from), mm(0.35));
    ctx.fill();
  }

  // Coloured metal band, then the black glass front inset by the rim width.
  ctx.fillStyle = variant.body;
  bodyPath();
  ctx.fill();
  ctx.strokeStyle = variant.rim;
  ctx.lineWidth = Math.max(1, mm(0.25));
  roundRect(ctx, ox + mm(0.125), oy + mm(0.125), mm(f.body.w - 0.25), mm(f.body.h - 0.25), mm(f.body.radius - 0.125));
  ctx.stroke();
  const r = f.body.rim;
  ctx.fillStyle = "#0A0A0B";
  roundRect(ctx, ox + mm(r), oy + mm(r), mm(f.body.w - 2 * r), mm(f.body.h - 2 * r), mm(f.body.radius - r));
  ctx.fill();

  const scr = { x: ox + mm(f.screen.x), y: oy + mm(f.screen.y), w: mm(f.screen.w), h: mm(f.screen.h) };
  ctx.save();
  roundRect(ctx, scr.x, scr.y, scr.w, scr.h, mm(f.screen.radius));
  ctx.clip();
  ctx.fillStyle = "#000000";
  ctx.fillRect(scr.x, scr.y, scr.w, scr.h);
  drawFitted(ctx, shot, scr, "cover");
  ctx.restore();

  if (f.cutout?.type === "punch-hole") {
    const cx = scr.x + mm(f.cutout.cx);
    const cy = scr.y + mm(f.cutout.cy);
    const rad = mm(f.cutout.d / 2);
    ctx.fillStyle = "#050506";
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(1, rad * 0.15);
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
}

async function drawBitmapFrame(env: DrawEnv, f: BitmapFrame, layer: DeviceLayer, box: Rect, shot: ImageLike) {
  const { ctx } = env;
  const back = await env.cache.image(f.background.src);
  if (!back) throw new Error(`frame image not found: ${f.background.src}`);
  const mask = f.mask ? await env.cache.image(f.mask.src) : null;
  const [fw, fh] = f.size;
  const s = Math.min(box.w / fw, box.h / fh);
  const ox = box.x + (box.w - fw * s) / 2;
  const oy = box.y + (box.h - fh * s) / 2;

  const bx = ox + f.background.x * s;
  const by = oy + f.background.y * s;
  const bw = back.width * s;
  const bh = back.height * s;
  if (layer.shadow) {
    const spec = { blur: fw * s * 0.07, offsetX: 0, offsetY: fw * s * 0.02, alpha: 0.3 };
    drawShadow(ctx, env.cache.host, { x: bx, y: by, w: bw, h: bh }, spec, (c) => drawImage(c, back, bx, by, bw, bh));
  }
  drawImage(ctx, back, bx, by, bw, bh);

  const scr = { x: ox + f.screen.x * s, y: oy + f.screen.y * s, w: f.screen.w * s, h: f.screen.h * s };
  ctx.save();
  roundRect(ctx, scr.x, scr.y, scr.w, scr.h, f.screen.radius * s);
  ctx.clip();
  drawFitted(ctx, shot, scr, "cover");
  ctx.restore();
  if (mask) drawImage(ctx, mask, scr.x, scr.y, scr.w, scr.h);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function drawImage(ctx: Ctx, img: ImageLike, x: number, y: number, w: number, h: number) {
  ctx.drawImage(img as CanvasImageSource, x, y, w, h);
}

function drawFitted(ctx: Ctx, img: ImageLike, box: Rect, fit: "cover" | "contain" | "fill") {
  if (fit === "fill") return drawImage(ctx, img, box.x, box.y, box.w, box.h);
  const k = fit === "cover" ? Math.max(box.w / img.width, box.h / img.height) : Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * k;
  const h = img.height * k;
  drawImage(ctx, img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
}

/** Rounded rectangle path, built from arcs so every canvas draws it the same way. */
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
