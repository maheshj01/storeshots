import type { Finding, InspectedLayer, ScreenInspection } from "@storeshots/core";

/**
 * Compact text an agent reads instead of a screenshot. One line per layer,
 * positions in output pixels as "x,y w×h", then findings. Kept terse on
 * purpose: this is returned after every edit.
 */

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ""));
export const r = (b: { x: number; y: number; w: number; h: number }) => `${n(b.x)},${n(b.y)} ${n(b.w)}×${n(b.h)}`;

function quote(s: string, max = 80): string {
  const one = s.replace(/\n/g, " / ");
  return JSON.stringify(one.length > max ? `${one.slice(0, max - 1)}…` : one);
}

export function layerLine(l: InspectedLayer): string {
  const common = [`box ${r(l.box)}`];
  if (l.rotate) common.push(`rotate ${n(l.rotate)}°`);
  if (l.opacity !== 1) common.push(`opacity ${n(l.opacity)}`);
  if (l.text) {
    const t = l.text;
    const size = t.size === t.requestedSize ? `${n(t.size)}px` : `${n(t.size)}px (asked ${n(t.requestedSize)})`;
    return [
      `[${l.index}] text ${quote(t.lines.join("\n"))}`,
      `${t.font.replace(/^fonts\//, "")} ${size}`,
      `${t.lines.length} line${t.lines.length === 1 ? "" : "s"}`,
      t.color,
      `${t.align}/${t.valign}`,
      ...common,
      `ink ${r(l.bounds)}`,
      ...(t.caption ? [t.caption] : []),
    ].join(" · ");
  }
  if (l.device) {
    const d = l.device;
    const cap = d.capture ? `${d.capture}${d.captureSize ? ` ${d.captureSize.join("×")}` : " (missing)"}` : "no screenshot";
    const bleed = Object.entries(d.bleed)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${n(v)}`);
    return [
      `[${l.index}] device ${d.frame}${d.variant ? `/${d.variant}` : ""}`,
      cap,
      ...common,
      `body ${r(l.bounds)}`,
      ...(bleed.length ? [`bleeds ${bleed.join(", ")}`] : []),
    ].join(" · ");
  }
  if (l.shape) return [`[${l.index}] shape ${l.shape.shape} ${l.shape.color}`, ...common].join(" · ");
  if (l.image) return [`[${l.index}] image ${l.image.src} (${l.image.fit})`, ...common].join(" · ");
  return `[${l.index}] ${l.type} · ${common.join(" · ")}`;
}

const MARK = { error: "✗", warning: "!", info: "i" } as const;

export function findingLine(f: Finding, where = ""): string {
  const layer = f.layer === undefined ? "" : `[${f.layer}] `;
  return `${MARK[f.severity]} ${where}${layer}${f.code}: ${f.message}`;
}

export function inspectionText(i: ScreenInspection, opts: { layers?: number[] | undefined } = {}): string {
  const lines = [`screen ${i.screen} · ${i.target} ${i.size.join("×")} · ${i.locale} · background ${i.background}`];
  const layers = opts.layers ? i.layers.filter((l) => opts.layers!.includes(l.index)) : i.layers;
  for (const l of layers) lines.push(layerLine(l));
  if (!layers.length) lines.push("(no layers)");
  lines.push(i.findings.length ? "findings:" : "findings: none");
  for (const f of i.findings) lines.push(`  ${findingLine(f)}`);
  return lines.join("\n");
}

export function counts(findings: Finding[]): string {
  const e = findings.filter((f) => f.severity === "error").length;
  const w = findings.filter((f) => f.severity === "warning").length;
  if (!e && !w) return "ok";
  return [e && `${e} error${e > 1 ? "s" : ""}`, w && `${w} warning${w > 1 ? "s" : ""}`].filter(Boolean).join(", ");
}
