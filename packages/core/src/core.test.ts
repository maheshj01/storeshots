import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { encodePngRgb, readPngHeader } from "./png.ts";
import { layoutText, layoutTextBlock, tokenize } from "./text.ts";
import { readFontMetrics } from "./fontmetrics.ts";
import { blurAlpha, boxesForGauss } from "./shadow.ts";
import { opaque } from "./color.ts";
import type { Ctx } from "./host.ts";

/** A fake context where every character is 10px wide at 20px (scales with size). */
function fakeCtx(): Ctx {
  let size = 20;
  return {
    set font(v: string) {
      size = parseFloat(v);
    },
    get font() {
      return `${size}px x`;
    },
    measureText: (t: string) => ({ width: [...t].length * size * 0.5 }),
  } as unknown as Ctx;
}

describe("tokenize", () => {
  it("splits on spaces", () => {
    expect(tokenize("see your year")).toEqual([
      { sep: "", word: "see" },
      { sep: " ", word: "your" },
      { sep: " ", word: "year" },
    ]);
  });
  it("breaks between CJK characters and keeps closing punctuation attached", () => {
    expect(tokenize("一年を。").map((t) => t.word)).toEqual(["一", "年", "を。"]);
  });
});

describe("layoutText", () => {
  const base = { family: "x", size: 20, lineHeight: 1, maxHeight: 1000, fit: "shrink" as const, balance: false };
  it("wraps greedily", () => {
    const l = layoutText(fakeCtx(), { ...base, text: "aaaa bbbb cccc", maxWidth: 100 });
    expect(l.lines.map((x) => x.text)).toEqual(["aaaa bbbb", "cccc"]);
    expect(l.size).toBe(20);
  });
  it("keeps explicit newlines", () => {
    const l = layoutText(fakeCtx(), { ...base, text: "a\nb", maxWidth: 100 });
    expect(l.lines.map((x) => x.text)).toEqual(["a", "b"]);
  });
  it("shrinks a long word until it fits", () => {
    const l = layoutText(fakeCtx(), { ...base, text: "Donaudampfschifffahrt", maxWidth: 100 });
    expect(l.overflow).toBe(false);
    expect(l.size * 0.5 * 21).toBeLessThanOrEqual(100);
    expect(l.size).toBeGreaterThan(9);
  });
  it("shrinks to fit the height", () => {
    const l = layoutText(fakeCtx(), { ...base, text: "aaaa bbbb cccc dddd", maxWidth: 100, maxHeight: 30 });
    expect(l.lines.length * l.size).toBeLessThanOrEqual(30);
  });
  it("reports overflow when even the minimum size doesn't fit", () => {
    const l = layoutText(fakeCtx(), { ...base, text: "a".repeat(200), maxWidth: 100 });
    expect(l.overflow).toBe(true);
  });
  it("does not shrink with fit none", () => {
    const l = layoutText(fakeCtx(), { ...base, fit: "none", text: "a".repeat(50), maxWidth: 100 });
    expect(l.size).toBe(20);
    expect(l.overflow).toBe(true);
  });
  it("balances lines without adding one", () => {
    const text = "see your year at a glance";
    const greedy = layoutText(fakeCtx(), { ...base, text, maxWidth: 190 });
    const balanced = layoutTextBlock(fakeCtx(), { ...base, balance: true, text, maxWidth: 190 });
    expect(greedy.lines.map((l) => l.text)).toEqual(["see your year at a", "glance"]);
    expect(balanced.lines.map((l) => l.text)).toEqual(["see your year", "at a glance"]);
  });
});

describe("encodePngRgb", () => {
  it("writes an RGB PNG whose pixels round-trip", async () => {
    const w = 3;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 128 : (i * 37) % 256));
    const png = await encodePngRgb(rgba, w, h, (d) => deflateSync(d));
    expect(readPngHeader(png)).toEqual({ width: 3, height: 2, colorType: 2, hasAlpha: false });
    // Undo the filters and compare with the input's RGB.
    const idatLen = new DataView(png.buffer).getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    const stride = w * 3;
    const out = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)]!;
      for (let i = 0; i < stride; i++) {
        const x = raw[y * (stride + 1) + 1 + i]!;
        const a = i >= 3 ? out[y * stride + i - 3]! : 0;
        const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
        const c = y > 0 && i >= 3 ? out[(y - 1) * stride + i - 3]! : 0;
        const p = a + b - c;
        const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        out[y * stride + i] = (x + [0, a, b, 0, pr][f]!) & 0xff;
      }
    }
    const expected = [...rgba].filter((_, i) => i % 4 !== 3);
    expect([...out]).toEqual(expected);
  });
});

describe("readFontMetrics", () => {
  it("reads Poppins", () => {
    const bytes = readFileSync(new URL("../../../examples/epoch/fonts/Poppins-SemiBold.ttf", import.meta.url));
    const m = readFontMetrics(new Uint8Array(bytes));
    expect(m.ascent).toBeCloseTo(1.05, 2);
    expect(m.descent).toBeCloseTo(0.35, 2);
  });
  it("rejects non-fonts", () => {
    expect(() => readFontMetrics(new Uint8Array(16))).toThrow(/unsupported font/);
  });
});

describe("shadow blur", () => {
  it("uses three odd box sizes", () => {
    const boxes = boxesForGauss(10);
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b % 2 === 1)).toBe(true);
  });
  it("roughly preserves total alpha and spreads it", () => {
    const w = 64;
    const a = new Uint8Array(w * w);
    for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) a[y * w + x] = 255;
    const before = a.reduce((s, v) => s + v, 0);
    blurAlpha(a, w, w, 3);
    const after = a.reduce((s, v) => s + v, 0);
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
    expect(a[20 * w + 32]).toBeGreaterThan(0);
    expect(a[32 * w + 24]).toBeLessThan(255);
  });
});

it("opaque drops alpha", () => {
  expect(opaque("#FFFFFFD9")).toBe("#FFFFFF");
  expect(opaque("#abc")).toBe("#aabbcc");
});
