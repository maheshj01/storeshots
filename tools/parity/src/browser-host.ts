import type { CanvasLike, ImageLike, RenderHost } from "@storeshots/core";

/** Render host for browsers: OffscreenCanvas, FontFace, CompressionStream. */
export function browserHost(baseUrl: string, { gpu = false } = {}): RenderHost {
  const url = (path: string) => new URL(path, baseUrl).href;
  const get = async (path: string) => {
    const r = await fetch(url(path));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r;
  };
  return {
    createCanvas: (w, h) => {
      const canvas = new OffscreenCanvas(w, h);
      // Software rasterization, like Skia in Node; the GPU path antialiases
      // differently. The first getContext call fixes the settings.
      canvas.getContext("2d", { willReadFrequently: gpu === false });
      return canvas as unknown as CanvasLike;
    },
    async loadImage(path) {
      const r = await get(path);
      if (!r) return null;
      return (await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "default" })) as ImageLike;
    },
    async loadFont(path, family) {
      const r = await get(path);
      if (!r) throw new Error(`font not found: ${path}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const face = new FontFace(family, bytes);
      await face.load();
      document.fonts.add(face);
      return bytes;
    },
    async loadJson(path) {
      const r = await get(path);
      return r ? r.json() : null;
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
