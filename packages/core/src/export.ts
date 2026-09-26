import type { Project } from "@storeshots/schema";
import { checkImage, checkSet, type RuleViolation } from "@storeshots/stores";
import type { CanvasLike, RenderHost } from "./host.ts";
import { AssetCache, renderScreen, type RenderWarning } from "./render.ts";
import { encodePngRgb } from "./png.ts";

export interface ExportedImage {
  screen: string;
  target: string;
  locale: string;
  /** 1-based position in the listing. */
  index: number;
  format: "png" | "jpeg";
  bytes: Uint8Array;
  width: number;
  height: number;
  warnings: RenderWarning[];
  violations: RuleViolation[];
}

export async function encodeCanvas(
  canvas: CanvasLike,
  format: "png" | "jpeg",
  host: RenderHost,
  quality = 0.92,
): Promise<Uint8Array> {
  if (format === "jpeg") return host.encodeJpeg(canvas, quality);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return encodePngRgb(data, canvas.width, canvas.height, (d) => host.deflate(d));
}

export interface ExportOptions {
  locales?: string[] | undefined;
  targets?: string[] | undefined;
  /** Only render these screens. Set rules still count the whole listing. */
  screens?: string[] | undefined;
  /** Called before each image renders, for progress bars. */
  onProgress?: ((done: number, total: number) => void) | undefined;
  onImage?: ((img: ExportedImage) => void | Promise<void>) | undefined;
}

export interface ExportSummary {
  images: number;
  errors: RuleViolation[];
  warnings: Array<{ where: string; message: string }>;
}

/**
 * Renders every screen for every selected target and locale, checks each
 * image and each set against the store rules, and hands encoded images to
 * `onImage`. Images that break a store rule are not handed over.
 */
export async function exportProject(project: Project, host: RenderHost, opts: ExportOptions = {}): Promise<ExportSummary> {
  const cache = new AssetCache(host);
  const locales = opts.locales ?? project.locales.list;
  const targets = project.targets.filter((t) => !opts.targets || opts.targets.includes(t.id));
  const summary: ExportSummary = { images: 0, errors: [], warnings: [] };
  const selected = project.screens.filter((s) => !opts.screens || opts.screens.includes(s.id));
  const total = targets.length * locales.length * selected.length;
  let done = 0;

  for (const target of targets) {
    for (const locale of locales) {
      for (const v of checkSet({
        store: target.store,
        device: target.device,
        images: project.screens.map(() => ({ width: target.size[0], height: target.size[1] })),
      })) {
        const where = `${target.id}/${locale}`;
        if (v.severity === "error") summary.errors.push({ ...v, message: `${where}: ${v.message}` });
        else summary.warnings.push({ where, message: v.message });
      }
      let index = 0;
      for (const screen of project.screens) {
        index++;
        if (!selected.includes(screen)) continue;
        opts.onProgress?.(done++, total);
        const { canvas, warnings } = await renderScreen(project, { screen: screen.id, target: target.id, locale }, cache);
        const violations = checkImage({
          store: target.store,
          device: target.device,
          width: canvas.width,
          height: canvas.height,
          format: target.format,
          hasAlpha: false, // encodeCanvas never writes an alpha channel
        });
        const where = `${target.id}/${locale}/${screen.id}`;
        for (const w of warnings) summary.warnings.push({ where, message: w.message });
        const errors = violations.filter((v) => v.severity === "error");
        if (errors.length > 0) {
          summary.errors.push(...errors.map((v) => ({ ...v, message: `${where}: ${v.message}` })));
          continue;
        }
        const bytes = await encodeCanvas(canvas, target.format, host);
        summary.images++;
        await opts.onImage?.({
          screen: screen.id,
          target: target.id,
          locale,
          index,
          format: target.format,
          bytes,
          width: canvas.width,
          height: canvas.height,
          warnings,
          violations,
        });
      }
    }
  }
  opts.onProgress?.(total, total);
  return summary;
}

/** Output paths: a plain layout, or the folders fastlane supply and deliver read. */
export function outputPath(project: Project, img: ExportedImage, layout: "plain" | "fastlane"): string {
  const target = project.targets.find((t) => t.id === img.target)!;
  const ext = img.format === "jpeg" ? "jpg" : "png";
  const n = String(img.index).padStart(2, "0");
  if (layout === "plain") return `${img.target}/${img.locale}/${n}_${img.screen}.${ext}`;
  if (target.store === "play") {
    const folder =
      { "tablet-7": "sevenInchScreenshots", "tablet-10": "tenInchScreenshots", tv: "tvScreenshots", wear: "wearScreenshots" }[
        target.device ?? "phone"
      ] ?? "phoneScreenshots";
    return `metadata/android/${img.locale}/images/${folder}/${n}_${img.screen}.${ext}`;
  }
  return `screenshots/${img.locale}/${n}_${img.target}_${img.screen}.${ext}`;
}
