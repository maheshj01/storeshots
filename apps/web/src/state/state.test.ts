import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProject, serializeProject } from "@storeshots/schema";
import { useEditor } from "./store.ts";
import { applyTemplate, mix, newProject, TEMPLATES } from "@storeshots/ops";

const S = () => useEditor.getState();

function openNew(template = "headline") {
  const { doc } = newProject("Test", template, "#E0237A");
  S().open({ id: "p", doc, assets: new Map() });
}

describe("history", () => {
  beforeEach(() => openNew());

  it("undoes and redoes an edit", () => {
    S().edit("Rename", (d) => void (d.name = "Renamed"));
    expect(S().doc!.name).toBe("Renamed");
    S().undo();
    expect(S().doc!.name).toBe("Test");
    S().redo();
    expect(S().doc!.name).toBe("Renamed");
  });

  it("folds a gesture into one step", () => {
    S().beginGesture("Move");
    for (let i = 1; i <= 5; i++) S().edit("Move", (d) => void (d.screens[0]!.layers[0]!.box.x = i / 10));
    S().endGesture();
    expect(S().past).toHaveLength(1);
    S().undo();
    expect(S().doc!.screens[0]!.layers[0]!.box.x).toBe(0.08);
  });

  it("merges rapid edits with the same key, but not slow ones", () => {
    vi.useFakeTimers();
    S().edit("Type", (d) => void (d.name = "a"), "name");
    vi.advanceTimersByTime(200);
    S().edit("Type", (d) => void (d.name = "ab"), "name");
    expect(S().past).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    S().edit("Type", (d) => void (d.name = "abc"), "name");
    expect(S().past).toHaveLength(2);
    S().undo();
    S().undo();
    expect(S().doc!.name).toBe("Test");
    vi.useRealTimers();
  });

  it("clears redo after a new edit", () => {
    S().edit("A", (d) => void (d.name = "A"));
    S().undo();
    S().edit("B", (d) => void (d.name = "B"));
    expect(S().future).toHaveLength(0);
  });

  it("keeps the selection valid after undoing an added layer", () => {
    S().edit("Add", (d) => void d.screens[0]!.layers.push({ ...d.screens[0]!.layers[0]! }));
    S().select({ screen: "screen-1", layer: 3 });
    S().undo();
    expect(S().selection.layer).toBeNull();
  });
});

describe("templates", () => {
  it.each(TEMPLATES.map((t) => t.id))("%s makes a valid, store-ready project", (id) => {
    const { doc, fonts } = newProject("App", id, "#2F6FEB");
    const r = parseProject(JSON.parse(serializeProject(doc)));
    expect(r.ok && r.issues).toEqual([]);
    expect(doc.screens).toHaveLength(4);
    expect(fonts).toHaveLength(2);
  });

  it("keeps captions and captures when switching", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    const dev = doc.screens[0]!.layers.find((l) => l.type === "device")!;
    if (dev.type === "device") dev.capture = "01.png";
    doc.captions["screen-1.title"] = { en: "Hello" };
    applyTemplate(doc, "flip");
    const after = doc.screens[0]!;
    expect(after.layers.find((l) => l.type === "device")).toMatchObject({ capture: "01.png" });
    expect(after.layers.filter((l) => l.type === "text").map((l) => l.type === "text" && l.text)).toContain("@caption.screen-1.title");
    expect(doc.captions["screen-1.title"]).toEqual({ en: "Hello" });
  });

  it("turns literal text into captions so switching loses nothing", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    const t = doc.screens[1]!.layers[0]!;
    if (t.type === "text") t.text = "Typed by hand";
    applyTemplate(doc, "editorial");
    const title = doc.screens[1]!.layers.find((l) => l.type === "text")!;
    const key = title.type === "text" ? title.text.slice(9) : "";
    expect(doc.captions[key]).toEqual({ en: "Typed by hand" });
  });

  it("drops the old template's unused theme colours", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    applyTemplate(doc, "tilt");
    expect(Object.keys(doc.theme.colors).sort()).toEqual(["accent", "brand", "night", "nightSoft", "onNight"]);
  });

  it("mixes colours", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});
