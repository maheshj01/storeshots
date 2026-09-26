import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { TEMPLATES, fetchBundledFonts, newProject } from "../state/templates.ts";
import { renderStandalone } from "../engine/preview.ts";
import { newProjectId, saveAssets, saveDoc } from "../state/persist.ts";
import { useEditor } from "../state/store.ts";
import { toast } from "./toast.ts";

const BRANDS = ["#E0237A", "#2F6FEB", "#0E9F6E", "#F0561F", "#7C3AED", "#111418"];

function TemplatePreview({ id, brand }: { id: string; brand: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    (async () => {
      const { doc, fonts } = newProject("Preview", id, brand);
      const assets = new Map(await fetchBundledFonts(fonts));
      const url = await renderStandalone(doc, assets, doc.screens[0]!.id, 0.22);
      if (live) setSrc(url);
      else URL.revokeObjectURL(url);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [id, brand]);
  return src ? <img src={src} alt="" /> : <div className="ph" />;
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("My app");
  const [template, setTemplate] = useState(TEMPLATES[0]!.id);
  const [brand, setBrand] = useState(BRANDS[0]!);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const { doc, fonts } = newProject(name.trim() || "Untitled", template, brand);
      const assets = await fetchBundledFonts(fonts);
      const id = newProjectId();
      await saveAssets(id, assets);
      await saveDoc(id, doc);
      useEditor.getState().open({ id, doc, assets: new Map(assets) });
    } catch (e) {
      toast((e as Error).message, true);
      setBusy(false);
    }
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="new-title" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <header>
          <h2 id="new-title">New project</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </button>
        </header>
        <div className="body">
          <div className="grid2">
            <label className="field">
              <span>App name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && create()} />
            </label>
            <div className="field">
              <span>Brand colour</span>
              <div className="row">
                {BRANDS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="chip"
                    style={{ padding: 3 }}
                    aria-pressed={brand === b}
                    aria-label={`Brand colour ${b}`}
                    onClick={() => setBrand(b)}
                  >
                    <i style={{ background: b, width: 18, height: 18 }} />
                  </button>
                ))}
                <label className="swatch" title="Any colour">
                  <i style={{ background: brand }} />
                  <input type="color" value={brand} onChange={(e) => setBrand(e.target.value.toUpperCase())} />
                </label>
              </div>
            </div>
          </div>
          <div className="field">
            <span>Template</span>
            <div className="templates">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="template" aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>
                  <TemplatePreview id={t.id} brand={brand} />
                  <b>{t.name}</b>
                  <small>{t.blurb}</small>
                </button>
              ))}
            </div>
          </div>
          <p className="hint">Starts as a Google Play phone listing at 1080 × 1920 with four screens. You can change everything later.</p>
        </div>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={create} disabled={busy}>
            Create project
          </button>
        </footer>
      </div>
    </div>
  );
}
