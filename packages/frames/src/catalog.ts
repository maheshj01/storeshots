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

// iPhones ------------------------------------------------------------------

/** Screen size in millimetres from a pixel resolution and density. */
function screenFromPpi([pw, ph]: [number, number], ppi: number): [number, number] {
  return [(pw / ppi) * 25.4, (ph / ppi) * 25.4];
}

/** iOS points to millimetres on a 3x, 460 ppi display. */
const pt = (v: number) => (v * 3 * 25.4) / 460;

interface IphoneSpec {
  id: string;
  name: string;
  /** From Apple's tech specs page. */
  body: { w: number; h: number };
  display: [number, number];
  /** Dynamic Island width in points; Apple doesn't publish it. */
  islandPt: number;
  /** Dynamic Island height and distance from the top of the screen, in points. */
  island?: { h: number; top: number };
  variants: VectorFrame["variants"];
  defaultVariant: string;
  source: string;
}

/**
 * An iPhone drawn from Apple's published body size and display resolution
 * at 460 ppi. Corner radii, button positions and the Dynamic Island are
 * approximations from photos and iOS metrics; they're not published.
 * Buttons: Action button and volume on the left, side button and Camera
 * Control on the right, placed in proportion to the body height.
 */
function iphone(spec: IphoneSpec): VectorFrame {
  const [sw, sh] = screenFromPpi(spec.display, 460);
  const s = centred(spec.body, [sw, sh]);
  const k = spec.body.h / 150; // positions measured on a 150 mm body
  const at = (from: number, to: number) => ({ from: from * k, to: to * k });
  return {
    kind: "vector",
    id: spec.id,
    name: spec.name,
    platform: "ios",
    source: spec.source,
    display: spec.display,
    body: { ...spec.body, radius: pt(62) + (spec.body.w - sw) / 2, rim: 0.8 },
    screen: { ...s, radius: pt(62) },
    cutout: (() => {
      const { h, top } = spec.island ?? { h: 37, top: 11 };
      return { type: "island" as const, cx: sw / 2, cy: pt(top) + pt(h) / 2, w: pt(spec.islandPt), h: pt(h) };
    })(),
    buttons: [
      { side: "left", ...at(24, 31), depth: 0.55 },
      { side: "left", ...at(37, 47), depth: 0.55 },
      { side: "left", ...at(50, 60), depth: 0.55 },
      { side: "right", ...at(38, 53), depth: 0.55 },
      { side: "right", ...at(86, 97), depth: 0.3 },
    ],
    variants: spec.variants,
    defaultVariant: spec.defaultVariant,
  };
}

// Finish colours are approximations of Apple's product photos.
const IPHONE_18_PRO_VARIANTS = {
  black: { body: "#2A2A2C", rim: "#48484B", button: "#343437" },
  silver: { body: "#DADADC", rim: "#F2F2F4", button: "#C9C9CC" },
  glacier: { body: "#C6D6DF", rim: "#E3EDF2", button: "#B3C4CE" },
  burgundy: { body: "#5B1E29", rim: "#7C3240", button: "#4C1822" },
};

const iphone18Pro = () =>
  iphone({
    id: "iphone-18-pro",
    name: "iPhone 18 Pro",
    body: { w: 71.9, h: 150.0 },
    display: [1206, 2622],
    islandPt: 110,
    variants: IPHONE_18_PRO_VARIANTS,
    defaultVariant: "black",
    source: "apple.com/iphone-18-pro/specs (Sept 2026): 150.0 × 71.9 mm, 6.3-inch 2622 × 1206 at 460 ppi; smaller Dynamic Island, size estimated",
  });

const iphone18ProMax = () =>
  iphone({
    id: "iphone-18-pro-max",
    name: "iPhone 18 Pro Max",
    body: { w: 78.0, h: 163.4 },
    display: [1320, 2868],
    islandPt: 110,
    variants: IPHONE_18_PRO_VARIANTS,
    defaultVariant: "black",
    source: "apple.com/iphone-18-pro/specs (Sept 2026): 163.4 × 78.0 mm, 6.9-inch 2868 × 1320 at 460 ppi; smaller Dynamic Island, size estimated",
  });

// iPhone 17 Pro's Dynamic Island: 126 × 37.33 pt, 13.67 pt from the top of
// the screen, measured from Simulator screenshots that show it. Screenshots
// like those line up with this frame's island; on iPhone 18 Pro's smaller
// one the two shapes collide.
const IPHONE_17_PRO_ISLAND = { h: 37.33, top: 13.67 };
const IPHONE_17_PRO_VARIANTS = {
  "cosmic-orange": { body: "#D9692E", rim: "#EE8A55", button: "#C45C26" },
  "deep-blue": { body: "#2B3A52", rim: "#46597A", button: "#233046" },
  silver: { body: "#DADADC", rim: "#F2F2F4", button: "#C9C9CC" },
};

const iphone17Pro = () =>
  iphone({
    id: "iphone-17-pro",
    name: "iPhone 17 Pro",
    body: { w: 71.9, h: 150.0 },
    display: [1206, 2622],
    islandPt: 126,
    island: IPHONE_17_PRO_ISLAND,
    variants: IPHONE_17_PRO_VARIANTS,
    defaultVariant: "deep-blue",
    source: "apple.com/iphone-17-pro/specs (Sept 2025): 150.0 × 71.9 mm, 6.3-inch 2622 × 1206 at 460 ppi; Dynamic Island 126 × 37.33 pt",
  });

const iphone17ProMax = () =>
  iphone({
    id: "iphone-17-pro-max",
    name: "iPhone 17 Pro Max",
    body: { w: 78.0, h: 163.4 },
    display: [1320, 2868],
    islandPt: 126,
    island: IPHONE_17_PRO_ISLAND,
    variants: IPHONE_17_PRO_VARIANTS,
    defaultVariant: "deep-blue",
    source: "apple.com/iphone-17-pro/specs (Sept 2025): 163.4 × 78.0 mm, 6.9-inch 2868 × 1320 at 460 ppi; Dynamic Island 126 × 37.33 pt",
  });

const iphoneAir = () =>
  iphone({
    id: "iphone-air",
    name: "iPhone Air",
    body: { w: 74.7, h: 156.2 },
    display: [1260, 2736],
    islandPt: 125,
    variants: {
      "space-black": { body: "#1D1D1F", rim: "#3A3A3D", button: "#2A2A2D" },
      "cloud-white": { body: "#EDEDEB", rim: "#FAFAF8", button: "#DCDCDA" },
      "light-gold": { body: "#E5D8BD", rim: "#F3EAD6", button: "#D4C6A8" },
      "sky-blue": { body: "#BED2E4", rim: "#DCE8F2", button: "#A9BFD3" },
    },
    defaultVariant: "space-black",
    source: "apple.com/iphone-air/specs (Sept 2026): 156.2 × 74.7 mm, 6.5-inch 2736 × 1260 at 460 ppi",
  });

export const CATALOG: readonly VectorFrame[] = [
  pixel9Pro(),
  pixel7(),
  genericAndroid(),
  iphone18Pro(),
  iphone18ProMax(),
  iphoneAir(),
  iphone17Pro(),
  iphone17ProMax(),
];

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
  const c = f.cutout;
  if (c && c.type !== "none") {
    const [hw, hh] = c.type === "island" ? [c.w / 2, c.h / 2] : [c.d / 2, c.d / 2];
    if (c.cx - hw < 0 || c.cx + hw > s.w || c.cy - hh < 0 || c.cy + hh > s.h) errs.push("cutout outside the screen");
  }
  return errs;
}
