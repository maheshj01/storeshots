import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { renderDevice } from "@storeshots/core";
import { useEditor, useTarget } from "../state/store.ts";
import { editorCache } from "../engine/preview.ts";
import { download, slug } from "../state/io.ts";
import { Section, Toggle } from "./fields.tsx";
import { toast } from "./toast.ts";

/** Preview renders at this share of full size: enough for the panel's width. */
const PREVIEW_SCALE = 0.2;

/**
 * A selected phone on its own: a live preview and a download of the framed
 * screenshot as a transparent PNG, with the screen at the screenshot's own
 * resolution. For websites, docs and social posts, outside the listing.
 */
export function DeviceExport({ screen, layer }: { screen: string; layer: number }) {
  const doc = useEditor((s) => s.doc!);
  const assetsVersion = useEditor((s) => s.assetsVersion);
  const locale = useEditor((s) => s.locale);
  const target = useTarget()!;
  const device = doc.screens.find((s) => s.id === screen)?.layers[layer];
  const [shadow, setShadow] = useState(false);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stale = false;
    const t = window.setTimeout(async () => {
      try {
        const req = { screen, layer, target: target.id, locale, shadow, missingCapture: "placeholder" as const };
        const { canvas: out } = await renderDevice(doc, { ...req, scale: PREVIEW_SCALE }, editorCache());
        const el = canvas.current;
        if (stale || !el) return;
        const src = out as unknown as OffscreenCanvas;
        el.width = src.width;
        el.height = src.height;
        el.getContext("2d")!.drawImage(src, 0, 0);
        setSize([Math.round(src.width / PREVIEW_SCALE), Math.round(src.height / PREVIEW_SCALE)]);
      } catch {
        // The layer is mid-change (say, a frame still loading); the next render catches up.
      }
    }, 150);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [doc, assetsVersion, screen, layer, target.id, locale, shadow]);

  if (device?.type !== "device") return null;

  const save = async () => {
    setBusy(true);
    try {
      const { canvas: out } = await renderDevice(doc, { screen, layer, target: target.id, locale, shadow, missingCapture: "placeholder" }, editorCache());
      const blob = await (out as unknown as OffscreenCanvas).convertToBlob({ type: "image/png" });
      const name = device.capture ? device.capture.replace(/\.[a-z]+$/i, "") : `${screen}-device`;
      download(blob, `${slug(name)}-framed${locale === doc.locales.default ? "" : `-${locale}`}.png`);
    } catch (e) {
      toast(`Couldn't render the phone: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Framed screenshot">
      <div className="device-export">
        <canvas ref={canvas} aria-label="The phone on its own, as it will download" />
      </div>
      <Toggle label="Drop shadow" checked={shadow} onChange={setShadow} />
      <button type="button" className="btn primary" onClick={save} disabled={busy}>
        <Download aria-hidden /> {busy ? "Rendering…" : "Download PNG"}
      </button>
      <p className="hint">
        {size ? `${size[0]} × ${size[1]} px, ` : ""}transparent background{device.capture ? ", screen at the screenshot's own resolution" : ""}. For your website, docs or
        social posts.
      </p>
    </Section>
  );
}
