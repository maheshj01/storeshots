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

  it("restacks layers and keeps them selected", () => {
    A.moveLayerTo("screen-1", 0, 1);
    expect(S().selection).toEqual({ screen: "screen-1", layer: 1, more: [] });
    expect(S().past.at(-1)!.label).toBe("Reorder layers");
    A.moveLayerTo("screen-1", 1, 2);
    expect(S().past.at(-1)!.label).toBe("Bring to front");
    expect(S().doc!.screens[0]!.layers[2]!.type).toBe("text");
    const before = S().past.length;
    A.moveLayerTo("screen-1", 2, 2);
    A.moveLayerTo("screen-1", 2, 9);
    expect(S().past.length).toBe(before);
  });

  it("duplicates text with its own caption", () => {
    S().select({ screen: "screen-1", layer: 0 });
    A.duplicateLayer();
    const [a, b] = S().doc!.screens[0]!.layers;
    expect(a?.type === "text" && b?.type === "text" && a.text !== b.text).toBe(true);
    expect(valid()).toEqual([]);
  });
});

describe("multiple selection", () => {
  it("adds and removes items with Shift, keeping one kind", () => {
    S().select({ screen: "screen-1", layer: 0 });
    S().toggleSelect({ screen: "screen-2", layer: 0 });
    expect(S().selection).toEqual({ screen: "screen-2", layer: 0, more: [{ screen: "screen-1", layer: 0 }] });
    // A screen can't join a selection of layers: it replaces it.
    S().toggleSelect({ screen: "screen-3", layer: null });
    expect(S().selection).toEqual({ screen: "screen-3", layer: null, more: [] });
    S().toggleSelect({ screen: "screen-1", layer: null });
    S().toggleSelect({ screen: "screen-3", layer: null });
    expect(S().selection).toEqual({ screen: "screen-1", layer: null, more: [] });
  });

  it("changes every selected layer in one undo step, only where the setting applies", () => {
    S().select({ screen: "screen-1", layer: 0 });
    S().toggleSelect({ screen: "screen-2", layer: 0 });
    S().toggleSelect({ screen: "screen-2", layer: 2 });
    const steps = S().past.length;
    A.updateLayer("Font size", (l) => l.type === "text" && void (l.size = 0.05));
    const [one, two] = S().doc!.screens;
    expect([one!.layers[0], two!.layers[0]].map((l) => l?.type === "text" && l.size)).toEqual([0.05, 0.05]);
    expect(two!.layers[2]!.type).toBe("device");
    expect(S().past.length).toBe(steps + 1);
  });

  it("deletes every selected layer", () => {
    S().select({ screen: "screen-1", layer: 0 });
    S().toggleSelect({ screen: "screen-1", layer: 1 });
    A.deleteLayer();
    expect(S().doc!.screens[0]!.layers.map((l) => l.type)).toEqual(["device"]);
    S().undo();
    expect(S().doc!.screens[0]!.layers).toHaveLength(3);
  });

  it("changes the background of every selected screen", () => {
    S().select({ screen: "screen-1", layer: null });
    S().toggleSelect({ screen: "screen-3", layer: null });
    A.updateBackground("Background colour", () => ({ type: "solid", color: "#123456" }));
    expect(S().doc!.screens.map((s) => s.background.type === "solid" && s.background.color)).toEqual(["#123456", false, "#123456", false]);
  });
});
