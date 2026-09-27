/**
 * A vector frame: a parametric description of a device, in millimetres,
 * drawn by the core renderer with Canvas 2D paths. No bitmap art, so frames
 * stay sharp at any size, recolour per variant, and carry no art licence.
 */
export interface VectorFrame {
  kind: "vector";
  id: string;
  name: string;
  platform: "android" | "ios";
  /** Where the dimensions come from, for reviewers of new catalog entries. */
  source: string;
  /** Native display resolution in pixels; captures at this size fit exactly. */
  display: [number, number];
  body: { w: number; h: number; radius: number; rim: number };
  screen: { x: number; y: number; w: number; h: number; radius: number };
  /**
   * Camera cutout, centred at cx, cy (mm from the screen's top-left):
   * a round punch hole, or a pill such as the Dynamic Island.
   */
  cutout?:
    | { type: "punch-hole"; cx: number; cy: number; d: number }
    | { type: "island"; cx: number; cy: number; w: number; h: number }
    | { type: "none" };
  /** Buttons on the body edge; from/to are millimetres from the top of the body. */
  buttons: Array<{ side: "left" | "right"; from: number; to: number; depth: number }>;
  variants: Record<string, { body: string; rim: string; button: string }>;
  defaultVariant: string;
}

/**
 * A bitmap frame imported from art on the user's own machine: an Android
 * Emulator skin, or the bezel Xcode's Simulator draws. Never redistributed.
 * Sizes are in the art's pixels.
 */
export interface BitmapFrame {
  kind: "bitmap";
  id: string;
  name: string;
  platform: "android" | "ios";
  size: [number, number];
  display: [number, number];
  /** Display top-left inside the skin. */
  screen: { x: number; y: number; w: number; h: number; radius: number };
  background: { src: string; x: number; y: number };
  /** Display-sized overlay drawn over the screen: Android skins shape corners and the camera cutout this way. */
  mask?: { src: string } | undefined;
  /**
   * Display-sized alpha mask the screenshot is cut to: opaque where the
   * screen shows. The Simulator's iPhone screens use this, since their
   * rounded corners reach past the bezel's outer curve.
   */
  screenMask?: { src: string } | undefined;
}

export type FrameDef = VectorFrame | BitmapFrame;
