import { describe, expect, it } from "vitest";
import { platformOf, projectFolderFor, projectFoldersIn, projectPath, readFolderFiles, writeStoreAssetsReadme } from "./io.ts";
import type { Project } from "@storeshots/schema";

/** An in-memory stand-in for a folder from the File System Access API. */
class Dir {
  kind = "directory" as const;
  entries = new Map<string, Dir | Blob>();
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.entries.has(name) && opts?.create) this.entries.set(name, new Blob([]));
    const e = this.entries.get(name);
    if (!(e instanceof Blob)) throw new DOMException("missing", "NotFoundError");
    return {
      kind: "file",
      getFile: async () => this.entries.get(name) as Blob,
      createWritable: async () => ({
        write: async (data: Blob | string) => void this.entries.set(name, new Blob([data])),
        close: async () => {},
      }),
    };
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let e = this.entries.get(name);
    if (!e && opts?.create) this.entries.set(name, (e = new Dir(name)));
    if (!(e instanceof Dir)) throw new DOMException("missing", "NotFoundError");
    return e;
  }
  async *keys() {
    yield* this.entries.keys();
  }
  async *[Symbol.asyncIterator]() {
    for (const [name, e] of this.entries) yield [name, e instanceof Dir ? e : { kind: "file", getFile: async () => e }];
  }
  /** Builds nested folders from paths like "store-assets/ios/storeshots.json". */
  static from(name: string, paths: string[]): Dir {
    const root = new Dir(name);
    for (const p of paths) {
      const parts = p.split("/");
      let d = root;
      for (const part of parts.slice(0, -1)) {
        if (!d.entries.has(part)) d.entries.set(part, new Dir(part));
        d = d.entries.get(part) as Dir;
      }
      d.entries.set(parts.at(-1)!, new Blob(["x"]));
    }
    return root;
  }
}
const h = (d: Dir) => d as unknown as FileSystemDirectoryHandle;
const doc = (stores: string[]) => ({ targets: stores.map((store) => ({ store })) }) as unknown as Project;

describe("project folders in an app's repository", () => {
  it("names the platform folder by store", () => {
    expect(platformOf(doc(["appstore"]))).toBe("ios");
    expect(platformOf(doc(["play", "play"]))).toBe("android");
    expect(platformOf(doc(["appstore", "play"]))).toBeNull();
  });

  it("links into store-assets/<platform>, making the folders", async () => {
    const app = Dir.from("my-app", ["pubspec.yaml"]);
    const ios = await projectFolderFor(h(app), "ios");
    expect(projectPath(ios)).toBe("store-assets/ios");
    const android = await projectFolderFor(h(app), "android");
    expect(projectPath(android)).toBe("store-assets/android");
    expect([...(app.entries.get("store-assets") as Dir).entries.keys()]).toEqual(["ios", "android"]);

    await writeStoreAssetsReadme(h(app), ios, "first");
    await writeStoreAssetsReadme(h(app), android, "second"); // never replaces one that's there
    const files = await readFolderFiles(h(app.entries.get("store-assets") as Dir));
    expect(await files.get("README.md")!.text()).toBe("first");
  });

  it("uses a picked project folder or an empty folder as it is", async () => {
    const project = Dir.from("anything", ["storeshots.json"]);
    expect(await projectFolderFor(h(project), "android")).toBe(project);
    const empty = new Dir("empty");
    expect(await projectFolderFor(h(empty), "ios")).toBe(empty);
  });

  it("finds the projects to open in an app folder", async () => {
    const app = Dir.from("my-app", ["store-assets/ios/storeshots.json", "store-assets/android/storeshots.json", "lib/main.dart"]);
    expect((await projectFoldersIn(h(app))).map((p) => p.label)).toEqual(["iOS (App Store)", "Android (Google Play)"]);
    // Projects kept directly in store-assets, from before the platform folders, still open.
    const older = Dir.from("old-app", ["store-assets/storeshots.json"]);
    expect((await projectFoldersIn(h(older))).map((p) => p.label)).toEqual(["store-assets"]);
    expect(await projectFoldersIn(h(Dir.from("nothing", ["README.md"])))).toEqual([]);
  });

  it("doesn't read a project inside another as its files", async () => {
    const root = Dir.from("store-assets", ["storeshots.json", "captures/en/a.png", "android/storeshots.json", "android/captures/en/b.png"]);
    expect([...(await readFolderFiles(h(root))).keys()].sort()).toEqual(["captures/en/a.png", "storeshots.json"]);
  });
});
