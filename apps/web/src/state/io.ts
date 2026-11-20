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
    if (handle.kind === "directory") {
      // Another project inside this one (say, store-assets/android next to a
      // project kept directly in store-assets) isn't part of this one.
      if (await hasEntry(handle as FileSystemDirectoryHandle, "storeshots.json", "file")) continue;
      await walk(handle as FileSystemDirectoryHandle, `${path}/`, out);
    }
    else out.set(path, await (handle as FileSystemFileHandle).getFile());
  }
}

/**
 * Where projects live inside an app's repository: one store-assets folder,
 * with a project per platform.
 *
 *   my-app/                 the folder people pick
 *     store-assets/
 *       ios/                the App Store project: storeshots.json, captures/, fonts/, frames/
 *       android/            the Google Play project
 *
 * A project for both stores at once lives in store-assets itself, and so
 * do projects made before the per-platform folders.
 */
export const PROJECT_FOLDER = "store-assets";

export type Platform = "ios" | "android";

/** The platform folder for a project: ios for App Store only, android for Play only, none for both. */
export function platformOf(doc: Project): Platform | null {
  const stores = new Set(doc.targets.map((t) => t.store));
  if (stores.size !== 1) return null;
  return stores.has("play") ? "android" : "ios";
}

export const PLATFORM_LABEL: Record<Platform, string> = { ios: "iOS (App Store)", android: "Android (Google Play)" };

/** A short path for a project folder, as people see it in their repository: "store-assets/ios". */
export function projectPath(handle: FileSystemDirectoryHandle): string {
  return handle.name === "ios" || handle.name === "android" ? `${PROJECT_FOLDER}/${handle.name}` : handle.name;
}

async function hasEntry(dir: FileSystemDirectoryHandle, name: string, kind: "file" | "directory"): Promise<boolean> {
  try {
    if (kind === "file") await dir.getFileHandle(name);
    else await dir.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function isEmpty(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name !== ".DS_Store") return false;
  }
  return true;
}

/**
 * Where to save a project for the folder someone picked: the folder itself
 * when it's a project folder (it holds a storeshots.json, or is empty),
 * otherwise the platform's folder in store-assets (made if needed), so
 * picking an app's repository works.
 */
/**
 * Writes store-assets/README.md (how the folder works, how to have an agent
 * make the screenshots) when a project goes in store-assets/ios or android,
 * unless there's one already.
 */
export async function writeStoreAssetsReadme(picked: FileSystemDirectoryHandle, project: FileSystemDirectoryHandle, text: string) {
  if (project.name !== "ios" && project.name !== "android") return;
  const root = picked.name === PROJECT_FOLDER ? picked : await picked.getDirectoryHandle(PROJECT_FOLDER).catch(() => null);
  if (!root || !(await hasEntry(root, project.name, "directory")) || (await hasEntry(root, "README.md", "file"))) return;
  await writeFolderFile(root, "README.md", new Blob([text], { type: "text/markdown" }));
}

export async function projectFolderFor(picked: FileSystemDirectoryHandle, platform: Platform | null): Promise<FileSystemDirectoryHandle> {
  if (await hasEntry(picked, "storeshots.json", "file")) return picked;
  const isRoot = picked.name === PROJECT_FOLDER;
  if (!isRoot && (await isEmpty(picked))) return picked;
  const root = isRoot ? picked : await picked.getDirectoryHandle(PROJECT_FOLDER, { create: true });
  return platform ? root.getDirectoryHandle(platform, { create: true }) : root;
}

/**
 * The projects in a folder someone picked: the folder itself if it's one,
 * else those in its store-assets folder (store-assets itself, ios, android).
 */
export async function projectFoldersIn(picked: FileSystemDirectoryHandle): Promise<Array<{ handle: FileSystemDirectoryHandle; label: string }>> {
  if (await hasEntry(picked, "storeshots.json", "file")) return [{ handle: picked, label: picked.name }];
  let root: FileSystemDirectoryHandle | null = picked.name === PROJECT_FOLDER ? picked : null;
  if (!root && (await hasEntry(picked, PROJECT_FOLDER, "directory"))) root = await picked.getDirectoryHandle(PROJECT_FOLDER);
  if (!root) return [];
  const found: Array<{ handle: FileSystemDirectoryHandle; label: string }> = [];
  if (await hasEntry(root, "storeshots.json", "file")) found.push({ handle: root, label: PROJECT_FOLDER });
  for (const platform of ["ios", "android"] as const) {
    if (!(await hasEntry(root, platform, "directory"))) continue;
    const dir = await root.getDirectoryHandle(platform);
    if (await hasEntry(dir, "storeshots.json", "file")) found.push({ handle: dir, label: PLATFORM_LABEL[platform] });
  }
  return found;
}

/**
 * Opens a project from a folder: a project folder, or an app's folder with
 * projects in store-assets. With several there, `choose` picks one.
 */
export async function openFolder(
  choose: (labels: string[]) => Promise<number | null>,
): Promise<(LoadedProject & { handle: FileSystemDirectoryHandle }) | null> {
  const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const picked = await picker({ mode: "readwrite", id: "storeshots-project" });
  const found = await projectFoldersIn(picked);
  if (!found.length) {
    throw new Error(`No storeshots.json in ${picked.name} or its ${PROJECT_FOLDER} folder. Pick your app's folder, or the folder that contains storeshots.json.`);
  }
  const i = found.length === 1 ? 0 : await choose(found.map((f) => f.label));
  if (i === null) return null;
  const { handle } = found[i]!;
  const files = new Map<string, Blob>();
  await walk(handle, "", files);
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

/** Deletes a file from a folder; a file that's already gone is fine. */
export async function removeFolderFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split("/");
  try {
    let dir = root;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    await dir.removeEntry(parts[parts.length - 1]!);
  } catch (e) {
    if ((e as DOMException).name !== "NotFoundError") throw e;
  }
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
