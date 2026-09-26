import { describe, expect, it } from "vitest";
import { parseProject, projectJsonSchema, resolveColor, resolveText, localeChain } from "./index.ts";

const minimal = () => ({
  schemaVersion: 1,
  name: "Demo",
  locales: { default: "en", list: ["en", "de"] },
  targets: [{ id: "play-phone", store: "play", size: [1080, 1920] }],
  theme: { colors: { brand: "#EF5B2A", alias: "$brand" }, fonts: { heading: "fonts/a.ttf" } },
  screens: [
    {
      id: "home",
      background: { type: "solid", color: "$brand" },
      layers: [
        { type: "text", text: "@caption.title", font: "$heading", size: 0.07, box: { x: 0, y: 0, w: 1, h: 0.2 } },
      ],
    },
  ],
  captions: { title: { en: "Hello", de: "Hallo" } },
});

describe("parseProject", () => {
  it("accepts a valid project and applies defaults", () => {
    const r = parseProject(minimal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const layer = r.project.screens[0]!.layers[0]!;
    expect(layer.type === "text" && layer.fit).toBe("shrink");
    expect(r.project.targets[0]!.format).toBe("png");
    expect(r.issues).toEqual([]);
  });

  it("refuses newer schema versions with a clear message", () => {
    const r = parseProject({ ...minimal(), schemaVersion: 2 });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toMatch(/reads up to 1/);
  });

  it("reports shape errors with paths", () => {
    const doc = minimal();
    (doc.targets[0] as { size: unknown }).size = [1080];
    const r = parseProject(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.startsWith("targets[0].size"))).toBe(true);
  });

  it("reports unknown references", () => {
    const doc = minimal();
    doc.screens[0]!.background = { type: "solid", color: "$nope" };
    doc.screens[0]!.layers[0]!.text = "@caption.missing";
    const r = parseProject(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message)).toEqual([
      'unknown theme colour "$nope"',
      'unknown caption "missing"',
    ]);
  });

  it("warns about missing translations", () => {
    const doc = minimal();
    doc.captions.title = { en: "Hello" } as typeof doc.captions.title;
    const r = parseProject(doc);
    expect(r.ok && r.issues[0]!.message).toMatch(/no "de" text/);
  });

  it("round-trips through JSON", () => {
    const r = parseProject(minimal());
    if (!r.ok) throw new Error("invalid");
    const again = parseProject(JSON.parse(JSON.stringify(r.project)));
    expect(again.ok && again.project).toEqual(r.project);
  });
});

describe("resolvers", () => {
  const r = parseProject(minimal());
  if (!r.ok) throw new Error("invalid");
  const p = r.project;
  it("follows theme colour aliases", () => expect(resolveColor(p, "$alias")).toBe("#EF5B2A"));
  it("falls back to the default locale", () => expect(resolveText(p, "@caption.title", "ja")).toBe("Hello"));
  it("builds a capture locale chain", () => expect(localeChain(p, "de-AT")).toEqual(["de-AT", "de", "en"]));
});

it("emits a JSON Schema", () => {
  const s = projectJsonSchema() as { properties: Record<string, unknown> };
  expect(Object.keys(s.properties)).toContain("screens");
});

describe("serializeProject", async () => {
  const { serializeProject } = await import("./index.ts");
  it("omits defaults and survives a round trip", () => {
    const r = parseProject(minimal());
    if (!r.ok) throw new Error("invalid");
    const text = serializeProject(r.project);
    expect(text).not.toContain('"rotate"');
    expect(text).not.toContain('"fit"');
    expect(text.endsWith("}\n")).toBe(true);
    const again = parseProject(JSON.parse(text));
    expect(again.ok && again.project).toEqual(r.project);
  });
});
