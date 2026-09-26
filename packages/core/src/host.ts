/**
 * Everything the renderer needs from its environment. The browser host wraps
 * OffscreenCanvas and FontFace; the Node host wraps @napi-rs/canvas. The
 * renderer itself never touches the file system, DOM or network.
 */
export type Ctx = CanvasRenderingContext2D;

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Ctx | null;
}

export interface ImageLike {
  width: number;
  height: number;
}

export interface RenderHost {
  createCanvas(width: number, height: number): CanvasLike;
  /** Loads a project-relative image, or returns null if it doesn't exist. */
  loadImage(path: string): Promise<ImageLike | null>;
  /**
   * Loads a project-relative font file and registers it under `family`.
   * Returns the raw bytes so core can read vertical metrics itself.
   */
  loadFont(path: string, family: string): Promise<Uint8Array>;
  /** Loads a project-relative JSON file, or returns null if it doesn't exist. */
  loadJson(path: string): Promise<unknown | null>;
  /** zlib deflate, used by the PNG encoder. */
  deflate(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  encodeJpeg(canvas: CanvasLike, quality: number): Promise<Uint8Array>;
}
