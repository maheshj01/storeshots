import type { CanvasLike, Ctx, RenderHost } from "./host.ts";

/**
 * Drop shadows computed in core. Canvas `shadowBlur` is implementation
 * defined: Chrome and Skia-in-Node produce visibly different falloffs from
 * the same value. Here the shape's alpha is drawn into a scratch canvas,
 * blurred with three box passes in integer math, and composited, so every
 * engine produces the same pixels.
 */
export interface ShadowSpec {
  /** Blur as a CSS-style radius in px; the Gaussian sigma is half of it. */
  blur: number;
  offsetX: number;
  offsetY: number;
  /** Shadow opacity, 0..1. */
  alpha: number;
}

/** Box sizes whose three passes approximate a Gaussian with this sigma. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxBlurH(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number) {
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r - 1; x < r; x++) acc += x >= 0 && x < w ? src[row + x]! : 0;
    for (let x = 0; x < w; x++) {
      const add = x + r;
      const sub = x - r - 1;
      acc += (add < w ? src[row + add]! : 0) - (sub >= 0 ? src[row + sub]! : 0);
      dst[row + x] = Math.round(acc / div);
    }
  }
}

function boxBlurV(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number) {
  const div = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r - 1; y < r; y++) acc += y >= 0 && y < h ? src[y * w + x]! : 0;
    for (let y = 0; y < h; y++) {
      const add = y + r;
      const sub = y - r - 1;
      acc += (add < h ? src[add * w + x]! : 0) - (sub >= 0 ? src[sub * w + x]! : 0);
      dst[y * w + x] = Math.round(acc / div);
    }
  }
}

/** Gaussian-like blur of an alpha channel, in place. */
export function blurAlpha(alpha: Uint8Array, w: number, h: number, sigma: number) {
  if (sigma < 0.5) return;
  const tmp = new Uint8Array(alpha.length);
  for (const size of boxesForGauss(sigma)) {
    const r = (size - 1) / 2;
    boxBlurH(alpha, tmp, w, h, r);
    boxBlurV(tmp, alpha, w, h, r);
  }
}

/**
 * Draws a shadow for the shape that `draw` paints, in the context's current
 * coordinate space. `bounds` must contain the shape.
 */
export function drawShadow(
  ctx: Ctx,
  host: RenderHost,
  bounds: { x: number; y: number; w: number; h: number },
  spec: ShadowSpec,
  draw: (c: Ctx) => void,
  /** Identifies the shape `draw` paints, so the blurred result can be reused. */
  shapeKey?: string,
) {
  const sigma = spec.blur / 2;
  const pad = Math.ceil(sigma * 3) + 2;
  const x0 = Math.floor(bounds.x) - pad;
  const y0 = Math.floor(bounds.y) - pad;
  const w = Math.ceil(bounds.x + bounds.w) + pad - x0;
  const h = Math.ceil(bounds.y + bounds.h) + pad - y0;
  // A shadow is a soft gradient, so it's blurred at a fraction of the size
  // and scaled up: 1/k the pixels in each direction, the blur kept at least
  // 4 px wide at the small size. At preview sizes this is the difference
  // between a smooth zoom and a stall.
  const k = Math.max(1, Math.floor(sigma / 4));
  const cacheKey = shapeKey && `${shapeKey}|${bounds.x},${bounds.y},${bounds.w},${bounds.h}|${spec.blur},${spec.alpha}`;
  const cache = shadowCache(host);
  let scratch = cacheKey ? cache.get(cacheKey) : undefined;
  if (!scratch) {
    const sw = Math.ceil(w / k);
    const sh = Math.ceil(h / k);
    scratch = host.createCanvas(sw, sh);
    const sc = scratch.getContext("2d");
    if (!sc) throw new Error("2d context unavailable");
    sc.scale(1 / k, 1 / k);
    sc.translate(-x0, -y0);
    sc.fillStyle = "#000000";
    draw(sc);

    const img = sc.getImageData(0, 0, sw, sh);
    const alpha = new Uint8Array(sw * sh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3]!;
    blurAlpha(alpha, sw, sh, sigma / k);
    const a = Math.round(spec.alpha * 256);
    for (let i = 0; i < alpha.length; i++) {
      img.data[i * 4] = 0;
      img.data[i * 4 + 1] = 0;
      img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = (alpha[i]! * a) >> 8;
    }
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.putImageData(img, 0, 0);
    if (cacheKey) remember(cache, cacheKey, scratch);
  }
  ctx.drawImage(scratch as unknown as CanvasImageSource, x0 + Math.round(spec.offsetX), y0 + Math.round(spec.offsetY), scratch.width * k, scratch.height * k);
}

/** Blurred shadows per host, most recent last; a handful covers a listing. */
const caches = new WeakMap<RenderHost, Map<string, CanvasLike>>();
const CACHE_SIZE = 24;

function shadowCache(host: RenderHost): Map<string, CanvasLike> {
  let c = caches.get(host);
  if (!c) caches.set(host, (c = new Map()));
  return c;
}

function remember(cache: Map<string, CanvasLike>, key: string, value: CanvasLike) {
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}
