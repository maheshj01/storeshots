import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.ts";

const fixture = fileURLToPath(new URL("../../../examples/epoch", import.meta.url));
let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string; data?: string }>;
  };
  return { error: !!res.isError, text: res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), content: res.content };
}

const saved = async () => JSON.parse(await readFile(join(dir, "storeshots.json"), "utf8"));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storeshots-mcp-"));
  // Skip the fixture's rendered output folder, if any.
  await cp(fixture, dir, { recursive: true, filter: (src) => src !== join(fixture, "store") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(dir);
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("storeshots MCP server", { timeout: 30_000 }, () => {
  it("lists its tools with descriptions and annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "storeshots_add_layer",
      "storeshots_align_layer",
      "storeshots_apply_template",
      "storeshots_arrange_layer",
      "storeshots_check",
      "storeshots_edit_screens",
      "storeshots_get_project",
      "storeshots_import_capture",
      "storeshots_inspect_screen",
      "storeshots_render",
      "storeshots_set_background",
      "storeshots_set_theme",
      "storeshots_update_layer",
    ]);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(40);
      expect(t.annotations?.readOnlyHint).toBeTypeOf("boolean");
    }
  });

  it("summarises the project", async () => {
    const { text, error } = await call("storeshots_get_project");
    expect(error).toBe(false);
    expect(text).toContain("targets: play-phone 1080×1920");
    expect(text).toContain("captures/en: 01_progress.png 1280×2856");
    expect(text).toMatch(/2\. timeline · solid \$cream · text "Count down to what matters"/);
  });

  it("describes wrapped, shrunk text without rendering", async () => {
    const { text } = await call("storeshots_inspect_screen", { screen: "timeline", locale: "de" });
    expect(text).toContain('[0] text "Zähl die Tage bis zu / dem, was wirklich zählt" · Poppins-SemiBold.ttf 76.8px (asked 84.2)');
    expect(text).toMatch(/\[3\] device pixel-9-pro\/porcelain · 02_timeline\.png 1280×2856 .* bleeds bottom 96/);
  });

  it("returns JSON when asked", async () => {
    const { text } = await call("storeshots_inspect_screen", { screen: "progress", format: "json" });
    const json = JSON.parse(text);
    expect(json.layers[0].text.lines).toEqual(["See your year", "at a glance"]);
  });

  it("edits a caption and reports the effect", async () => {
    const { text, error } = await call("storeshots_update_layer", {
      screen: "progress",
      layer: 0,
      locale: "de",
      set: { text: "Sieh dein ganzes Jahr auf einen einzigen, übersichtlichen Blick" },
    });
    expect(error).toBe(false);
    expect(text).toMatch(/^updated progress \[0\]: text/);
    expect(text).toMatch(/text_shrunk|text_overflow/);
    expect((await saved()).captions["progress.title"].de).toBe("Sieh dein ganzes Jahr auf einen einzigen, übersichtlichen Blick");
  });

  it("works in output pixels", async () => {
    await call("storeshots_update_layer", { screen: "progress", layer: 2, set: { x: 100, w: 880 } });
    const box = (await saved()).screens[0].layers[2].box;
    expect(box.x).toBeCloseTo(100 / 1080, 4);
    expect(box.w).toBeCloseTo(880 / 1080, 4);
  });

  it("refuses fields that don't fit the layer, without saving", async () => {
    const before = await readFile(join(dir, "storeshots.json"), "utf8");
    const res = await call("storeshots_update_layer", { screen: "progress", layer: 2, set: { font_size: 40 } });
    expect(res.error).toBe(true);
    expect(res.text).toContain("font_size can't be set on a device layer");
    expect(await readFile(join(dir, "storeshots.json"), "utf8")).toBe(before);
  });

  it("refuses edits that would make the project invalid", async () => {
    const res = await call("storeshots_update_layer", { screen: "progress", layer: 0, set: { color: "red" } });
    expect(res.error).toBe(true);
    expect(res.text).toContain("would make the project invalid, so nothing was saved");
  });

  it("never writes outside the project folder", async () => {
    const res = await call("storeshots_update_layer", { screen: "progress", layer: 0, set: { font: "fonts/../../escape.ttf" } });
    expect(res.error).toBe(true);
    const img = await call("storeshots_add_layer", { screen: "progress", type: "image", set: { src: "../outside.png" } });
    expect(img.text).toContain("must be a path inside the project folder");
  });

  it("gives actionable errors for unknown screens", async () => {
    const res = await call("storeshots_inspect_screen", { screen: "nope" });
    expect(res.text).toBe('Error: no screen "nope"; screens are progress, timeline, add-event, profile');
  });

  it("aligns what is drawn, not the box", async () => {
    const { text } = await call("storeshots_align_layer", { screen: "progress", layer: 1, horizontal: "left", margin: 64 });
    // Within rounding: positions are reported to 0.1 px and saved to 4 decimals of the canvas.
    expect(text).toMatch(/\[1\] text .* ink (63\.9|64|64\.1),/);
  });

  it("adds, duplicates, moves and removes screens", async () => {
    let r = await call("storeshots_edit_screens", { action: "duplicate", screen: "timeline" });
    expect(r.text).toContain("duplicated timeline as screen-5");
    r = await call("storeshots_edit_screens", { action: "move_to", screen: "screen-5", to: 0 });
    expect(r.text).toMatch(/1\. screen-5/);
    r = await call("storeshots_edit_screens", { action: "remove", screen: "screen-5" });
    expect((await saved()).screens.map((s: { id: string }) => s.id)).toEqual(["progress", "timeline", "add-event", "profile"]);
  });

  it("adds a text layer in a bundled font and copies the font in", async () => {
    const r = await call("storeshots_add_layer", {
      screen: "profile",
      type: "text",
      set: { text: "New", font: "fonts/DMSerifDisplay-Regular.ttf", font_size: 60, x: 90, y: 1700, w: 900, h: 120 },
    });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/added text layer profile \[3\]/);
    expect(await readdir(join(dir, "fonts"))).toContain("DMSerifDisplay-Regular.ttf");
  });

  it("finds problems across locales", async () => {
    const { text } = await call("storeshots_check");
    expect(text).toMatch(/low_contrast/);
    expect(text).not.toMatch(/device_bleed/);
  });

  it("restyles through the theme", async () => {
    const r = await call("storeshots_set_theme", { colors: { brand: "#2F6FEB" } });
    expect(r.text).toContain("$brand #2F6FEB");
  });

  it("imports a screenshot and puts it on a phone", async () => {
    const r = await call("storeshots_import_capture", { source_path: join(fixture, "captures/en/04_profile.png"), name: "new_home.png", screen: "progress" });
    expect(r.error).toBe(false);
    expect(r.text).toContain("imported captures/en/new_home.png (1280×2856) and put it on progress [2]");
  });

  it("renders files, with previews only when asked", async () => {
    const plain = await call("storeshots_render", { screens: ["progress"], locales: ["en"] });
    expect(plain.text).toContain("rendered 1 image");
    expect(plain.content.some((c) => c.type === "image")).toBe(false);
    expect(await readdir(join(dir, "store/play-phone/en"))).toEqual(["01_progress.png"]);
    const withPreview = await call("storeshots_render", { screens: ["progress"], locales: ["en"], preview: true });
    expect(withPreview.content.filter((c) => c.type === "image")).toHaveLength(1);
  });

  it("applies a template, keeping captions", async () => {
    const r = await call("storeshots_apply_template", { template: "editorial", brand: "#0E9F6E" });
    expect(r.error).toBe(false);
    const doc = await saved();
    expect(doc.theme.fonts.heading).toBe("fonts/DMSerifDisplay-Regular.ttf");
    expect(doc.captions["progress.title"].en).toBe("See your year at a glance");
  });
});
