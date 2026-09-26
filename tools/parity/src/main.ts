import { parseProject } from "@storeshots/schema";
import { AssetCache, renderScreen, type Ctx } from "@storeshots/core";
import { browserHost } from "./browser-host.ts";

declare const __REPO__: string;

/**
 * Renders a project in the browser and compares every image with the Node
 * render already on disk (run `storeshots render` first). Results are shown
 * on the page and published on window.parity for automation.
 */
const params = new URLSearchParams(location.search);
const project = params.get("project") ?? "examples/epoch";
const base = `${location.origin}/@fs${__REPO__}${project}/`;

interface Stat {
  image: string;
  meanAbs: number;
  maxAbs: number;
  /** Share of pixels where any channel differs by more than 8 of 255. */
  over8: number;
  over32: number;
  /** Share of >8 pixels that fall inside text layer boxes. */
  inText: number;
}

async function pixels(src: CanvasImageSource & { width: number; height: number }) {
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height).data;
}

function diff(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, textRows: (y: number) => boolean) {
  let inText = 0;
  const heat = new ImageData(w, h);
  let sum = 0;
  let max = 0;
  let over8 = 0;
  let over32 = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
    sum += d;
    if (d > max) max = d;
    if (d > 8) {
      over8++;
      if (textRows(Math.floor(i / 4 / w))) inText++;
    }
    if (d > 32) over32++;
    const v = Math.min(255, d * 4);
    heat.data[i] = v;
    heat.data[i + 1] = d > 32 ? 0 : v;
    heat.data[i + 2] = d > 32 ? 0 : v;
    heat.data[i + 3] = 255;
  }
  const n = a.length / 4;
  return { meanAbs: sum / n, maxAbs: max, over8: over8 / n, over32: over32 / n, inText: over8 ? inText / over8 : 0, heat };
}

function show(title: string, draw: (ctx: Ctx, c: HTMLCanvasElement) => void, w: number, h: number) {
  const fig = document.createElement("figure");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d") as Ctx, c);
  const cap = document.createElement("figcaption");
  cap.textContent = title;
  fig.append(c, cap);
  return fig;
}

async function run() {
  const host = browserHost(base, { gpu: params.get("gpu") === "1" });
  const parsed = parseProject(await (await fetch(base + "storeshots.json")).json());
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join("\n"));
  const p = parsed.project;
  const cache = new AssetCache(host);
  const stats: Stat[] = [];
  const out = document.getElementById("out")!;
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>image</th><th>mean |Δ|</th><th>max |Δ|</th><th>&gt;8</th><th>&gt;32</th></tr>";
  out.append(table);
  const worst = { score: -1, row: null as HTMLElement | null };

  for (const target of p.targets) {
    for (const locale of p.locales.list) {
      let index = 0;
      for (const screen of p.screens) {
        index++;
        const name = `${target.id}/${locale}/${String(index).padStart(2, "0")}_${screen.id}.png`;
        const nodeImg = await host.loadImage(`store/${name}`);
        if (!nodeImg) throw new Error(`missing Node render store/${name}; run storeshots render first`);
        const { canvas } = await renderScreen(p, { screen: screen.id, target: target.id, locale }, cache);
        const w = canvas.width;
        const h = canvas.height;
        const a = canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
        const b = await pixels(nodeImg as ImageBitmap);
        const bands = screen.layers.filter((l) => l.type === "text").map((l) => [l.box.y * h, (l.box.y + l.box.h) * h]);
        const d = diff(a, b, w, h, (y) => bands.some(([t, btm]) => y >= t! && y < btm!));
        const s: Stat = { image: name, meanAbs: d.meanAbs, maxAbs: d.maxAbs, over8: d.over8, over32: d.over32, inText: d.inText };
        stats.push(s);
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${name}</td><td>${s.meanAbs.toFixed(3)}</td><td>${s.maxAbs}</td><td>${(s.over8 * 100).toFixed(3)}%</td><td>${(s.over32 * 100).toFixed(3)}%</td>`;
        table.append(tr);
        if (s.over8 > worst.score) {
          worst.score = s.over8;
          const row = document.createElement("div");
          row.className = "row";
          row.append(
            show(`browser: ${name}`, (ctx) => ctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0), w, h),
            show("node", (ctx) => ctx.drawImage(nodeImg as ImageBitmap, 0, 0), w, h),
            show("difference ×4 (red: >32)", (ctx) => ctx.putImageData(d.heat, 0, 0), w, h),
          );
          worst.row?.remove();
          worst.row = row;
          out.append(row);
        }
      }
    }
  }
  (window as unknown as { parity: Stat[] }).parity = stats;
  document.getElementById("status")!.textContent = `Compared ${stats.length} images. Worst shown below.`;
}

run().catch((e: Error) => {
  document.getElementById("status")!.textContent = `Error: ${e.message}`;
  (window as unknown as { parityError: string }).parityError = e.message;
});
