import type { CanvasLike, ImageLike, RenderHost } from "@storeshots/core";

/** Where the host reads project files from: the editor's in-memory assets. */
export interface AssetSource {
  get(path: string): Blob | undefined;
}

// Decoded images are cached per Blob, so replacing a file re-decodes it and
// unchanged files are decoded once for the whole session.
const decoded = new WeakMap<Blob, Promise<ImageBitmap>>();
const fontBytes = new WeakMap<Blob, Promise<Uint8Array>>();
const registered = new Map<string, Blob>();

function fontSet(): FontFaceSet {
  return (globalThis as unknown as { fonts?: FontFaceSet }).fonts ?? document.fonts;
}

export function decodeImage(blob: Blob): Promise<ImageBitmap> {
  let p = decoded.get(blob);
  if (!p) {
    p = createImageBitmap(blob, { colorSpaceConversion: "none" });
    decoded.set(blob, p);
  }
  return p;
}

/** Render host over in-memory assets. Works on the main thread and in workers. */
export function assetHost(assets: AssetSource): RenderHost {
  return {
    createCanvas(w, h) {
      const canvas = new OffscreenCanvas(w, h);
      // Software rasterization, matching Skia in the CLI (ADR 0002).
      canvas.getContext("2d", { willReadFrequently: true });
      return canvas as unknown as CanvasLike;
    },
    async loadImage(path) {
      const blob = assets.get(path);
      return blob ? ((await decodeImage(blob)) as ImageLike) : null;
    },
    async loadFont(path, family) {
      const blob = assets.get(path);
      if (!blob) throw new Error(`font not found: ${path}`);
      let bytes = fontBytes.get(blob);
      if (!bytes) {
        bytes = blob.arrayBuffer().then((b) => new Uint8Array(b));
        fontBytes.set(blob, bytes);
      }
      const data = await bytes;
      if (registered.get(family) !== blob) {
        const face = new FontFace(family, data.slice().buffer);
        await face.load();
        fontSet().add(face);
        registered.set(family, blob);
      }
      return data;
    },
    async loadJson(path) {
      const blob = assets.get(path);
      return blob ? JSON.parse(await blob.text()) : null;
    },
    async deflate(data) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
    async encodeJpeg(canvas, quality) {
      const blob = await (canvas as unknown as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}
