import { strToU8, unzipSync, zipSync, strFromU8, type Zippable } from "fflate";
import { parseProject, serializeProject, type Project } from "@storeshots/schema";

/**
 * Moving projects in and out of the browser: zip files everywhere, and on
 * Chromium a real folder inside the app's repo (File System Access API).
 */
export interface LoadedProject {
  doc: Project;
  assets: Map<string, Blob>;
  warnings: string[];
}

/** Folders that belong to the output or to tooling, not to the design. */
const SKIP = /^(store|node_modules|\.git|__MACOSX)(\/|$)|(^|\/)\.DS_Store$/;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  json: "application/json",
};

export function mimeFor(path: string): string {
  return MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

async function finish(files: Map<string, Uint8Array | Blob>, source: string): Promise<LoadedProject> {
  // The project may sit inside a top-level folder in the zip.
  const jsonPath = [...files.keys()]
    .filter((p) => p === "storeshots.json" || p.endsWith("/storeshots.json"))
    .sort((a, b) => a.length - b.length)[0];
  if (!jsonPath) throw new Error(`${source} has no storeshots.json.`);
  const prefix = jsonPath.slice(0, -"storeshots.json".length);
  const raw = files.get(jsonPath)!;
  const text = raw instanceof Blob ? await raw.text() : strFromU8(raw);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`storeshots.json in ${source} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = parseProject(json);
  if (!parsed.ok) {
    const first = parsed.issues.slice(0, 3).map((i) => `${i.path || "(root)"}: ${i.message}`);
    throw new Error(`storeshots.json in ${source} is invalid. ${first.join("; ")}`);
  }
  const assets = new Map<string, Blob>();
  for (const [path, data] of files) {
    if (!path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    if (rel === "storeshots.json" || rel.endsWith("/") || SKIP.test(rel)) continue;
    assets.set(rel, data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeFor(rel) }));
  }
  return { doc: parsed.project, assets, warnings: parsed.issues.map((i) => `${i.path}: ${i.message}`) };
}

export async function importZip(file: File): Promise<LoadedProject> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  return finish(new Map(Object.entries(entries)), file.name);
}

export function exportZip(doc: Project, assets: Map<string, Blob>): Promise<Blob> {
  return (async () => {
    const zip: Zippable = { "storeshots.json": strToU8(serializeProject(doc)) };
    for (const [path, blob] of assets) zip[path] = [new Uint8Array(await blob.arrayBuffer()), { level: path.endsWith(".ttf") || path.endsWith(".otf") ? 6 : 0 }];
    return new Blob([zipSync(zip) as BlobPart], { type: "application/zip" });
  })();
}

export const canUseFolders = typeof window !== "undefined" && "showDirectoryPicker" in window;

async function walk(dir: FileSystemDirectoryHandle, base: string, out: Map<string, Blob>) {
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    const path = base + name;
    if (SKIP.test(path)) continue;
    if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, `${path}/`, out);
    else out.set(path, await (handle as FileSystemFileHandle).getFile());
  }
}

export async function openFolder(): Promise<LoadedProject & { handle: FileSystemDirectoryHandle }> {
  const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const handle = await picker({ mode: "readwrite", id: "storeshots-project" });
  const files = new Map<string, Blob>();
  await walk(handle, "", files);
  if (!files.has("storeshots.json")) {
    throw new Error(`${handle.name} has no storeshots.json. Pick the folder that contains it, or start a new project and save it there.`);
  }
  return { ...(await finish(files, handle.name)), handle };
}

/** Writes a project file into a folder, creating subfolders; returns the written file. */
export async function writeFolderFile(root: FileSystemDirectoryHandle, path: string, data: Blob | string): Promise<File> {
  const parts = path.split("/");
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
  const file = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
  const w = await file.createWritable();
  await w.write(data);
  await w.close();
  return file.getFile();
}

/** Every project file in a folder (skipping rendered output and tooling folders). */
export async function readFolderFiles(root: FileSystemDirectoryHandle): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  await walk(root, "", files);
  return files;
}

/** Asks for write access if needed; returns false if the person declines. */
export async function ensureWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission(o: object): Promise<PermissionState>;
    requestPermission(o: object): Promise<PermissionState>;
  };
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Starts a browser download of a blob. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}
