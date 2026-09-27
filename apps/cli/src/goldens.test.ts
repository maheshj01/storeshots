import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { parseProject } from "@storeshots/schema";
import { AssetCache, encodeCanvas, exportProject, readPngHeader, renderScreen } from "@storeshots/core";
import { nodeHost, readProjectFile } from "@storeshots/node";

/**
 * Golden images for the epoch fixture, rendered at half size to keep the
 * repo small. Regenerate after an intended visual change with
 *   UPDATE_GOLDENS=1 pnpm test
 * and review the images in the diff.
 */
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = `${repo}examples/epoch`;
const goldens = `${repo}tools/goldens/epoch`;
const update = process.env.UPDATE_GOLDENS === "1";
/** Share of pixels allowed to differ by more than 8/255, for Skia upgrades. */
const TOLERANCE = 0.001;

async function pixels(bytes: Uint8Array) {
  const img = await loadImage(Buffer.from(bytes));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

describe("epoch goldens", async () => {
  const parsed = parseProject(await readProjectFile(fixture));
  if (!parsed.ok) throw new Error("fixture invalid");
  const project = parsed.project;
  const host = nodeHost(fixture);
  const cache = new AssetCache(host);
  const cases = [
    ...project.screens.map((s) => ["en", s.id] as const),
    ["de", "timeline"] as const,
  ];

  it.each(cases)("%s/%s", async (locale, screen) => {
    const { canvas } = await renderScreen(project, { screen, target: "play-phone", locale, scale: 0.5 }, cache);
    const bytes = await encodeCanvas(canvas, "png", host);
    const file = `${goldens}/${locale}_${screen}.png`;
    if (update || !existsSync(file)) {
      mkdirSync(goldens, { recursive: true });
      writeFileSync(file, bytes);
      if (!update) throw new Error(`golden created: ${file}; review it and re-run`);
      return;
    }
    const [a, b] = await Promise.all([pixels(bytes), pixels(new Uint8Array(readFileSync(file)))]);
    expect([a.w, a.h]).toEqual([b.w, b.h]);
    let off = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.max(
        Math.abs(a.data[i]! - b.data[i]!),
        Math.abs(a.data[i + 1]! - b.data[i + 1]!),
        Math.abs(a.data[i + 2]! - b.data[i + 2]!),
      );
      if (d > 8) off++;
    }
    expect(off / (a.w * a.h)).toBeLessThanOrEqual(TOLERANCE);
  });
});

// Full-size renders of every screen and locale: allow for slow CI machines.
describe("export", { timeout: 30_000 }, () => {
  it("writes store-valid, alpha-free PNGs for every locale", async () => {
    const parsed = parseProject(await readProjectFile(fixture));
    if (!parsed.ok) throw new Error("fixture invalid");
    const headers: ReturnType<typeof readPngHeader>[] = [];
    const summary = await exportProject(parsed.project, nodeHost(fixture), {
      onImage: (img) => void headers.push(readPngHeader(img.bytes)),
    });
    expect(summary.errors).toEqual([]);
    expect(summary.warnings).toEqual([]);
    expect(headers).toHaveLength(8);
    for (const h of headers) expect(h).toEqual({ width: 1080, height: 1920, colorType: 2, hasAlpha: false });
  });

  it("blocks targets a store would reject", async () => {
    const parsed = parseProject(await readProjectFile(fixture));
    if (!parsed.ok) throw new Error("fixture invalid");
    const project = { ...parsed.project, targets: [{ id: "bad", store: "play" as const, device: "phone", size: [1000, 2100] as [number, number], format: "png" as const }] };
    const summary = await exportProject(project, nodeHost(fixture), { locales: ["en"] });
    expect(summary.images).toBe(0);
    expect(new Set(summary.errors.map((e) => e.rule))).toEqual(new Set(["play.maxAspect"]));
  });
});
