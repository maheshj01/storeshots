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
