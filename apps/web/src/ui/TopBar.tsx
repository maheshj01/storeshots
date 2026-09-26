import { useEffect, useState } from "react";
import { Download, FolderInput, Redo2, Undo2, Package } from "lucide-react";
import { useEditor } from "../state/store.ts";
import { download, ensureWritable, exportZip, saveToFolder, slug } from "../state/io.ts";
import { deviceLabel } from "./Table.tsx";
import { TextInput } from "./fields.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { toast } from "./toast.ts";

export function TopBar({ onHome, saved }: { onHome: () => void; saved: boolean }) {
  const doc = useEditor((s) => s.doc!);
  const locale = useEditor((s) => s.locale);
  const target = useEditor((s) => s.target);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const folder = useEditor((s) => s.folder);
  const folderDirty = useEditor((s) => !s.docSavedToFolder || s.unsavedAssets.size > 0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const open = () => setExporting(true);
    window.addEventListener("storeshots:export", open);
    return () => window.removeEventListener("storeshots:export", open);
  }, []);

  const saveFolder = async () => {
    const s = useEditor.getState();
    if (!s.folder || !s.doc) return;
    if (!(await ensureWritable(s.folder))) return toast("Saving needs permission to write to the folder.", true);
    await saveToFolder(s.folder, s.doc, s.assets, s.unsavedAssets);
    s.markFolderSaved();
    toast(`Saved to ${s.folder.name}/storeshots.json`);
  };

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} title="All projects">
        <img src="/icon.svg" alt="" />
        <span className="hide-narrow">storeshots</span>
      </button>
      <TextInput
        className="name-input"
        aria-label="Project name"
        value={doc.name}
        onCommit={(v) => v.trim() && useEditor.getState().edit("Rename project", (d) => void (d.name = v.trim()))}
      />
      <span className="saved hide-narrow">{saved ? "Saved in this browser" : "Saving…"}</span>
      <span className="spacer" />
      {doc.targets.length > 1 && (
        <select className="input" style={{ width: "auto" }} value={target} onChange={(e) => useEditor.getState().setTarget(e.target.value)} aria-label="Store size">
          {doc.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {deviceLabel(t)} {t.size.join("×")}
            </option>
          ))}
        </select>
      )}
      {doc.locales.list.length > 1 && (
        <select className="input" style={{ width: "auto" }} value={locale} onChange={(e) => useEditor.getState().setLocale(e.target.value)} aria-label="Language">
          {doc.locales.list.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn ghost icon" title="Undo (⌘Z)" disabled={!canUndo} onClick={() => useEditor.getState().undo()}>
        <Undo2 aria-hidden />
      </button>
      <button type="button" className="btn ghost icon" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => useEditor.getState().redo()}>
        <Redo2 aria-hidden />
      </button>
      <span className="divider" />
      {folder && (
        <button type="button" className="btn" onClick={saveFolder} title={`Write storeshots.json and new files into ${folder.name}`}>
          <FolderInput aria-hidden /> <span className="hide-narrow">{folderDirty ? `Save to ${folder.name}` : `Saved to ${folder.name}`}</span>
        </button>
      )}
      <button
        type="button"
        className="btn"
        title="Download the project (storeshots.json and its files) as a zip"
        onClick={async () => {
          const s = useEditor.getState();
          download(await exportZip(s.doc!, s.assets), `${slug(s.doc!.name)}-project.zip`);
        }}
      >
        <Package aria-hidden /> <span className="hide-narrow">Project .zip</span>
      </button>
      <button type="button" className="btn primary" onClick={() => setExporting(true)} title="Render store-ready images (⌘E)">
        <Download aria-hidden /> Export
      </button>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </header>
  );
}
