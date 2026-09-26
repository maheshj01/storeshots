import { useState } from "react";
import { X } from "lucide-react";
import type { ExportSummary } from "@storeshots/core";
import { useEditor } from "../state/store.ts";
import { runExport } from "../engine/exporter.ts";
import { download, slug } from "../state/io.ts";
import { deviceLabel } from "./Table.tsx";

type Scope = "all" | "screen";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc!);
  const selection = useEditor((s) => s.selection);
  const locale = useEditor((s) => s.locale);
  const [scope, setScope] = useState<Scope>("all");
  const [allLocales, setAllLocales] = useState(true);
  const [targets, setTargets] = useState<string[]>(doc.targets.map((t) => t.id));
  const [format, setFormat] = useState<"target" | "png" | "jpeg">("target");
  const [layout, setLayout] = useState<"plain" | "fastlane">("plain");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const screens = scope === "all" ? doc.screens.length : 1;
  const locales = allLocales ? doc.locales.list.length : 1;
  const count = screens * locales * targets.length;

  const start = async () => {
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: count });
    const { assets } = useEditor.getState();
    try {
      const { summary, zip } = await runExport(
        {
          doc: JSON.parse(JSON.stringify(doc)),
          assets: [...assets],
          locales: allLocales ? undefined : [locale],
          targets,
          screens: scope === "screen" && selection.screen ? [selection.screen] : undefined,
          format,
          layout,
        },
        (done, total) => setProgress({ done, total }),
      );
      setResult(summary);
      if (zip) download(new Blob([zip as BlobPart], { type: "application/zip" }), `${slug(doc.name)}-screenshots.zip`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="export-title" onPointerDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="dialog" style={{ width: "min(520px, 100%)" }}>
        <header>
          <h2 id="export-title">Export screenshots</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close" disabled={!!progress}>
            <X aria-hidden />
          </button>
        </header>
        <div className="body">
          <div className="grid2">
            <fieldset className="choice" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Screens</legend>
              <label>
                <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> All {doc.screens.length}
              </label>
              <label>
                <input type="radio" checked={scope === "screen"} onChange={() => setScope("screen")} /> Selected screen only
              </label>
            </fieldset>
            <fieldset className="choice" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Languages</legend>
              <label>
                <input type="radio" checked={allLocales} onChange={() => setAllLocales(true)} /> All ({doc.locales.list.join(", ")})
              </label>
              <label>
                <input type="radio" checked={!allLocales} onChange={() => setAllLocales(false)} /> {locale} only
              </label>
            </fieldset>
          </div>
          <fieldset className="choice" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Store sizes</legend>
            {doc.targets.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={targets.includes(t.id)}
                  onChange={(e) => setTargets(e.target.checked ? [...targets, t.id] : targets.filter((x) => x !== t.id))}
                />
                {deviceLabel(t)} · <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{t.size.join(" × ")}</span>
              </label>
            ))}
          </fieldset>
          <div className="grid2">
            <label className="field">
              <span>Format</span>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="target">As set per store size</option>
                <option value="png">PNG, no transparency</option>
                <option value="jpeg">JPEG</option>
              </select>
            </label>
            <label className="field">
              <span>Folders in the zip</span>
              <select className="input" value={layout} onChange={(e) => setLayout(e.target.value as typeof layout)}>
                <option value="plain">By size and language</option>
                <option value="fastlane">fastlane supply and deliver</option>
              </select>
            </label>
          </div>
          {progress && (
            <div className="field">
              <span>
                Rendering {Math.min(progress.done + 1, progress.total)} of {progress.total} at full size…
              </span>
              <div className="progress">
                <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          )}
          {error && <div className="error">Export stopped: {error}</div>}
          {result && (
            <div className="warnings">
              {result.images > 0 ? (
                <p className="hint" style={{ color: "var(--ok)" }}>
                  Exported {result.images} {result.images === 1 ? "image" : "images"}. The zip is in your downloads.
                </p>
              ) : (
                <div className="error">Nothing was exported.</div>
              )}
              {result.errors.map((e, i) => (
                <div key={i} className="error">
                  Blocked: {e.message}
                </div>
              ))}
              {result.warnings.slice(0, 6).map((w, i) => (
                <div key={i} className="warning">
                  {w.where}: {w.message}
                </div>
              ))}
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose} disabled={!!progress}>
            {result ? "Done" : "Cancel"}
          </button>
          <button type="button" className="btn primary" onClick={start} disabled={!!progress || count === 0}>
            Export {count} {count === 1 ? "image" : "images"}
          </button>
        </footer>
      </div>
    </div>
  );
}
