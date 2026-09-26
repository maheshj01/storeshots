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
 * Renders one screen into a visible canvas whenever anything it depends on
 * changes. Renders are coalesced to one per animation frame, and a render
 * that finishes after a newer one started is dropped.
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
  const generation = useRef(0);

  useEffect(() => {
    const doc = useEditor.getState().doc;
    const canvas = canvasRef.current;
    if (!doc || !screen || !canvas || cssWidth <= 0) return;
    const gen = ++generation.current;
    const raf = requestAnimationFrame(async () => {
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
        setState({ warnings: result.warnings, error: null });
      } catch (e) {
        if (gen === generation.current) setState({ warnings: [], error: (e as Error).message });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [screen, theme, captions, targets, locales, locale, target, assetsVersion, cssWidth, screenId, canvasRef]);

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
