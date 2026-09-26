import { describe, expect, it } from "vitest";
import { checkImage, checkSet, type ImageFacts } from "./index.ts";

const img = (over: Partial<ImageFacts>): ImageFacts => ({
  store: "play",
  device: "phone",
  width: 1080,
  height: 1920,
  format: "png",
  hasAlpha: false,
  ...over,
});
const rules = (v: { rule: string }[]) => v.map((x) => x.rule);

describe("checkImage", () => {
  it.each([
    ["default Play phone", img({}), []],
    ["alpha", img({ hasAlpha: true }), ["play.alpha"]],
    ["too small", img({ width: 300, height: 500 }), ["play.minSide"]],
    ["too large", img({ width: 2000, height: 4000 }), ["play.maxSide"]],
    ["too tall", img({ width: 1000, height: 2100 }), ["play.maxAspect"]],
    ["tablet not 16:9", img({ device: "tablet-10", width: 1600, height: 2000 }), ["play.tablet-10.aspect"]],
    ["tablet 16:9 landscape", img({ device: "tablet-10", width: 1920, height: 1080 }), []],
    ["iPhone 6.9", img({ store: "appstore", device: "iphone-6.9", width: 1320, height: 2868 }), []],
    ["iPhone 6.9 landscape", img({ store: "appstore", device: "iphone-6.9", width: 2868, height: 1320 }), []],
    ["iPhone wrong size", img({ store: "appstore", device: "iphone-6.9", width: 1080, height: 1920 }), ["appstore.iphone-6.9.size"]],
    ["App Store without class", img({ store: "appstore", device: undefined }), ["appstore.device"]],
    ["iPad 13", img({ store: "appstore", device: "ipad-13", width: 2064, height: 2752 }), []],
  ] as const)("%s", (_name, facts, expected) => {
    expect(rules(checkImage(facts))).toEqual(expected);
  });
});

describe("checkSet", () => {
  const phone = (n: number, w = 1080, h = 1920) => Array.from({ length: n }, () => ({ width: w, height: h }));
  it("needs two phone screenshots", () => {
    expect(rules(checkSet({ store: "play", images: phone(1) }))).toEqual(["play.phone.minCount", "play.promotion"]);
  });
  it("warns below promotion eligibility", () => {
    expect(rules(checkSet({ store: "play", images: phone(3) }))).toEqual(["play.promotion"]);
  });
  it("is eligible with four 1080x1920", () => {
    expect(checkSet({ store: "play", images: phone(4) })).toEqual([]);
  });
  it("games need three", () => {
    expect(checkSet({ store: "play", kind: "game", images: phone(3, 1920, 1080) })).toEqual([]);
  });
  it("small but valid sizes miss promotion", () => {
    expect(rules(checkSet({ store: "play", images: phone(5, 720, 1280) }))).toEqual(["play.promotion"]);
  });
  it("App Store allows 1 to 10", () => {
    expect(checkSet({ store: "appstore", device: "iphone-6.9", images: phone(10) })).toEqual([]);
    expect(rules(checkSet({ store: "appstore", device: "iphone-6.9", images: phone(11) }))).toEqual(["appstore.maxCount"]);
  });
});
