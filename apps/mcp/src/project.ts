import { readFile, rename, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseProject, serializeProject, type Project, type Target } from "@storeshots/schema";
import { AssetCache } from "@storeshots/core";
import { nodeHost } from "@storeshots/node";

/**
 * Reads and writes one project folder. Edits are applied to a fresh copy
 * of storeshots.json, validated, and written atomically; an edit that
 * would make the project invalid is refused and nothing is written.
 * Calls are serialized so concurrent tool calls can't lose each other's
 * changes.
 */
export class ProjectFolder {
  readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  get file() {
    return join(this.dir, "storeshots.json");
  }

  /** Whether this is the project open in the browser (see LiveFolder). */
  get isLive() {
    return false;
  }

  describe(): string {
    return this.file;
  }

  /** Where storeshots_render writes images. */
  outputDir(_project: Project): string {
    return join(this.dir, "store");
  }

  /** Publishes files tools wrote outside edit(); nothing to do for a folder on disk. */
  async flush(): Promise<void> {}

  async load(): Promise<Project> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch {
      throw new Error(`no storeshots.json in ${this.dir}. Pass project_dir, or start the server with --project <folder>.`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`storeshots.json is not valid JSON: ${(e as Error).message}`);
    }
    const r = parseProject(json);
    if (!r.ok) throw new Error(`storeshots.json is invalid:\n${r.issues.map((i) => `- ${i.path || "(root)"}: ${i.message}`).join("\n")}`);
    return r.project;
  }

  /** A render cache over the folder. Made per call so changed files are picked up. */
  cache(): AssetCache {
    return new AssetCache(nodeHost(this.dir));
  }

  /** Runs `fn` on the current project and saves the result, one call at a time. */
  edit<T>(fn: (p: Project) => T | Promise<T>): Promise<{ project: Project; result: T }> {
    const run = async () => {
      const project = await this.load();
      const result = await fn(project);
      const check = parseProject(JSON.parse(JSON.stringify(project)));
      if (!check.ok) {
        throw new Error(`that change would make the project invalid, so nothing was saved:\n${check.issues.map((i) => `- ${i.path}: ${i.message}`).join("\n")}`);
      }
      const text = serializeProject(check.project);
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, this.file);
      return { project: check.project, result };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Capture file names for a locale folder. */
  async captures(locale: string): Promise<string[]> {
    try {
      return (await readdir(join(this.dir, "captures", locale))).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
    } catch {
      return [];
    }
  }

  /** Frames imported into frames/<id>/frame.json. */
  async importedFrames(): Promise<string[]> {
    try {
      const ids = await readdir(join(this.dir, "frames"));
      const out: string[] = [];
      for (const id of ids) {
        try {
          await readFile(join(this.dir, "frames", id, "frame.json"));
          out.push(id);
        } catch {
          // not a frame folder
        }
      }
      return out.sort();
    } catch {
      return [];
    }
  }
}

export function pickTarget(p: Project, id?: string): Target {
  if (!id) return p.targets[0]!;
  const t = p.targets.find((x) => x.id === id);
  if (!t) throw new Error(`no target "${id}"; targets are ${p.targets.map((x) => x.id).join(", ")}`);
  return t;
}

export function pickLocale(p: Project, locale?: string): string {
  if (!locale) return p.locales.default;
  if (!p.locales.list.includes(locale)) throw new Error(`locale "${locale}" isn't in the project; locales are ${p.locales.list.join(", ")}`);
  return locale;
}
