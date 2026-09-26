import type { VectorFrame } from "./types.ts";

/**
 * Screen size in millimetres from a diagonal and a pixel resolution.
 * Screens are modelled as rectangles; the corner radius is separate.
 */
function screenMm(diagonalInches: number, [pw, ph]: [number, number]): [number, number] {
  const mmPerPx = (diagonalInches * 25.4) / Math.hypot(pw, ph);
  return [pw * mmPerPx, ph * mmPerPx];
}

function centred(
  body: { w: number; h: number },
  screen: [number, number],
  dy = 0,
): { x: number; y: number; w: number; h: number } {
  const [w, h] = screen;
  return { x: (body.w - w) / 2, y: (body.h - h) / 2 + dy, w, h };
}

const PIXEL_VARIANTS = {
  obsidian: { body: "#1F1F21", rim: "#3A3A3D", button: "#2C2C2F" },
  porcelain: { body: "#E9E4DC", rim: "#CFC9BF", button: "#D8D2C8" },
  hazel: { body: "#5C6353", rim: "#7C8470", button: "#6B7361" },
};

function pixel9Pro(): VectorFrame {
  const body = { w: 72.0, h: 152.8 };
  const display: [number, number] = [1280, 2856];
  const s = centred(body, screenMm(6.3, display));
  return {
    kind: "vector",
    id: "pixel-9-pro",
    name: "Pixel 9 Pro",
    platform: "android",
    source: "Google Store tech specs: 152.8 × 72.0 mm, 6.3-inch 1280 × 2856 display",
    display,
    body: { ...body, radius: 10.5, rim: 0.9 },
    screen: { ...s, radius: 7.4 },
    cutout: { type: "punch-hole", cx: s.w / 2, cy: 3.2, d: 2.6 },
    buttons: [
      { side: "right", from: 31, to: 42, depth: 0.7 },
      { side: "right", from: 48, to: 68, depth: 0.7 },
    ],
    variants: PIXEL_VARIANTS,
    defaultVariant: "obsidian",
  };
}

function pixel7(): VectorFrame {
  const body = { w: 73.2, h: 155.6 };
  const display: [number, number] = [1080, 2400];
  const s = centred(body, screenMm(6.3, display), 0.3);
  return {
    kind: "vector",
    id: "pixel-7",
    name: "Pixel 7",
    platform: "android",
    source: "Google Store tech specs: 155.6 × 73.2 mm, 6.3-inch 1080 × 2400 display",
    display,
    body: { ...body, radius: 9.5, rim: 0.9 },
    screen: { ...s, radius: 5.2 },
    cutout: { type: "punch-hole", cx: s.w / 2, cy: 3.4, d: 2.8 },
    buttons: [
      { side: "right", from: 34, to: 45, depth: 0.7 },
      { side: "right", from: 51, to: 70, depth: 0.7 },
    ],
    variants: {
      obsidian: { body: "#202124", rim: "#3C3D40", button: "#2D2E31" },
      snow: { body: "#EDEDEA", rim: "#D3D3CF", button: "#DEDEDA" },
      lemongrass: { body: "#D9DDB4", rim: "#BEC296", button: "#CDD1A6" },
    },
    defaultVariant: "obsidian",
  };
}

function genericAndroid(): VectorFrame {
  // Not a real device: an even, thin bezel around a 20:9 screen, for when
  // the brand of phone shouldn't be the point.
  const display: [number, number] = [1080, 2400];
  const [sw, sh] = screenMm(6.4, display);
  const bezel = 3.2;
  const body = { w: sw + bezel * 2, h: sh + bezel * 2 };
  return {
    kind: "vector",
    id: "generic-android",
    name: "Generic Android",
    platform: "android",
    source: "Neutral design, 6.4-inch 20:9 screen with a 3.2 mm bezel",
    display,
    body: { ...body, radius: 9, rim: 0.7 },
    screen: { x: bezel, y: bezel, w: sw, h: sh, radius: 6.2 },
    cutout: { type: "punch-hole", cx: sw / 2, cy: 3.0, d: 2.4 },
    buttons: [
      { side: "right", from: 30, to: 40, depth: 0.7 },
      { side: "right", from: 46, to: 64, depth: 0.7 },
    ],
    variants: {
      black: { body: "#161616", rim: "#383838", button: "#262626" },
      white: { body: "#F2F2F2", rim: "#D6D6D6", button: "#E4E4E4" },
    },
    defaultVariant: "black",
  };
}

export const CATALOG: readonly VectorFrame[] = [pixel9Pro(), pixel7(), genericAndroid()];

export function findFrame(id: string): VectorFrame | undefined {
  return CATALOG.find((f) => f.id === id);
}

/** Checks a catalog entry is geometrically sane; used by tests and contributors. */
export function validateFrame(f: VectorFrame): string[] {
  const errs: string[] = [];
  const { body: b, screen: s } = f;
  if (s.x < 0 || s.y < 0 || s.x + s.w > b.w + 1e-9 || s.y + s.h > b.h + 1e-9) errs.push("screen extends outside the body");
  if (s.radius > Math.min(s.w, s.h) / 2) errs.push("screen radius too large");
  if (b.radius < s.radius) errs.push("body radius smaller than screen radius");
  const aspect = f.display[0] / f.display[1];
  if (Math.abs(s.w / s.h - aspect) > 0.01) errs.push(`screen aspect ${(s.w / s.h).toFixed(3)} != display aspect ${aspect.toFixed(3)}`);
  if (!(f.defaultVariant in f.variants)) errs.push("defaultVariant missing from variants");
  for (const btn of f.buttons) if (btn.from >= btn.to || btn.to > b.h) errs.push("button outside the body");
  return errs;
}
