import { readFile } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { deflateSync } from "node:zlib";
import { createCanvas, loadImage, GlobalFonts, type Canvas } from "@napi-rs/canvas";
import type { CanvasLike, ImageLike, RenderHost } from "@storeshots/core";

function inside(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes the project folder: ${path}`);
  return full;
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Render host for Node, backed by Skia through @napi-rs/canvas. */
export function nodeHost(projectDir: string): RenderHost {
  const root = resolve(projectDir);
  const registered = new Set<string>();
  return {
    createCanvas: (w, h) => createCanvas(w, h) as unknown as CanvasLike,
    async loadImage(path) {
      const bytes = await readOrNull(inside(root, path));
      return bytes ? ((await loadImage(bytes)) as unknown as ImageLike) : null;
    },
    async loadFont(path, family) {
      const bytes = await readOrNull(inside(root, path));
      if (!bytes) throw new Error(`font not found: ${path}`);
      if (!registered.has(family)) {
        if (!GlobalFonts.register(bytes, family)) throw new Error(`could not register font ${path}`);
        registered.add(family);
      }
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    async loadJson(path) {
      const bytes = await readOrNull(inside(root, path));
      return bytes ? JSON.parse(bytes.toString("utf8")) : null;
    },
    deflate: (data) => deflateSync(data, { level: 6 }),
    async encodeJpeg(canvas, quality) {
      return (canvas as unknown as Canvas).encode("jpeg", Math.round(quality * 100));
    },
  };
}

export async function readProjectFile(dir: string): Promise<unknown> {
  const text = await readFile(join(dir, "storeshots.json"), "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`storeshots.json is not valid JSON: ${(e as Error).message}`);
  }
}
