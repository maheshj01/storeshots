import { useEffect, useRef, useState } from "react";
import { useObjectUrls } from "./useObjectUrls.ts";
import { FolderOpen, Plus, Trash2, FileArchive, Sparkles } from "lucide-react";
import { AiDialog, PACKAGE } from "./AiDialog.tsx";
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
      const p = await openFolder();
      await adopt(p, p.handle);
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
            <button type="button" className="btn" onClick={fromFolder} title="Open a folder with a storeshots.json, e.g. inside your app's repo">
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

        <section className="ai-card" aria-labelledby="ai-card-title">
          <div>
            <h2 id="ai-card-title">Works with Claude and other AI agents</h2>
            <p>
              An MCP server lets Claude Code, Claude Desktop, Cursor and other agents check and edit your screenshots. They read each
              screen as text, not images, and you watch their changes appear here as they work. It runs on your computer.
            </p>
            <code className="ai-cmd">npx {PACKAGE}</code>
          </div>
          <button type="button" className="btn" onClick={() => setAi(true)}>
            <Sparkles aria-hidden /> Set up AI editing
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
    </main>
  );
}
