import { describe, expect, it } from "vitest";
import { frameFor } from "./edit.ts";

describe("frameFor", () => {
  it.each([
    ["pixel-9-pro", 1320, 2868, "iphone-18-pro-max"],
    ["pixel-9-pro", 1206, 2622, "iphone-18-pro"],
    ["pixel-9-pro", 1260, 2736, "iphone-air"],
    ["iphone-18-pro-max", 1280, 2856, "pixel-9-pro"],
    ["iphone-18-pro", 1080, 2400, "pixel-7"],
    ["iphone-18-pro", 1206, 2622, "iphone-18-pro"],
  ])("a %s with a %i×%i screenshot becomes %s", (current, w, h, expected) => {
    expect(frameFor(current, w, h)).toBe(expected);
  });

  it("keeps an imported skin the person chose", () => {
    expect(frameFor("pixel_10_pro", 1320, 2868)).toBe("pixel_10_pro");
  });
});

describe("theme colours", async () => {
  const { newProject } = await import("./templates.ts");
  const { renameThemeColor, deleteThemeColor, themeColorUses } = await import("./edit.ts");

  it("renames a colour everywhere it's used", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    const uses = themeColorUses(doc, "brandSoft");
    expect(uses).toBeGreaterThan(0);
    renameThemeColor(doc, "brandSoft", "sky");
    expect(themeColorUses(doc, "sky")).toBe(uses);
    expect(themeColorUses(doc, "brandSoft")).toBe(0);
    expect(Object.keys(doc.theme.colors).indexOf("sky")).toBe(1);
    expect(() => renameThemeColor(doc, "sky", "brand")).toThrow(/already/);
  });

  it("keeps a removed colour's value where it was used", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    const value = doc.theme.colors.brandSoft!;
    deleteThemeColor(doc, "brandSoft");
    expect(doc.theme.colors.brandSoft).toBeUndefined();
    expect(JSON.stringify(doc.screens)).toContain(`"${value}"`);
  });
});
