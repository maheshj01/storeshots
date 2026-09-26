import { createStore, del, delMany, get, getMany, keys, set, setMany, values } from "idb-keyval";
import { parseProject, serializeProject, type Project } from "@storeshots/schema";

/**
 * Local-first storage in IndexedDB. Projects never leave the browser unless
 * the person exports a zip or saves to a folder.
 */
const meta = createStore("storeshots-projects", "meta");
const docs = createStore("storeshots-docs", "docs");
const files = createStore("storeshots-assets", "assets");

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  screens: number;
  thumbnail?: Blob | undefined;
  folder?: FileSystemDirectoryHandle | undefined;
}

const assetKey = (id: string, path: string) => `${id}\u0000${path}`;

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await values<ProjectMeta>(meta);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveDoc(id: string, doc: Project, extra: Partial<ProjectMeta> = {}) {
  const prev = await get<ProjectMeta>(id, meta);
  await set(id, serializeProject(doc), docs);
  await set(id, { ...prev, ...extra, id, name: doc.name, screens: doc.screens.length, updatedAt: Date.now() }, meta);
}

export async function saveThumbnail(id: string, thumbnail: Blob) {
  const prev = await get<ProjectMeta>(id, meta);
  if (prev) await set(id, { ...prev, thumbnail }, meta);
}

export async function saveAssets(id: string, entries: Array<[string, Blob]>) {
  if (entries.length) await setMany(entries.map(([p, b]) => [assetKey(id, p), b]), files);
}

export async function loadProject(id: string): Promise<{ doc: Project; assets: Map<string, Blob>; meta: ProjectMeta }> {
  const [text, m] = await Promise.all([get<string>(id, docs), get<ProjectMeta>(id, meta)]);
  if (!text || !m) throw new Error("This project is no longer in this browser's storage.");
  const parsed = parseProject(JSON.parse(text));
  if (!parsed.ok) throw new Error(`The saved project is invalid: ${parsed.issues[0]?.message}`);
  const prefix = `${id}\u0000`;
  const ks = (await keys<string>(files)).filter((k) => k.startsWith(prefix));
  const blobs = await getMany<Blob>(ks, files);
  const assets = new Map(ks.map((k, i) => [k.slice(prefix.length), blobs[i]!] as const));
  return { doc: parsed.project, assets, meta: m };
}

export async function deleteProject(id: string) {
  const prefix = `${id}\u0000`;
  const ks = (await keys<string>(files)).filter((k) => k.startsWith(prefix));
  await Promise.all([delMany(ks, files), del(id, docs), del(id, meta)]);
}

export function newProjectId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
