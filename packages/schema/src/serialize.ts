import { Project, type Layer, type Target } from "./project.ts";

/** Values the schema fills in by default; omitted on save to keep files short. */
const LAYER_DEFAULTS: Record<string, unknown> = { rotate: 0, opacity: 1 };
const TYPE_DEFAULTS: Record<Layer["type"], Record<string, unknown>> = {
  text: { lineHeight: 1.2, color: "#000000", align: "center", valign: "top", fit: "shrink", balance: true },
  image: { fit: "contain", radius: 0 },
  shape: { radius: 0 },
  device: { shadow: true, capture: "" },
};

function prune<T extends object>(obj: T, defaults: Record<string, unknown>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (k in defaults && JSON.stringify(defaults[k]) === JSON.stringify(v)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Rounds canvas fractions so drags don't write 17 decimal places. */
function round(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
}

/**
 * Turns a project into the storeshots.json people read: schema key order,
 * defaults omitted, numbers rounded, two-space indentation, trailing newline.
 */
export function serializeProject(input: Project): string {
  // Parsing puts every object's keys in schema order, however it was built.
  const p = Project.parse(input);
  const doc = {
    schemaVersion: p.schemaVersion,
    name: p.name,
    locales: p.locales,
    targets: p.targets.map((t) => prune<Target>(t, { format: "png" })),
    theme: p.theme,
    screens: p.screens.map((s) => ({
      id: s.id,
      background: s.background,
      layers: s.layers.map((l) => ({
        type: l.type,
        ...prune(l, { ...LAYER_DEFAULTS, ...TYPE_DEFAULTS[l.type], type: l.type }),
      })),
    })),
    captions: p.captions,
  };
  return pretty(round(doc), "") + "\n";
}

/** JSON with two-space indentation, keeping short arrays of plain values on one line. */
function pretty(v: unknown, indent: string): string {
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const flat = v.every((x) => x === null || typeof x !== "object" || (Array.isArray(x) && x.every((y) => typeof y !== "object")));
    const oneLine = `[${v.map((x) => pretty(x, inner)).join(", ")}]`;
    if (flat && oneLine.length <= 80) return oneLine;
    return `[\n${v.map((x) => inner + pretty(x, inner)).join(",\n")}\n${indent}]`;
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(v);
}
