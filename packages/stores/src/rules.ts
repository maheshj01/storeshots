import { APPSTORE, PLAY, type Store } from "./specs.ts";

export interface RuleViolation {
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export interface ImageFacts {
  store: Store;
  /** Store device class id, e.g. "phone" or "iphone-6.9". */
  device?: string | undefined;
  width: number;
  height: number;
  format: "png" | "jpeg";
  hasAlpha: boolean;
}

function ratioMatches(w: number, h: number, [a, b]: [number, number], tolerance = 0.005): boolean {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return Math.abs(long / short - Math.max(a, b) / Math.min(a, b)) <= tolerance;
}

/** Rules for a single exported image. Errors block export. */
export function checkImage(img: ImageFacts): RuleViolation[] {
  const out: RuleViolation[] = [];
  const { width: w, height: h } = img;
  if (img.hasAlpha) {
    out.push({ rule: `${img.store}.alpha`, severity: "error", message: "screenshots must not contain transparency" });
  }
  if (img.store === "play") {
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    if (short < PLAY.minSide) {
      out.push({ rule: "play.minSide", severity: "error", message: `${w}×${h}: each side must be at least ${PLAY.minSide} px` });
    }
    if (long > PLAY.maxSide) {
      out.push({ rule: "play.maxSide", severity: "error", message: `${w}×${h}: each side must be at most ${PLAY.maxSide} px` });
    }
    if (long > short * PLAY.maxAspect) {
      out.push({ rule: "play.maxAspect", severity: "error", message: `${w}×${h}: the long side may be at most twice the short side` });
    }
    const cls = PLAY.classes.find((c) => c.id === img.device);
    if (img.device && !cls) {
      out.push({ rule: "play.device", severity: "error", message: `unknown Play device class "${img.device}"` });
    }
    if (cls && cls.aspects.length > 0 && !cls.aspects.some((a) => ratioMatches(w, h, a))) {
      const list = cls.aspects.map(([a, b]) => `${a}:${b}`).join(" or ");
      out.push({ rule: `play.${cls.id}.aspect`, severity: "error", message: `${w}×${h}: ${cls.label} screenshots must be ${list}` });
    }
  } else {
    const cls = APPSTORE.classes.find((c) => c.id === img.device);
    if (!cls) {
      out.push({ rule: "appstore.device", severity: "error", message: `App Store targets need a device class, e.g. "iphone-6.9"; got "${img.device ?? ""}"` });
    } else {
      const ok = cls.sizes.some(([a, b]) => (w === a && h === b) || (w === b && h === a));
      if (!ok) {
        const list = cls.sizes.map(([a, b]) => `${a}×${b}`).join(", ");
        out.push({ rule: `appstore.${cls.id}.size`, severity: "error", message: `${w}×${h}: ${cls.label} accepts ${list} (or landscape)` });
      }
    }
  }
  return out;
}

export interface SetFacts {
  store: Store;
  device?: string | undefined;
  kind?: "app" | "game";
  images: Array<{ width: number; height: number }>;
}

/** Rules for a set of screenshots uploaded together for one device class and locale. */
export function checkSet(set: SetFacts): RuleViolation[] {
  const out: RuleViolation[] = [];
  const n = set.images.length;
  if (set.store === "play") {
    const cls = PLAY.classes.find((c) => c.id === (set.device ?? "phone"));
    if (cls) {
      if (n < cls.minCount) {
        out.push({ rule: `play.${cls.id}.minCount`, severity: "error", message: `${cls.label} needs at least ${cls.minCount} screenshots; has ${n}` });
      }
      if (n > cls.maxCount) {
        out.push({ rule: `play.${cls.id}.maxCount`, severity: "error", message: `${cls.label} allows at most ${cls.maxCount} screenshots; has ${n}` });
      }
    }
    if ((set.device ?? "phone") === "phone") {
      const promo = set.kind === "game" ? PLAY.promotion.games : PLAY.promotion.apps;
      const eligible = set.images.filter(
        (i) => Math.min(i.width, i.height) >= promo.minShortSide && promo.aspects.some((a) => ratioMatches(i.width, i.height, a)),
      );
      if (eligible.length < promo.minCount) {
        out.push({
          rule: "play.promotion",
          severity: "warning",
          message: `not eligible for Play promotion: needs ${promo.minCount}+ screenshots at 9:16 or 16:9 with a short side of ${promo.minShortSide} px or more; has ${eligible.length}`,
        });
      }
    }
  } else {
    if (n < APPSTORE.minCount) {
      out.push({ rule: "appstore.minCount", severity: "error", message: `needs at least ${APPSTORE.minCount} screenshot; has ${n}` });
    }
    if (n > APPSTORE.maxCount) {
      out.push({ rule: "appstore.maxCount", severity: "error", message: `allows at most ${APPSTORE.maxCount} screenshots; has ${n}` });
    }
  }
  return out;
}
