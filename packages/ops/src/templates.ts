import type { Background, DeviceLayer, Layer, Project, Screen, TextLayer } from "@storeshots/schema";
import { findFrame } from "@storeshots/frames";
import { frameAspect } from "@storeshots/core";

/**
 * Starter templates. A template is a layout recipe, not a document: applying
 * one keeps every screen's captions and captures and only changes where
 * things sit and how they look. Colours come from the theme, so changing the
 * brand colour restyles every screen at once.
 */
export interface Template {
  id: string;
  name: string;
  /** What it looks like, in a few words, for the picker. */
  blurb: string;
  fonts: { heading: string; body: string };
  colors: (brand: string) => Record<string, string>;
  screen: (i: number, ctx: LayoutContext) => { background: Background; layers: Layer[] };
}

export interface LayoutContext {
  /** Target width / height, so device boxes keep the frame's proportions. */
  aspect: number;
  titleKey: string;
  subKey: string;
  capture: string;
  frame: string;
  variant?: string | undefined;
}

export const DEFAULT_FRAME = "pixel-9-pro";

/** Height (as a canvas fraction) of a device box `w` wide, keeping the frame's shape. */
function deviceH(ctx: LayoutContext, w: number): number {
  const frame = findFrame(ctx.frame);
  const a = frame ? frameAspect(frame) : 0.47;
  return (w * ctx.aspect) / a;
}

function text(key: string, font: string, size: number, color: string, box: TextLayer["box"], extra: Partial<TextLayer> = {}): TextLayer {
  return {
    type: "text",
    text: `@caption.${key}`,
    font,
    size,
    color,
    box,
    rotate: 0,
    opacity: 1,
    lineHeight: 1.12,
    align: "center",
    valign: "top",
    fit: "shrink",
    balance: true,
    ...extra,
  };
}

function device(ctx: LayoutContext, x: number, y: number, w: number, extra: Partial<DeviceLayer> = {}): DeviceLayer {
  return {
    type: "device",
    frame: ctx.frame,
    variant: ctx.variant,
    capture: ctx.capture,
    box: { x, y, w, h: deviceH(ctx, w) },
    rotate: 0,
    opacity: 1,
    shadow: true,
    ...extra,
  };
}

export const TEMPLATES: Template[] = [
  {
    id: "headline",
    name: "Headline",
    blurb: "Big caption over a brand gradient, phone rising from the bottom",
    fonts: { heading: "Poppins-SemiBold.ttf", body: "Poppins-Regular.ttf" },
    colors: (brand) => ({ brand, brandSoft: mix(brand, "#FFFFFF", 0.3), onBrand: "#FFFFFF", onBrandMuted: "#FFFFFFD9" }),
    screen: (_i, ctx) => ({
      background: { type: "linear-gradient", angle: 160, stops: [["$brand", 0], ["$brandSoft", 1]] },
      layers: [
        text(ctx.titleKey, "$heading", 0.08, "$onBrand", { x: 0.08, y: 0.045, w: 0.84, h: 0.12 }, { valign: "bottom" }),
        text(ctx.subKey, "$body", 0.04, "$onBrandMuted", { x: 0.1, y: 0.175, w: 0.8, h: 0.05 }),
        device(ctx, 0.14, 0.26, 0.72),
      ],
    }),
  },
  {
    id: "editorial",
    name: "Editorial",
    blurb: "Serif headline on a pale page, phone framed with space around it",
    fonts: { heading: "DMSerifDisplay-Regular.ttf", body: "InstrumentSans-Regular.ttf" },
    colors: (brand) => ({ brand, page: mix(brand, "#F4F5F7", 0.92), ink: "#15171A", inkMuted: "#15171AA6" }),
    screen: (_i, ctx) => ({
      background: { type: "solid", color: "$page" },
      layers: [
        { type: "shape", shape: "rect", color: "$brand", radius: 0, box: { x: 0.44, y: 0.055, w: 0.12, h: 0.004 }, rotate: 0, opacity: 1 },
        text(ctx.titleKey, "$heading", 0.088, "$ink", { x: 0.08, y: 0.075, w: 0.84, h: 0.14 }, { lineHeight: 1.05 }),
        text(ctx.subKey, "$body", 0.036, "$inkMuted", { x: 0.12, y: 0.22, w: 0.76, h: 0.045 }),
        device(ctx, 0.2, 0.3, 0.6),
      ],
    }),
  },
  {
    id: "tilt",
    name: "Tilt",
    blurb: "Heavy grotesque on dark, phones leaning in alternate directions",
    fonts: { heading: "BricolageGrotesque-ExtraBold.ttf", body: "InstrumentSans-SemiBold.ttf" },
    colors: (brand) => ({ brand, night: "#121418", nightSoft: mix(brand, "#121418", 0.82), onNight: "#F5F6F8", accent: mix(brand, "#FFFFFF", 0.15) }),
    screen: (i, ctx) => ({
      background: { type: "linear-gradient", angle: i % 2 ? 200 : 160, stops: [["$night", 0], ["$nightSoft", 1]] },
      layers: [
        { type: "shape", shape: "ellipse", color: "$brand", radius: 0, box: { x: i % 2 ? -0.35 : 0.35, y: 0.5, w: 1, h: 0.56 }, rotate: 0, opacity: 0.35 },
        text(ctx.titleKey, "$heading", 0.092, "$onNight", { x: 0.07, y: 0.05, w: 0.86, h: 0.15 }, { align: "left", lineHeight: 1.0, valign: "bottom" }),
        text(ctx.subKey, "$body", 0.038, "$accent", { x: 0.07, y: 0.21, w: 0.86, h: 0.045 }, { align: "left" }),
        device(ctx, 0.15, 0.3, 0.7, { rotate: i % 2 ? 6 : -6 }),
      ],
    }),
  },
  {
    id: "flip",
    name: "Flip",
    blurb: "Phone hangs from the top, caption sits at the bottom",
    fonts: { heading: "InstrumentSans-SemiBold.ttf", body: "InstrumentSans-Regular.ttf" },
    colors: (brand) => ({ brand, brandDeep: mix(brand, "#000000", 0.25), onBrand: "#FFFFFF", onBrandMuted: "#FFFFFFCC" }),
    screen: (_i, ctx) => {
      const w = 0.72;
      const h = deviceH(ctx, w);
      return {
        background: { type: "linear-gradient", angle: 180, stops: [["$brand", 0], ["$brandDeep", 1]] },
        layers: [
          device(ctx, 0.14, 0.72 - h, w),
          text(ctx.titleKey, "$heading", 0.078, "$onBrand", { x: 0.08, y: 0.76, w: 0.84, h: 0.12 }, { lineHeight: 1.08 }),
          text(ctx.subKey, "$body", 0.038, "$onBrandMuted", { x: 0.1, y: 0.885, w: 0.8, h: 0.05 }),
        ],
      };
    },
  },
];

export function findTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}

/** Linear mix of two #RRGGBB colours; t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16);
  const pb = parseInt(b.slice(1, 7), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(pa, s) * (1 - t) + ch(pb, s) * t));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const PLACEHOLDER_CAPTIONS = [
  ["Say what this screen does", "One short line of detail"],
  ["Show the moment it pays off", "Keep it to a few words"],
  ["Lead with the reason to install", "Captions shrink to fit their box"],
  ["End with what makes you different", "Drop a screenshot on the phone"],
];

/** A new project: one Play phone target and four screens waiting for captures. */
export function newProject(name: string, templateId: string, brand: string): { doc: Project; fonts: string[] } {
  const t = findTemplate(templateId);
  const W = 1080;
  const H = 1920;
  const screens: Screen[] = [];
  const captions: Project["captions"] = {};
  PLACEHOLDER_CAPTIONS.forEach(([title, sub], i) => {
    const id = `screen-${i + 1}`;
    captions[`${id}.title`] = { en: title! };
    captions[`${id}.sub`] = { en: sub! };
    const ctx: LayoutContext = { aspect: W / H, titleKey: `${id}.title`, subKey: `${id}.sub`, capture: "", frame: DEFAULT_FRAME };
    screens.push({ id, ...t.screen(i, ctx) });
  });
  const doc: Project = {
    schemaVersion: 1,
    name,
    locales: { default: "en", list: ["en"] },
    targets: [{ id: "play-phone", store: "play", device: "phone", size: [W, H], format: "png" }],
    theme: { fonts: { heading: `fonts/${t.fonts.heading}`, body: `fonts/${t.fonts.body}` }, colors: t.colors(brand) },
    screens,
    captions,
  };
  return { doc, fonts: [t.fonts.heading, t.fonts.body] };
}

/** What a screen is "about", so a template can be re-applied without losing content. */
function contentOf(screen: Screen) {
  const texts = screen.layers.filter((l): l is TextLayer => l.type === "text");
  const dev = screen.layers.find((l): l is DeviceLayer => l.type === "device");
  const key = (l: TextLayer | undefined) => (l?.text.startsWith("@caption.") ? l.text.slice(9) : undefined);
  return {
    title: texts[0],
    sub: texts[1],
    titleKey: key(texts[0]),
    subKey: key(texts[1]),
    capture: dev?.capture ?? "",
    frame: typeof dev?.frame === "string" ? dev.frame : (dev?.frame.android ?? DEFAULT_FRAME),
    variant: dev?.variant,
  };
}

/**
 * Re-lays out screens with a template. Literal text is turned into captions
 * so nothing typed is lost. Returns the fonts the template needs.
 *
 * On every screen, the template becomes the project's theme. On some
 * screens only, the theme is left alone: those screens get the template's
 * fonts and colours as plain values (still following the brand colour), so
 * the other screens don't change.
 */
export function applyTemplate(doc: Project, templateId: string, screenIds?: string[]): string[] {
  const t = findTemplate(templateId);
  const target = doc.targets[0]!;
  const brand = doc.theme.colors.brand ?? "#E0237A";
  const colors = t.colors(brand.startsWith("$") ? "#E0237A" : brand);
  const fonts: Record<string, string> = { heading: `fonts/${t.fonts.heading}`, body: `fonts/${t.fonts.body}` };
  const partial = !!screenIds && doc.screens.some((s) => !screenIds.includes(s.id));
  if (!partial) {
    doc.theme.fonts.heading = fonts.heading!;
    doc.theme.fonts.body = fonts.body!;
    doc.theme.colors = { ...doc.theme.colors, ...colors };
  }
  const literal = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value), (key, v) => {
      if (typeof v !== "string" || !v.startsWith("$") || v === "$brand") return v;
      const name = v.slice(1);
      return key === "font" ? (fonts[name] ?? v) : (colors[name] ?? v);
    });
  doc.screens.forEach((screen, i) => {
    if (screenIds && !screenIds.includes(screen.id)) return;
    const c = contentOf(screen);
    const ensure = (key: string | undefined, layer: TextLayer | undefined, fallback: string) => {
      if (key) return key;
      const k = `${screen.id}.${fallback}`;
      doc.captions[k] = { [doc.locales.default]: layer?.text ?? "" };
      return k;
    };
    const ctx: LayoutContext = {
      aspect: target.size[0] / target.size[1],
      titleKey: ensure(c.titleKey, c.title, "title"),
      subKey: ensure(c.subKey, c.sub, "sub"),
      capture: c.capture,
      frame: c.frame,
      variant: c.variant,
    };
    const next = partial ? literal(t.screen(i, ctx)) : t.screen(i, ctx);
    screen.background = next.background;
    screen.layers = next.layers;
  });
  pruneThemeColors(doc);
  return [t.fonts.heading, t.fonts.body];
}

/** Drops theme colours nothing refers to any more, keeping `brand`. */
export function pruneThemeColors(doc: Project) {
  const json = JSON.stringify([doc.screens, doc.theme.colors]);
  for (const name of Object.keys(doc.theme.colors)) {
    if (name === "brand") continue;
    if (!json.includes(`"$${name}"`)) delete doc.theme.colors[name];
  }
}

/** Every bundled font, for the font picker. */
export const BUNDLED_FONTS = [
  { file: "Poppins-Regular.ttf", label: "Poppins Regular" },
  { file: "Poppins-SemiBold.ttf", label: "Poppins SemiBold" },
  { file: "Poppins-Bold.ttf", label: "Poppins Bold" },
  { file: "DMSerifDisplay-Regular.ttf", label: "DM Serif Display" },
  { file: "InstrumentSans-Regular.ttf", label: "Instrument Sans Regular" },
  { file: "InstrumentSans-SemiBold.ttf", label: "Instrument Sans SemiBold" },
  { file: "BricolageGrotesque-Bold.ttf", label: "Bricolage Grotesque Bold" },
  { file: "BricolageGrotesque-ExtraBold.ttf", label: "Bricolage Grotesque ExtraBold" },
];
