import { useEffect, useRef, useState } from "react";
import { useObjectUrls } from "./useObjectUrls.ts";
import { FolderOpen, Plus, Trash2, FileArchive, Sparkles } from "lucide-react";
import { AiDialog } from "./AiDialog.tsx";


import { deleteProject, listProjects, loadProject, newProjectId, saveAssets, saveDoc, type ProjectMeta } from "../state/persist.ts";
import { canUseFolders, importZip, openFolder, type LoadedProject } from "../state/io.ts";
import { useEditor } from "../state/store.ts";
import { NewProjectDialog } from "./NewProjectDialog.tsx";
import { toast } from "./toast.ts";

/** Opens a loaded project as a new browser project, keeping a folder link if there is one. */
export async function adopt(p: LoadedProject, folder?: FileSystemDirectoryHandle) {
  const id = newProjectId();
  await saveAssets(id, [...p.assets]);
  await saveDoc(id, p.doc, { folder });
  useEditor.getState().open({ id, doc: p.doc, assets: p.assets, folder: folder ?? null });
  for (const w of p.warnings.slice(0, 1)) toast(w);
}

function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function Home() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [ai, setAi] = useState(false);
  // An app folder with both an iOS and an Android project: which to open.
  const [choice, setChoice] = useState<{ labels: string[]; done: (i: number | null) => void } | null>(null);
  const zip = useRef<HTMLInputElement>(null);
  const refresh = () => listProjects().then(setProjects);
  useEffect(() => void refresh(), []);
  const thumbs = useObjectUrls((projects ?? []).filter((p) => p.thumbnail).map((p) => [p.id, p.thumbnail!]));

  const open = async (m: ProjectMeta) => {
    try {
      const { doc, assets } = await loadProject(m.id);
      useEditor.getState().open({ id: m.id, doc, assets, folder: m.folder ?? null });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const fromFolder = async () => {
    try {
      const p = await openFolder((labels) => new Promise((done) => setChoice({ labels, done })));
      if (p) await adopt(p, p.handle);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") toast((e as Error).message, true);
    }
  };

  return (
    <main className="home">
      <div className="home-inner">
        <h1>Store screenshots you can regenerate.</h1>
        <p className="lede">
          Frame your captures, add captions, and export exactly the sizes Google Play and the App Store accept. Everything stays in
          this browser until you export it.
        </p>
        <div className="home-actions">
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New project
          </button>
          {canUseFolders && (
            <button type="button" className="btn" onClick={fromFolder} title="Open your app's folder (its projects in store-assets) or any folder with a storeshots.json">
              <FolderOpen aria-hidden /> Open folder
            </button>
          )}
          <button type="button" className="btn" onClick={() => zip.current?.click()}>
            <FileArchive aria-hidden /> Open .zip
          </button>
          <input
            ref={zip}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                await adopt(await importZip(f));
              } catch (err) {
                toast((err as Error).message, true);
              }
            }}
          />
        </div>

        <section className="ai-card short" aria-labelledby="ai-card-title">
          <p id="ai-card-title">
            <b>Let an AI agent make them for you.</b> Claude Code reads your app, plans the screens with you, then designs and exports
            them. Set it up once, then ask for screenshots in any app's folder.
          </p>
          <button type="button" className="btn" onClick={() => setAi(true)}>
            <Sparkles aria-hidden /> Set up
          </button>
        </section>

        <h2>Projects in this browser</h2>
        {projects && projects.length === 0 && (
          <div className="empty">
            No projects yet. Start one from a template: you'll have a four-screen Play listing to drop your screenshots into.
          </div>
        )}
        <div className="projects">
          {projects?.map((p) => (
            <div key={p.id} className="project">
              <button type="button" className="project" onClick={() => open(p)}>
                <div className="thumb">
                  {thumbs.get(p.id) && <img src={thumbs.get(p.id)} alt="" />}
                  <div className="crop" aria-hidden>
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <div>
                  <b>{p.name}</b>
                  <small>
                    {p.screens} screens · {ago(p.updatedAt)}
                  </small>
                </div>
              </button>
              <button
                type="button"
                className="btn icon del"
                title={`Delete ${p.name} from this browser`}
                onClick={async () => {
                  if (!confirm(`Delete "${p.name}" from this browser? Exported files and linked folders are not touched.`)) return;
                  await deleteProject(p.id);
                  refresh();
                }}
              >
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
      {ai && <AiDialog onClose={() => setAi(false)} />}
      {choice && (
        <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="choose-title">
          <div className="dialog" style={{ width: "min(380px, 100%)" }}>
            <header>
              <h2 id="choose-title">Which project?</h2>
            </header>
            <div className="body">
              <p className="hint">This folder has a project for each store.</p>
              <div className="choices">
                {choice.labels.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    className="btn"
                    autoFocus={i === 0}
                    onClick={() => {
                      choice.done(i);
                      setChoice(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    choice.done(null);
                    setChoice(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
