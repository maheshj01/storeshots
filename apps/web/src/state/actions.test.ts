import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProject, serializeProject } from "@storeshots/schema";

vi.mock("./persist.ts", () => ({ saveAssets: async () => {} }));

const { useEditor } = await import("./store.ts");
const A = await import("./actions.ts");
const { newProject } = await import("@storeshots/ops");

const S = () => useEditor.getState();
const valid = () => {
  const r = parseProject(JSON.parse(serializeProject(S().doc!)));
  return r.ok ? r.issues : r.issues;
};

beforeEach(() => {
  const { doc } = newProject("Test", "headline", "#E0237A");
  S().open({ id: "p", doc, assets: new Map() });
});

describe("screens", () => {
  it("adds a screen after the selected one with its own captions", () => {
    const id = A.addScreen("screen-1")!;
    const doc = S().doc!;
    expect(doc.screens.map((s) => s.id)).toEqual(["screen-1", id, "screen-2", "screen-3", "screen-4"]);
    const title = doc.screens[1]!.layers[0]!;
    expect(title.type === "text" && title.text).toBe(`@caption.${id}.title`);
    expect(S().selection.screen).toBe(id);
    expect(valid()).toEqual([]);
  });

  it("duplicates a screen with copied, independent captions", () => {
    A.duplicateScreen("screen-2");
    const doc = S().doc!;
    const copy = doc.screens[2]!;
    const t = copy.layers[0]!;
    expect(t.type === "text" && t.text).toBe(`@caption.${copy.id}.title`);
    expect(doc.captions[`${copy.id}.title`]).toEqual(doc.captions["screen-2.title"]);
    expect(valid()).toEqual([]);
  });

  it("deletes a screen and its captions, never the last one", () => {
    A.deleteScreen("screen-2");
    expect(S().doc!.screens).toHaveLength(3);
    expect(S().doc!.captions["screen-2.title"]).toBeUndefined();
    for (const id of ["screen-1", "screen-3"]) A.deleteScreen(id);
    A.deleteScreen("screen-4");
    expect(S().doc!.screens).toHaveLength(1);
  });

  it("reorders", () => {
    A.moveScreen("screen-4", 0);
    expect(S().doc!.screens.map((s) => s.id)).toEqual(["screen-4", "screen-1", "screen-2", "screen-3"]);
    S().undo();
    expect(S().doc!.screens[0]!.id).toBe("screen-1");
  });

  it("applies one screen's layout to all, keeping each screen's text and capture", () => {
    A.updateLayer("Move", (l) => void (l.box.y = 0.5), { screen: "screen-1", layer: 0 });
    A.setCapture("screen-3", 2, { name: "three.png", width: 1280, height: 2856 });
    A.applyLayoutToAll("screen-1");
    const s3 = S().doc!.screens[2]!;
    expect(s3.layers[0]!.box.y).toBe(0.5);
    const t = s3.layers[0]!;
    expect(t.type === "text" && t.text).toBe("@caption.screen-3.title");
    expect(s3.layers[2]).toMatchObject({ capture: "three.png" });
  });
});

describe("layers", () => {
  it("adds text as one undo step and selects it", () => {
    S().select({ screen: "screen-1", layer: null });
    const before = S().past.length;
    A.addLayer("text");
    expect(S().past.length).toBe(before + 1);
    expect(S().selection.layer).toBe(3);
    S().undo();
    expect(S().doc!.screens[0]!.layers).toHaveLength(3);
    expect(Object.keys(S().doc!.captions).some((k) => k.includes("text-"))).toBe(false);
  });

  it("edits a caption in the current locale", () => {
    A.setLayerText("screen-1", 0, "Hello");
    expect(S().doc!.captions["screen-1.title"]).toEqual({ en: "Hello" });
  });

  it("switches to a frame that matches the capture's shape", () => {
    A.setCapture("screen-1", 2, { name: "p7.png", width: 1080, height: 2400 });
    expect(S().doc!.screens[0]!.layers[2]).toMatchObject({ frame: "pixel-7", capture: "p7.png" });
  });

  it("moves layers up and down", () => {
    S().select({ screen: "screen-1", layer: 0 });
    A.moveLayer(1);
    expect(S().selection.layer).toBe(1);
    expect(S().doc!.screens[0]!.layers[1]!.type).toBe("text");
  });

  it("duplicates text with its own caption", () => {
    S().select({ screen: "screen-1", layer: 0 });
    A.duplicateLayer();
    const [a, b] = S().doc!.screens[0]!.layers;
    expect(a?.type === "text" && b?.type === "text" && a.text !== b.text).toBe(true);
    expect(valid()).toEqual([]);
  });
});
