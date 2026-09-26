import { z } from "zod";

/** The only schema version this build reads and writes. */
export const SCHEMA_VERSION = 1;

/** A value in the 0..1 range, as a fraction of canvas width or height. */
const fraction = z.number().min(-1).max(2);

/** A colour literal (#RGB, #RRGGBB, #RRGGBBAA) or a `$theme` colour reference. */
export const ColorRef = z
  .string()
  .regex(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|\$[A-Za-z][\w-]*)$/, "expected #hex or $themeColor");

/** Plain text, or `@caption.key` to look up a localized caption. */
export const TextRef = z.string();

export const Box = z.object({
  x: fraction,
  y: fraction,
  w: z.number().positive().max(3),
  h: z.number().positive().max(3),
});

export const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);

export const Target = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  store: z.enum(["play", "appstore"]),
  /** Store device class this target is uploaded as, e.g. "phone" or "iphone-6.9". */
  device: z.string().optional(),
  size: Size,
  format: z.enum(["png", "jpeg"]).default("png"),
});

export const SolidBackground = z.object({
  type: z.literal("solid"),
  color: ColorRef,
});

export const LinearGradientBackground = z.object({
  type: z.literal("linear-gradient"),
  /** CSS convention: 0 points up, 90 points right, 180 points down. */
  angle: z.number().default(180),
  stops: z.array(z.tuple([ColorRef, z.number().min(0).max(1)])).min(2),
});

export const ImageBackground = z.object({
  type: z.literal("image"),
  src: z.string(),
  fit: z.enum(["cover", "contain"]).default("cover"),
  color: ColorRef.optional(),
});

export const Background = z.discriminatedUnion("type", [
  SolidBackground,
  LinearGradientBackground,
  ImageBackground,
]);

const layerBase = {
  box: Box,
  rotate: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
};

export const TextLayer = z.object({
  type: z.literal("text"),
  text: TextRef,
  /** A font path relative to the project, or a `$theme` font reference. */
  font: z.string(),
  /** Font size as a fraction of canvas width. */
  size: z.number().positive(),
  lineHeight: z.number().positive().default(1.2),
  color: ColorRef.default("#000000"),
  align: z.enum(["left", "center", "right"]).default("center"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  /** "shrink" reduces the size until the text fits the box; "none" lets it overflow. */
  fit: z.enum(["shrink", "none"]).default("shrink"),
  /** Even out line lengths so the last line isn't a single word. */
  balance: z.boolean().default(true),
  ...layerBase,
});

export const ImageLayer = z.object({
  type: z.literal("image"),
  src: z.string(),
  fit: z.enum(["cover", "contain", "fill"]).default("contain"),
  radius: z.number().min(0).default(0),
  ...layerBase,
});

export const ShapeLayer = z.object({
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse"]),
  color: ColorRef,
  /** Corner radius as a fraction of canvas width (rect only). */
  radius: z.number().min(0).default(0),
  ...layerBase,
});

export const FrameChoice = z.union([
  z.string(),
  z.object({ android: z.string().optional(), ios: z.string().optional() }),
]);

export const DeviceLayer = z.object({
  type: z.literal("device"),
  /** A frame id, or one per platform so a design renders on both stores. */
  frame: FrameChoice,
  variant: z.string().optional(),
  /** Capture file name, resolved per locale under captures/<locale>/. */
  capture: z.string().default(""),
  shadow: z.boolean().default(true),
  ...layerBase,
});

export const Layer = z.discriminatedUnion("type", [TextLayer, ImageLayer, ShapeLayer, DeviceLayer]);

export const Screen = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  background: Background,
  layers: z.array(Layer).default([]),
});

export const Project = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string(),
  locales: z.object({
    default: z.string(),
    list: z.array(z.string()).min(1),
  }),
  targets: z.array(Target).min(1),
  theme: z
    .object({
      fonts: z.record(z.string(), z.string()).default({}),
      colors: z.record(z.string(), ColorRef).default({}),
    })
    .default({ fonts: {}, colors: {} }),
  screens: z.array(Screen).min(1),
  /** caption key -> locale -> text */
  captions: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});

export type ColorRef = z.infer<typeof ColorRef>;
export type Box = z.infer<typeof Box>;
export type Target = z.infer<typeof Target>;
export type Background = z.infer<typeof Background>;
export type TextLayer = z.infer<typeof TextLayer>;
export type ImageLayer = z.infer<typeof ImageLayer>;
export type ShapeLayer = z.infer<typeof ShapeLayer>;
export type DeviceLayer = z.infer<typeof DeviceLayer>;
export type Layer = z.infer<typeof Layer>;
export type Screen = z.infer<typeof Screen>;
export type Project = z.infer<typeof Project>;
/** The shape people write, before defaults are applied. */
export type ProjectInput = z.input<typeof Project>;
