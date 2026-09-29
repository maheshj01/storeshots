import { describe, expect, it } from "vitest";
import { applyTemplate, newProject } from "./templates.ts";

describe("applyTemplate", () => {
  it("on some screens, leaves the theme and the other screens alone", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    const [first, second] = doc.screens;
    const theme = JSON.stringify(doc.theme);
    const other = JSON.stringify(second);
    applyTemplate(doc, "editorial", [first!.id]);
    expect(JSON.stringify(doc.theme)).toBe(theme);
    expect(JSON.stringify(doc.screens[1])).toBe(other);
    // The re-laid-out screen uses plain values, except the brand colour.
    const refs = JSON.stringify(doc.screens[0]).match(/"\$[a-zA-Z]+"/g) ?? [];
    expect(refs.every((r) => r === '"$brand"')).toBe(true);
  });

  it("on every screen, becomes the theme", () => {
    const { doc } = newProject("App", "headline", "#2F6FEB");
    applyTemplate(doc, "editorial", doc.screens.map((s) => s.id));
    expect(doc.theme.colors.page).toBeDefined();
    expect(JSON.stringify(doc.screens[0])).toContain('"$heading"');
  });
});
