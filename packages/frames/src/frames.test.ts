import { describe, expect, it } from "vitest";
import { CATALOG, skinToFrame, validateFrame } from "./index.ts";

describe("catalog", () => {
  it.each(CATALOG.map((f) => [f.id, f] as const))("%s is valid", (_id, f) => {
    expect(validateFrame(f)).toEqual([]);
  });
  it("has unique ids", () => {
    expect(new Set(CATALOG.map((f) => f.id)).size).toBe(CATALOG.length);
  });
});

describe("skinToFrame", () => {
  const layout = `
parts {
  device { display { width 1280 height 2856 x 0 y 0 corner_radius 99 } }
  portrait {
    background { image back.webp }
    foreground { mask mask.webp cutout hole }
  }
}
layouts {
  portrait {
    width 1408
    height 2965
    event EV_SW:0:1
    part1 { name portrait x 0 y 0 }
    part2 { name device x 59 y 60 }
  }
}`;
  it("reads the pixel_10_pro layout", () => {
    expect(skinToFrame("pixel_10_pro", layout)).toEqual({
      kind: "bitmap",
      id: "pixel_10_pro",
      name: "pixel_10_pro",
      platform: "android",
      size: [1408, 2965],
      display: [1280, 2856],
      screen: { x: 59, y: 60, w: 1280, h: 2856, radius: 99 },
      background: { src: "back.webp", x: 0, y: 0 },
      mask: { src: "mask.webp" },
    });
  });
  it("rejects a layout without a background", () => {
    expect(() => skinToFrame("x", "parts { device { display { width 1 height 1 } } } layouts { portrait { width 1 height 1 } }")).toThrow(/background/);
  });
});
