import { useEffect, useState } from "react";
import { Download, FolderSync, FolderX, Redo2, Undo2, Package, Sparkles, FolderPlus } from "lucide-react";
import { useEditor } from "../state/store.ts";
import { canUseFolders, download, exportZip, slug } from "../state/io.ts";
import { linkFolder, reconnectFolder, useSyncStatus } from "../engine/folderSync.ts";
import { AiDialog } from "./AiDialog.tsx";
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
  const [exporting, setExporting] = useState(false);
  const [ai, setAi] = useState(false);

  useEffect(() => {
    const open = () => setExporting(true);
    window.addEventListener("storeshots:export", open);
    return () => window.removeEventListener("storeshots:export", open);
  }, []);

  useEffect(() => {
    const open = () => setAi(true);
    window.addEventListener("storeshots:ai", open);
    return () => window.removeEventListener("storeshots:ai", open);
  }, []);

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
      <FolderStatus />
      <button type="button" className="btn" onClick={() => setAi(true)} title="Edit these screenshots with Claude or another AI agent">
        <Sparkles aria-hidden /> <span className="hide-narrow">AI</span>
      </button>
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
      {ai && <AiDialog onClose={() => setAi(false)} />}
    </header>
  );
}

/** Where the project lives on disk, and whether it's in sync with the folder. */
function FolderStatus() {
  const folder = useEditor((s) => s.folder);
  const status = useSyncStatus((s) => s.status);
  if (!folder) {
    if (!canUseFolders) return null;
    return (
      <button
        type="button"
        className="btn hide-narrow"
        title="Save this project into a folder (e.g. in your app's repo) and keep it in sync, so AI agents and the CLI can work on it"
        onClick={async () => {
          try {
            const name = await linkFolder();
            if (name) toast(`Linked to ${name}. Changes sync both ways.`);
          } catch (e) {
            if ((e as DOMException).name !== "AbortError") toast((e as Error).message, true);
          }
        }}
      >
        <FolderPlus aria-hidden /> Link a folder
      </button>
    );
  }
  if (status.kind === "reconnect") {
    return (
      <button type="button" className="btn" onClick={() => void reconnectFolder()} title="Your browser needs permission again to read and write this folder">
        <FolderX aria-hidden /> <span className="hide-narrow">Reconnect {folder.name}</span>
      </button>
    );
  }
  const label = status.kind === "saving" ? `Saving to ${folder.name}…` : status.kind === "error" ? `${folder.name}: sync problem` : `Synced with ${folder.name}`;
  return (
    <span className={`sync${status.kind === "error" ? " bad" : ""}`} title={status.kind === "error" ? status.message : "Changes save to the folder, and changes made there (by an AI agent, the CLI or git) appear here"}>
      <FolderSync aria-hidden /> <span className="hide-narrow">{label}</span>
    </span>
  );
}
