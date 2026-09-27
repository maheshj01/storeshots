import { useEffect, useRef, useState } from "react";
import { AssetCache, renderScreen, type RenderWarning } from "@storeshots/core";
import type { FrameDef } from "@storeshots/frames";
import type { Project } from "@storeshots/schema";
import { useEditor } from "../state/store.ts";
import { assetHost } from "./host.ts";

let current: { version: number; cache: AssetCache } | null = null;

/**
 * The asset cache for the open project. A new one is made whenever assets
 * change; decoded images survive because the host caches them per Blob.
 */
export function editorCache(): AssetCache {
  const { assets, assetsVersion } = useEditor.getState();
  if (!current || current.version !== assetsVersion) {
    current = { version: assetsVersion, cache: new AssetCache(assetHost(assets)) };
  }
  return current.cache;
}

export interface PreviewState {
  warnings: RenderWarning[];
  error: string | null;
}

/**
 * Preview renders run one per animation frame, most recent request per
 * canvas only, so a burst (every screen re-rendering after a zoom) is spread
 * over frames instead of blocking one. Screens outside the table's view
 * wait until they scroll into it.
 */
const queue = new Map<HTMLCanvasElement, () => Promise<void>>();
let draining = false;

function schedule(canvas: HTMLCanvasElement, job: () => Promise<void>) {
  queue.set(canvas, job);
  if (draining) return;
  draining = true;
  const next = () =>
    requestAnimationFrame(async () => {
      const entry = queue.entries().next();
      if (entry.done) {
        draining = false;
        return;
      }
      const [key, run] = entry.value;
      queue.delete(key);
      await run();
      next();
    });
  next();
}

/**
 * Renders one screen into a visible canvas whenever anything it depends on
 * changes, while the canvas is in (or near) the table's view. A render that
 * finishes after a newer one was requested is dropped.
 */
export function useScreenPreview(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  screenId: string,
  cssWidth: number,
): PreviewState {
  const screen = useEditor((s) => s.doc?.screens.find((x) => x.id === screenId));
  const theme = useEditor((s) => s.doc?.theme);
  const captions = useEditor((s) => s.doc?.captions);
  const targets = useEditor((s) => s.doc?.targets);
  const locales = useEditor((s) => s.doc?.locales);
  const locale = useEditor((s) => s.locale);
  const target = useEditor((s) => s.target);
  const assetsVersion = useEditor((s) => s.assetsVersion);
  const [state, setState] = useState<PreviewState>({ warnings: [], error: null });
  const [visible, setVisible] = useState(true);
  const generation = useRef(0);

  // Track whether the canvas is within a screen's width of the table's view.
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest(".table");
    if (!canvas || !root) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { root, rootMargin: "50%" });
    io.observe(canvas);
    return () => io.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    const doc = useEditor.getState().doc;
    const canvas = canvasRef.current;
    if (!doc || !screen || !canvas || cssWidth <= 0 || !visible) return;
    const gen = ++generation.current;
    schedule(canvas, async () => {
      if (gen !== generation.current) return;
      const t = doc.targets.find((x) => x.id === target) ?? doc.targets[0]!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(1, (cssWidth * dpr) / t.size[0]);
      try {
        const result = await renderScreen(
          doc,
          { screen: screenId, target: t.id, locale, scale, missingCapture: "placeholder" },
          editorCache(),
        );
        if (gen !== generation.current) return;
        const src = result.canvas as unknown as OffscreenCanvas;
        if (canvas.width !== src.width || canvas.height !== src.height) {
          canvas.width = src.width;
          canvas.height = src.height;
        }
        canvas.getContext("2d")!.drawImage(src, 0, 0);
        // Re-render React only when what it shows changed.
        setState((prev) =>
          prev.error === null && JSON.stringify(prev.warnings) === JSON.stringify(result.warnings) ? prev : { warnings: result.warnings, error: null },
        );
      } catch (e) {
        if (gen === generation.current) setState({ warnings: [], error: (e as Error).message });
      }
    });
    return () => {
      // A newer request replaces this one; bumping the generation drops it if it already started.
      generation.current++;
    };
  }, [screen, theme, captions, targets, locales, locale, target, assetsVersion, cssWidth, screenId, canvasRef, visible]);

  return state;
}

/** Resolves a frame definition (catalog or imported) for overlays. */
export function useFrameDef(id: string | undefined): FrameDef | null {
  const assetsVersion = useEditor((s) => s.assetsVersion);
  const [frame, setFrame] = useState<FrameDef | null>(null);
  useEffect(() => {
    let live = true;
    if (!id) return setFrame(null);
    editorCache()
      .frame(id)
      .then((f) => live && setFrame(f))
      .catch(() => live && setFrame(null));
    return () => {
      live = false;
    };
  }, [id, assetsVersion]);
  return frame;
}

/** Renders a standalone project (templates, frame thumbnails) to a data URL. */
export async function renderStandalone(
  doc: Project,
  assets: Map<string, Blob>,
  screen: string,
  scale: number,
): Promise<string> {
  const cache = new AssetCache(assetHost(assets));
  const { canvas } = await renderScreen(
    doc,
    { screen, target: doc.targets[0]!.id, locale: doc.locales.default, scale, missingCapture: "placeholder" },
    cache,
  );
  const blob = await (canvas as unknown as OffscreenCanvas).convertToBlob({ type: "image/png" });
  return URL.createObjectURL(blob);
}
