import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createCanvas } from "@napi-rs/canvas";
import type { Layer, Project, Screen } from "@storeshots/schema";
import { CATALOG, findFrame } from "@storeshots/frames";
import { checkImage, checkSet } from "@storeshots/stores";
import { exportProject, inspectScreen, outputPath, renderDevice, renderScreen, type ScreenInspection } from "@storeshots/core";
import * as ops from "@storeshots/ops";
import { BUNDLED_FONTS_DIR } from "@storeshots/ops/fonts-dir";
import { importAndroidSkin, importIosFrame } from "@storeshots/node";
import { ProjectFolder, pickLocale, pickTarget } from "./project.ts";
import { LiveFolder, type Bridge } from "./bridge.ts";
import { counts, findingLine, inspectionText } from "./format.ts";

export const SERVER_NAME = "storeshots-mcp-server";

const UNITS =
  "Positions and sizes are output pixels of the target (default: the first target), x,y is the top-left corner. Layers are numbered from the bottom, starting at 0.";

const THEME =
  'Theme colours are the project\'s named colours, its design system: a colour written "$name" (e.g. "$brand") is a reference to the theme colour "name", so changing that theme colour with storeshots_set_theme restyles every background and layer that uses it. Prefer theme colours over plain #hex for anything that should stay consistent across screens.';

// Shared parameter schemas -------------------------------------------------

const projectDir = z
  .string()
  .optional()
  .describe('Folder containing storeshots.json, or "live" for the project open in the storeshots editor in the browser. Defaults to what the server was started with.');
const screenId = z.string().describe('Screen id, e.g. "home". Screens are named by their id (people rename them in the editor), so a screen the user calls "home" is "home". storeshots_get_project lists them.');
const layerIndex = z.number().int().min(0).describe("Layer number on the screen, 0 = bottom.");
const locale = z.string().optional().describe("Locale for text, e.g. \"de\". Defaults to the project's default locale.");
const target = z.string().optional().describe('Target id, e.g. "play-phone". Defaults to the first target.');
const color = z.string().describe('#RGB, #RRGGBB, #RRGGBBAA, or "$name" to use (and stay linked to) the theme colour "name", e.g. "$brand"');
const layerRef = z.object({ screen: screenId, layer: layerIndex });

const LayerProps = {
  x: z.number().optional().describe("Left edge in px"),
  y: z.number().optional().describe("Top edge in px"),
  w: z.number().positive().optional().describe("Width in px"),
  h: z.number().positive().optional().describe("Height in px"),
  rotate: z.number().min(-180).max(180).optional().describe("Rotation in degrees, clockwise, around the box centre"),
  opacity: z.number().min(0).max(1).optional(),
  // text
  text: z.string().optional().describe("Text layers: the words, for `locale`. Use \\n for a forced line break."),
  font: z.string().optional().describe('Text layers: "$heading", "$body", or a font file like "fonts/DMSerifDisplay-Regular.ttf". Bundled fonts are copied in when first used.'),
  font_size: z.number().positive().optional().describe("Text layers: font size in px"),
  line_height: z.number().positive().optional().describe("Text layers: line height as a multiple of the font size, e.g. 1.1"),
  color: color.optional().describe('Text and shape layers: colour, #hex or "$name" for a theme colour'),
  align: z.enum(["left", "center", "right"]).optional().describe("Text layers"),
  valign: z.enum(["top", "middle", "bottom"]).optional().describe("Text layers: where the lines sit in the box"),
  shrink_to_fit: z.boolean().optional().describe("Text layers: shrink the font until the text fits the box (default true)"),
  balance: z.boolean().optional().describe("Text layers: even out line lengths (default true)"),
  // device
  frame: z.string().optional().describe("Device layers: frame id, e.g. pixel-9-pro. storeshots_get_project lists them."),
  variant: z.string().optional().describe("Device layers: frame finish, e.g. obsidian"),
  capture: z.string().optional().describe('Device layers: screenshot file name in captures/<locale>/, e.g. "01_home.png". "" removes it. A matching frame is picked automatically.'),
  shadow: z.boolean().optional().describe("Device layers: drop shadow"),
  // shape and image
  shape: z.enum(["rect", "ellipse"]).optional().describe("Shape layers"),
  radius: z.number().min(0).optional().describe("Shape and image layers: corner radius in px"),
  src: z.string().optional().describe("Image layers: image file in the project, e.g. images/badge.png"),
  image_fit: z.enum(["contain", "cover", "fill"]).optional().describe("Image layers"),
};
const LayerPatch = z.object(LayerProps).strict();
type Patch = z.infer<typeof LayerPatch>;

const APPLIES: Record<string, Array<Layer["type"]>> = {
  text: ["text"], font: ["text"], font_size: ["text"], line_height: ["text"], align: ["text"], valign: ["text"],
  shrink_to_fit: ["text"], balance: ["text"], color: ["text", "shape"], frame: ["device"], variant: ["device"],
  capture: ["device"], shadow: ["device"], shape: ["shape"], radius: ["shape", "image"], src: ["image"], image_fit: ["image"],
};

// Helpers ---------------------------------------------------------------

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(e: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A project-relative path that stays inside the project folder. */
function inside(path: string, what: string): string {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`${what} "${path}" must be a path inside the project folder`);
  return path;
}

/** Copies a bundled font into the project if a font path names one that isn't there yet. */
async function ensureFont(folder: ProjectFolder, font: string) {
  if (font.startsWith("$")) return;
  if (!/^fonts\/[^/\\]+\.(ttf|otf)$/i.test(font)) throw new Error(`font "${font}" should be "$heading", "$body" or a file like fonts/Name.ttf`);
  if (await exists(join(folder.dir, font))) return;
  const bundled = join(BUNDLED_FONTS_DIR, basename(font));
  if (!(await exists(bundled))) {
    throw new Error(`font "${font}" isn't in the project or the bundled fonts (${ops.BUNDLED_FONTS.map((f) => `fonts/${f.file}`).join(", ")})`);
  }
  await mkdir(join(folder.dir, "fonts"), { recursive: true });
  await copyFile(bundled, join(folder.dir, font));
}

async function captureSize(folder: ProjectFolder, p: Project, name: string, loc: string): Promise<{ name: string; width: number; height: number }> {
  const found = await folder.cache().capture(p, name, loc);
  if (!found) {
    const have = await folder.captures(p.locales.default);
    throw new Error(`screenshot "${name}" not found in captures/${loc}/ or its fallbacks. Available: ${have.join(", ") || "none; add one with storeshots_import_capture"}`);
  }
  return { name, width: found.image.width, height: found.image.height };
}

/** Applies a patch to one layer. Fails without changing anything if a field doesn't fit the layer type. */
async function applyPatch(folder: ProjectFolder, p: Project, screen: string, index: number, patch: Patch, tgt: string | undefined, loc: string) {
  const layer = ops.getLayer(p, screen, index);
  const wrong = Object.keys(patch).filter((k) => APPLIES[k] && !APPLIES[k]!.includes(layer.type));
  if (wrong.length) throw new Error(`${wrong.join(", ")} can't be set on a ${layer.type} layer`);
  const t = pickTarget(p, tgt);
  const [W, H] = t.size;
  if (patch.x !== undefined) layer.box.x = patch.x / W;
  if (patch.y !== undefined) layer.box.y = patch.y / H;
  if (patch.w !== undefined) layer.box.w = patch.w / W;
  if (patch.h !== undefined) layer.box.h = patch.h / H;
  if (patch.rotate !== undefined) layer.rotate = patch.rotate;
  if (patch.opacity !== undefined) layer.opacity = patch.opacity;
  if (layer.type === "text") {
    if (patch.text !== undefined) ops.setLayerText(p, screen, index, loc, patch.text);
    if (patch.font !== undefined) {
      await ensureFont(folder, patch.font);
      layer.font = patch.font;
    }
    if (patch.font_size !== undefined) layer.size = patch.font_size / W;
    if (patch.line_height !== undefined) layer.lineHeight = patch.line_height;
    if (patch.color !== undefined) layer.color = patch.color;
    if (patch.align !== undefined) layer.align = patch.align;
    if (patch.valign !== undefined) layer.valign = patch.valign;
    if (patch.shrink_to_fit !== undefined) layer.fit = patch.shrink_to_fit ? "shrink" : "none";
    if (patch.balance !== undefined) layer.balance = patch.balance;
  } else if (layer.type === "device") {
    if (patch.frame !== undefined) {
      const known = findFrame(patch.frame) || (await folder.importedFrames()).includes(patch.frame);
      if (!known) throw new Error(`no frame "${patch.frame}"; frames are ${CATALOG.map((f) => f.id).join(", ")}`);
      layer.frame = patch.frame;
      layer.variant = undefined;
    }
    if (patch.variant !== undefined) {
      const f = findFrame(typeof layer.frame === "string" ? layer.frame : "");
      if (f && !(patch.variant in f.variants)) throw new Error(`${f.id} finishes are ${Object.keys(f.variants).join(", ")}`);
      layer.variant = patch.variant;
    }
    if (patch.shadow !== undefined) layer.shadow = patch.shadow;
    if (patch.capture !== undefined) {
      if (patch.capture === "") layer.capture = "";
      else ops.setCapture(p, screen, index, await captureSize(folder, p, patch.capture, loc), t);
    }
  } else if (layer.type === "shape") {
    if (patch.shape !== undefined) layer.shape = patch.shape;
    if (patch.color !== undefined) layer.color = patch.color;
    if (patch.radius !== undefined) layer.radius = patch.radius / W;
  } else {
    if (patch.src !== undefined) {
      if (!(await exists(join(folder.dir, inside(patch.src, "image"))))) throw new Error(`image "${patch.src}" isn't in the project folder`);
      layer.src = patch.src;
    }
    if (patch.image_fit !== undefined) layer.fit = patch.image_fit;
    if (patch.radius !== undefined) layer.radius = patch.radius / W;
  }
}

/**
 * Applies a patch to several layers, each getting only the fields its type
 * has. Returns what was skipped per layer; fails if a field fits none.
 */
async function applyPatchToMany(folder: ProjectFolder, p: Project, refs: Array<{ screen: string; layer: number }>, patch: Patch, tgt: string | undefined, loc: string): Promise<string[]> {
  const used = new Set<string>();
  const notes: string[] = [];
  for (const r of refs) {
    const type = ops.getLayer(p, r.screen, r.layer).type;
    const fits = Object.entries(patch).filter(([k]) => !APPLIES[k] || APPLIES[k]!.includes(type));
    const skipped = Object.keys(patch).filter((k) => APPLIES[k] && !APPLIES[k]!.includes(type));
    fits.forEach(([k]) => used.add(k));
    if (skipped.length) notes.push(`${r.screen} [${r.layer}] is a ${type} layer: skipped ${skipped.join(", ")}`);
    if (fits.length) await applyPatch(folder, p, r.screen, r.layer, Object.fromEntries(fits) as Patch, tgt, loc);
  }
  const unused = Object.keys(patch).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`${unused.join(", ")} can't be set on any of these layers (${[...new Set(refs.map((r) => ops.getLayer(p, r.screen, r.layer).type))].join(", ")})`);
  return notes;
}

async function inspect(folder: ProjectFolder, p: Project, screen: string, loc?: string, tgt?: string): Promise<ScreenInspection> {
  return inspectScreen(p, { screen, locale: pickLocale(p, loc), target: pickTarget(p, tgt).id }, folder.cache());
}

/** After an edit: the touched layers, then every finding on the screen. */
async function afterEdit(folder: ProjectFolder, p: Project, done: string, screen: string, layers?: number[], loc?: string, tgt?: string) {
  const i = await inspect(folder, p, screen, loc, tgt);
  return ok(`${done}\n${inspectionText(i, { layers })}`);
}

/** Theme colours with their values and how many places use each. */
function themeLine(p: Project): string {
  return Object.entries(p.theme.colors).map(([k, v]) => `$${k} ${v} (used ${ops.themeColorUses(p, k)}×)`).join(" · ") || "none";
}

function screenSummary(p: Project, s: Screen, i: ScreenInspection | null, n: number): string {
  const parts = s.layers.map((l) => {
    if (l.type === "text") return `text ${JSON.stringify(ops.layerText(p, l, p.locales.default).slice(0, 48))}`;
    if (l.type === "device") return `device ${typeof l.frame === "string" ? l.frame : "per-platform"} ${l.capture || "(no screenshot)"}`;
    if (l.type === "shape") return `${l.shape}`;
    return `image ${l.src}`;
  });
  const bg = s.background.type === "solid" ? `solid ${s.background.color}` : s.background.type === "linear-gradient" ? "gradient" : "image";
  return `  ${n}. ${s.id} · ${bg} · ${parts.join(" · ") || "empty"} · ${i ? counts(i.findings) : "?"}`;
}

// Server ----------------------------------------------------------------

export interface ServerOptions {
  /** The live link to the browser editor; without it, "live" isn't available. */
  bridge?: Bridge | undefined;
  /** Where renders of the live project go (storeshots-export/<name> under it). */
  exportRoot?: string | undefined;
}

/** `defaultDir` is a folder with a storeshots.json, or "live" for the browser editor's project. */
export function createServer(defaultDir: string, opts: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: "0.1.0" },
    {
      instructions: [
        'Edits App Store and Google Play screenshot designs. The project is a folder with a storeshots.json, or (project_dir "live") the project open in the storeshots web editor, whose screen updates as you edit.',
        "Start with storeshots_get_project, read a screen with storeshots_inspect_screen, and change it with the edit tools: each edit returns the updated layout and any problems, so you rarely need to render.",
        UNITS,
        THEME,
        'To change the same thing on several layers (say, every caption\'s font), pass them all in one storeshots_update_layer call with "layers"; each layer only gets the fields its type has. storeshots_set_background and storeshots_apply_template also take several screens. Changes stay on what you name: a template applied to some screens leaves the others and the theme alone.',
        "Run storeshots_check before exporting with storeshots_render. Every edit is saved to storeshots.json immediately; use git to review or revert.",
      ].join(" "),
    },
  );
  const folders = new Map<string, ProjectFolder>();
  let live: LiveFolder | null = null;
  const folderFor = (dir?: string): ProjectFolder => {
    const target = dir ?? defaultDir;
    if (target === "live") {
      if (!opts.bridge) throw new Error("the live link to the browser editor isn't running in this server; pass project_dir with a folder instead");
      return (live ??= new LiveFolder(opts.bridge, opts.exportRoot ?? process.cwd()));
    }
    const key = resolve(target);
    let f = folders.get(key);
    if (!f) folders.set(key, (f = new ProjectFolder(key)));
    return f;
  };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    "storeshots_get_project",
    {
      title: "Get project overview",
      description: `Summarises a storeshots project: targets and sizes, locales, theme colours (with how often each is used) and fonts, available frames, templates and screenshots, and each screen's layers with a count of problems. Start here. ${UNITS}`,
      inputSchema: { project_dir: projectDir },
      annotations: read,
    },
    async ({ project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const p = await folder.load();
        const cache = folder.cache();
        const lines = [`project ${JSON.stringify(p.name)} · ${folder.describe()}`];
        lines.push(`targets: ${p.targets.map((t, i) => `${t.id} ${t.size.join("×")} (${t.store}${t.device ? ` ${t.device}` : ""}, ${t.format})${i === 0 ? " [default]" : ""}`).join(" · ")}`);
        lines.push(`locales: ${p.locales.list.map((l) => (l === p.locales.default ? `${l} (default)` : l)).join(", ")}`);
        lines.push(`theme colours ($name references): ${themeLine(p)}`);
        lines.push(`theme fonts: ${Object.entries(p.theme.fonts).map(([k, v]) => `$${k} ${v}`).join(" · ") || "none"}`);
        lines.push(`bundled fonts: ${ops.BUNDLED_FONTS.map((f) => `fonts/${f.file}`).join(", ")}`);
        const imported = await folder.importedFrames();
        lines.push(`frames: ${CATALOG.map((f) => `${f.id} (${f.display.join("×")}; ${Object.keys(f.variants).join("|")})`).join(" · ")}${imported.length ? ` · imported: ${imported.join(", ")}` : ""}`);
        lines.push(`templates: ${ops.TEMPLATES.map((t) => `${t.id} (${t.blurb})`).join(" · ")}`);
        for (const loc of p.locales.list) {
          const caps = await folder.captures(loc);
          if (!caps.length) continue;
          const sized = await Promise.all(
            caps.map(async (c) => {
              const img = await cache.image(`captures/${loc}/${c}`);
              return img ? `${c} ${img.width}×${img.height}` : c;
            }),
          );
          lines.push(`captures/${loc}: ${sized.join(", ")}`);
        }
        lines.push(`screens (${p.locales.default}, ${p.targets[0]!.id}):`);
        for (const [n, s] of p.screens.entries()) {
          const i = await inspectScreen(p, { screen: s.id }, cache).catch(() => null);
          lines.push(screenSummary(p, s, i, n + 1));
        }
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_inspect_screen",
    {
      title: "Inspect a screen",
      description: `Describes one screen as it will render, without an image: each layer's box, rotation, text as wrapped (lines, final font size after shrink-to-fit, ink bounds), device frame, screenshot and how far it bleeds off the canvas, plus problems such as overflowing, clipped or hidden text, low contrast and missing screenshots. ${UNITS} Use format "json" for machine-readable output.`,
      inputSchema: { screen: screenId, locale, target, format: z.enum(["text", "json"]).default("text"), project_dir: projectDir },
      annotations: read,
    },
    async ({ screen, locale: loc, target: tgt, format, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const i = await inspect(folder, await folder.load(), screen, loc, tgt);
        return ok(format === "json" ? JSON.stringify(i) : inspectionText(i));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_check",
    {
      title: "Check the whole project",
      description:
        "Checks every screen in every locale and target: store rules (sizes, counts, Play promotion eligibility) and layout problems (text overflow, clipping, hidden text, low contrast, missing screenshots). Lists only problems. Run before exporting, and after changing captions in any language.",
      inputSchema: {
        locales: z.array(z.string()).optional().describe("Only these locales; default all"),
        include_info: z.boolean().default(false).describe("Also list informational notes, like phones that bleed off the edge on purpose"),
        project_dir: projectDir,
      },
      annotations: read,
    },
    async ({ locales, include_info, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const p = await folder.load();
        const cache = folder.cache();
        const out: string[] = [];
        let errors = 0;
        let warnings = 0;
        for (const t of p.targets) {
          for (const v of checkImage({ store: t.store, device: t.device, width: t.size[0], height: t.size[1], format: t.format, hasAlpha: false })) {
            out.push(`${v.severity === "error" ? "✗" : "!"} ${t.id}: ${v.rule}: ${v.message}`);
            v.severity === "error" ? errors++ : warnings++;
          }
          for (const v of checkSet({ store: t.store, device: t.device, images: p.screens.map(() => ({ width: t.size[0], height: t.size[1] })) })) {
            out.push(`${v.severity === "error" ? "✗" : "!"} ${t.id}: ${v.rule}: ${v.message}`);
            v.severity === "error" ? errors++ : warnings++;
          }
          for (const loc of locales ?? p.locales.list) {
            pickLocale(p, loc);
            for (const s of p.screens) {
              const i = await inspectScreen(p, { screen: s.id, target: t.id, locale: loc }, cache);
              for (const f of i.findings) {
                if (f.severity === "info" && !include_info) continue;
                if (f.severity === "error") errors++;
                if (f.severity === "warning") warnings++;
                out.push(findingLine(f, `${t.id}/${loc}/${s.id} `));
              }
            }
          }
        }
        const head = errors || warnings ? `${errors} errors, ${warnings} warnings` : "no problems found";
        return ok([head, ...out].join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_update_layer",
    {
      title: "Update one or more layers",
      description: `Changes layers: position and size, rotation, opacity, and type-specific properties (text, font, font size, colour, alignment for text; frame, finish, screenshot, shadow for devices; shape, colour, radius for shapes; fit, radius for images). Only the fields you pass change, and the values are set as given on every layer (x: 80 puts each at x 80). For one layer pass screen and layer; a field its type doesn't have is refused. For several at once, even on different screens (e.g. every caption's font), pass "layers": each gets only the fields its type has, and the result says what was skipped. All of it is one change. Returns the updated layers and each screen's problems. ${UNITS}`,
      inputSchema: {
        screen: screenId.optional().describe("One layer: its screen id"),
        layer: layerIndex.optional().describe("One layer: its number, 0 = bottom"),
        layers: z.array(layerRef).min(1).optional().describe('Several layers instead of screen and layer, e.g. [{"screen":"home","layer":1},{"screen":"search","layer":1}]'),
        set: LayerPatch.describe("Fields to change"),
        locale,
        target,
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ screen, layer, layers, set, locale: loc, target: tgt, project_dir }) => {
      try {
        if (!layers === (screen === undefined || layer === undefined)) throw new Error("pass either screen and layer, or layers");
        const folder = folderFor(project_dir);
        if (!layers) {
          const { project } = await folder.edit(async (p) => applyPatch(folder, p, screen!, layer!, set, tgt, pickLocale(p, loc)));
          return afterEdit(folder, project, `updated ${screen} [${layer}]: ${Object.keys(set).join(", ")}`, screen!, [layer!], loc, tgt);
        }
        const { project, result: notes } = await folder.edit(async (p) => applyPatchToMany(folder, p, layers, set, tgt, pickLocale(p, loc)));
        const out = [`updated ${layers.length} layers: ${Object.keys(set).join(", ")}`, ...notes];
        for (const id of [...new Set(layers.map((r) => r.screen))]) {
          const i = await inspect(folder, project, id, loc, tgt);
          out.push(inspectionText(i, { layers: layers.filter((r) => r.screen === id).map((r) => r.layer) }));
        }
        return ok(out.join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_add_layer",
    {
      title: "Add a layer",
      description: `Adds a text, device, shape or image layer to a screen with sensible defaults, then applies any fields in "set". New text gets its own caption. Returns the new layer's number and the screen's problems. ${UNITS}`,
      inputSchema: {
        screen: screenId,
        type: z.enum(["text", "device", "shape", "image"]),
        at: z.number().int().min(0).optional().describe("Stacking position; default on top"),
        set: LayerPatch.optional().describe("Initial properties"),
        locale,
        target,
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ screen, type, at, set, locale: loc, target: tgt, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        if (type === "image" && !set?.src) throw new Error('image layers need set.src, a file in the project such as "images/badge.png"');
        const { project, result: index } = await folder.edit(async (p) => {
          const index = ops.addLayer(p, screen, type, pickTarget(p, tgt), {}, at);
          const layer = ops.getLayer(p, screen, index);
          if (layer.type === "text") await ensureFont(folder, layer.font);
          if (set) await applyPatch(folder, p, screen, index, set, tgt, pickLocale(p, loc));
          return index;
        });
        return afterEdit(folder, project, `added ${type} layer ${screen} [${index}]`, screen, [index], loc, tgt);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_arrange_layer",
    {
      title: "Remove, duplicate or restack a layer",
      description:
        'action "remove" deletes the layer; "duplicate" copies it just above itself (text gets its own caption); "move_to" puts it at stacking position `to` (0 = bottom). Layer numbers above the change shift, so the result lists the screen again: use the new numbers for further edits (when removing several layers from one screen, remove the highest number first).',
      inputSchema: {
        screen: screenId,
        layer: layerIndex,
        action: z.enum(["remove", "duplicate", "move_to"]),
        to: z.number().int().min(0).optional().describe("For move_to: the new position"),
        project_dir: projectDir,
      },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ screen, layer, action, to, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const { project, result } = await folder.edit((p) => {
          if (action === "remove") {
            ops.deleteLayer(p, screen, layer);
            return `removed ${screen} [${layer}]`;
          }
          if (action === "duplicate") return `duplicated ${screen} [${layer}] as [${ops.duplicateLayer(p, screen, layer)}]`;
          if (to === undefined) throw new Error("move_to needs `to`");
          ops.moveLayer(p, screen, layer, to);
          return `moved ${screen} [${layer}] to [${to}]`;
        });
        return afterEdit(folder, project, result, screen);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_align_layer",
    {
      title: "Align a layer",
      description:
        "Moves a layer so what it visibly draws (the text itself, or the phone body, including rotation) lines up with the canvas: left, center or right, and top, middle or bottom, with an optional margin in px. Faster than computing coordinates.",
      inputSchema: {
        screen: screenId,
        layer: layerIndex,
        horizontal: z.enum(["left", "center", "right"]).optional(),
        vertical: z.enum(["top", "middle", "bottom"]).optional(),
        margin: z.number().default(0).describe("Distance from the chosen edge in px"),
        locale,
        target,
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ screen, layer, horizontal, vertical, margin, locale: loc, target: tgt, project_dir }) => {
      try {
        if (!horizontal && !vertical) throw new Error("pass horizontal, vertical or both");
        const folder = folderFor(project_dir);
        const { project } = await folder.edit(async (p) => {
          const i = await inspect(folder, p, screen, loc, tgt);
          const b = i.layers[layer]?.bounds;
          if (!b) throw new Error(`screen "${screen}" has no layer ${layer}`);
          const [W, H] = i.size;
          const dx = horizontal === "left" ? margin - b.x : horizontal === "right" ? W - margin - (b.x + b.w) : horizontal === "center" ? (W - b.w) / 2 - b.x : 0;
          const dy = vertical === "top" ? margin - b.y : vertical === "bottom" ? H - margin - (b.y + b.h) : vertical === "middle" ? (H - b.h) / 2 - b.y : 0;
          const l = ops.getLayer(p, screen, layer);
          l.box.x += dx / W;
          l.box.y += dy / H;
        });
        return afterEdit(folder, project, `aligned ${screen} [${layer}] ${[horizontal, vertical].filter(Boolean).join(" ")}`, screen, [layer], loc, tgt);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_edit_screens",
    {
      title: "Add, copy, remove or reorder screens",
      description:
        'action "add" inserts a screen after `screen` (default: last) copying its layout with placeholder captions and no screenshot; "duplicate" copies `screen` with its own captions; "remove" deletes it; "move_to" puts it at position `to` (0 = first in the listing); "rename" gives it a new id from `name` ("Add event" becomes "add-event"): the id is how the user and tools refer to the screen and names its exported files, so name screens after what they show when the user hasn\'t; "apply_layout_to_all" copies its background and layers onto every other screen, keeping their text and screenshots (it overwrites their design, so use it only when asked to make every screen match).',
      inputSchema: {
        action: z.enum(["add", "duplicate", "remove", "move_to", "rename", "apply_layout_to_all"]),
        screen: z.string().optional().describe("The screen to act on (for add: the one to insert after)"),
        to: z.number().int().min(0).optional().describe("For move_to"),
        new_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).optional().describe("For add: id of the new screen"),
        name: z.string().optional().describe('For rename: the new name, e.g. "Add event" (becomes the id "add-event")'),
        project_dir: projectDir,
      },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ action, screen, to, new_id, name, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const need = () => {
          if (!screen) throw new Error(`${action} needs \`screen\``);
          return screen;
        };
        const { project, result } = await folder.edit((p) => {
          switch (action) {
            case "add":
              return `added screen ${ops.addScreen(p, screen, new_id ?? ops.freshScreenId(p))}`;
            case "duplicate":
              return `duplicated ${need()} as ${ops.duplicateScreen(p, need())}`;
            case "remove":
              ops.deleteScreen(p, need());
              return `removed ${need()}`;
            case "move_to":
              if (to === undefined) throw new Error("move_to needs `to`");
              ops.moveScreen(p, need(), to);
              return `moved ${need()} to position ${to}`;
            case "rename": {
              if (!name) throw new Error("rename needs `name`");
              return `renamed ${need()} to ${ops.renameScreen(p, need(), name)}`;
            }
            case "apply_layout_to_all":
              ops.applyLayoutToAll(p, need());
              return `applied the layout of ${need()} to every screen`;
          }
        });
        const cache = folder.cache();
        const lines = [result, "screens:"];
        for (const [n, s] of project.screens.entries()) {
          lines.push(screenSummary(project, s, await inspectScreen(project, { screen: s.id }, cache).catch(() => null), n + 1));
        }
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_set_background",
    {
      title: "Set screens' backgrounds",
      description: 'Sets a solid colour or a linear gradient background on one screen, several, or every screen ("*"). Colours can be #hex or "$name" for a theme colour, which keeps them linked to the theme.',
      inputSchema: {
        screen: z.union([z.string(), z.array(z.string()).min(1)]).describe('A screen id, a list of screen ids, or "*" for every screen'),
        color: color.optional().describe("Solid background colour"),
        gradient: z
          .object({
            angle: z.number().default(180).describe("CSS angle: 180 runs top to bottom, 90 left to right"),
            stops: z.array(z.object({ color, at: z.number().min(0).max(1) })).min(2),
          })
          .optional()
          .describe("Linear gradient instead of a solid colour"),
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ screen, color: c, gradient, project_dir }) => {
      try {
        if (!c === !gradient) throw new Error("pass exactly one of color or gradient");
        const folder = folderFor(project_dir);
        const { project } = await folder.edit((p) => {
          const targets = screen === "*" ? p.screens : (Array.isArray(screen) ? screen : [screen]).map((id) => ops.getScreen(p, id));
          for (const s of targets) {
            s.background = c
              ? { type: "solid", color: c }
              : { type: "linear-gradient", angle: gradient!.angle, stops: gradient!.stops.map((s) => [s.color, s.at] as [string, number]) };
          }
        });
        const first = screen === "*" ? project.screens[0]!.id : Array.isArray(screen) ? screen[0]! : screen;
        return afterEdit(folder, project, `set background on ${screen === "*" ? "every screen" : [screen].flat().join(", ")}`, first, []);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_set_theme",
    {
      title: "Manage theme colours and fonts",
      description: `${THEME} This tool adds, changes, renames and removes theme colours, and sets theme fonts ("$heading", "$body" in text layers' font). Changing a colour restyles every screen that uses it, so it's the way to restyle a whole listing (e.g. change "brand"). Renaming updates every reference; removing one leaves its colour in place as a plain #hex wherever it was used. "brand" can't be removed: templates build their colours from it. Fonts are file paths under fonts/; bundled fonts are copied in. Returns the theme with how often each colour is used.`,
      inputSchema: {
        colors: z.record(z.string(), color).optional().describe('Colours to add or change, by name without $: {"brand": "#2F6FEB", "accent": "#FFB020"}. A value can itself be "$other".'),
        rename_colors: z.record(z.string(), z.string().regex(ops.THEME_COLOR_NAME)).optional().describe('Old name to new name, without $: {"brandSoft": "sky"}'),
        remove_colors: z.array(z.string()).optional().describe('Names to remove, without $: ["onBrandMuted"]'),
        fonts: z.record(z.string(), z.string()).optional().describe('e.g. {"heading": "fonts/DMSerifDisplay-Regular.ttf"}'),
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ colors, rename_colors, remove_colors, fonts, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const { project } = await folder.edit(async (p) => {
          for (const name of Object.keys(colors ?? {})) {
            if (!ops.THEME_COLOR_NAME.test(name)) throw new Error(`"${name}" isn't a valid colour name: use letters, digits, _ or -, starting with a letter, without $`);
          }
          Object.assign(p.theme.colors, colors ?? {});
          for (const [from, to] of Object.entries(rename_colors ?? {})) ops.renameThemeColor(p, from.replace(/^\$/, ""), to);
          for (const name of remove_colors ?? []) {
            const n = name.replace(/^\$/, "");
            if (n === "brand") throw new Error('"brand" can\'t be removed: templates build their colours from it. Change its value instead.');
            if (!(n in p.theme.colors)) throw new Error(`no theme colour "${n}"; they are ${Object.keys(p.theme.colors).join(", ")}`);
            ops.deleteThemeColor(p, n);
          }
          for (const [k, v] of Object.entries(fonts ?? {})) {
            await ensureFont(folder, v);
            p.theme.fonts[k] = v;
          }
        });
        const cache = folder.cache();
        const lines = [`theme colours: ${themeLine(project)}`, `theme fonts: ${Object.entries(project.theme.fonts).map(([k, v]) => `$${k} ${v}`).join(" · ")}`, "screens:"];
        for (const [n, s] of project.screens.entries()) lines.push(screenSummary(project, s, await inspectScreen(project, { screen: s.id }, cache).catch(() => null), n + 1));
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_apply_template",
    {
      title: "Apply a template",
      description:
        'Re-lays out screens with a starter template (headline, editorial, tilt, flip), keeping their captions and screenshots. On every screen (the default), the template also becomes the theme: its fonts and colours replace the theme\'s, so later theme changes restyle everything. With "screens", only those screens change: they get the template\'s fonts and colours as plain values (still linked to $brand), and the theme and other screens stay as they are. Optionally sets the brand colour first. Copies the template\'s fonts into the project.',
      inputSchema: {
        template: z.enum(ops.TEMPLATES.map((t) => t.id) as [string, ...string[]]),
        screens: z.array(z.string()).min(1).optional().describe("Only these screen ids; default every screen"),
        brand: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Brand colour, #RRGGBB"),
        project_dir: projectDir,
      },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ template, screens, brand, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const { project } = await folder.edit(async (p) => {
          for (const id of screens ?? []) ops.getScreen(p, id);
          if (brand) p.theme.colors.brand = brand;
          for (const f of ops.applyTemplate(p, template, screens)) await ensureFont(folder, `fonts/${f}`);
        });
        const cache = folder.cache();
        const lines = [`applied template ${template} to ${screens ? screens.join(", ") : "every screen"}`, "screens:"];
        for (const [n, s] of project.screens.entries()) lines.push(screenSummary(project, s, await inspectScreen(project, { screen: s.id }, cache).catch(() => null), n + 1));
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_import_capture",
    {
      title: "Import a screenshot",
      description:
        "Copies a screenshot file (e.g. from adb screencap or simctl) into captures/<locale>/ and optionally puts it on a device layer, picking a matching frame. Returns its size.",
      inputSchema: {
        source_path: z.string().describe("Absolute path, or relative to the project folder"),
        name: z.string().regex(/^[\w.-]+\.(png|jpe?g|webp)$/i).optional().describe("File name to store it as; default the source name"),
        locale,
        screen: z.string().optional().describe("Put it on this screen's device layer"),
        layer: z.number().int().min(0).optional().describe("Device layer number; default the screen's first device"),
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ source_path, name, locale: loc, screen, layer, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const p = await folder.load();
        const lc = pickLocale(p, loc);
        const src = resolve(folder.dir, source_path);
        if (!(await exists(src))) throw new Error(`no file at ${src}`);
        const file = name ?? basename(src);
        if (!/\.(png|jpe?g|webp)$/i.test(file)) throw new Error("screenshots must be PNG, JPEG or WebP");
        const dest = join(folder.dir, "captures", lc, file);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(src, dest);
        const size = await captureSize(folder, p, file, lc);
        let msg = `imported captures/${lc}/${file} (${size.width}×${size.height})`;
        if (!screen) {
          await folder.flush();
          return ok(msg);
        }
        const { project, result: li } = await folder.edit((q) => {
          const s = ops.getScreen(q, screen);
          const li = layer ?? s.layers.findIndex((l) => l.type === "device");
          if (li < 0) throw new Error(`screen "${screen}" has no device layer; add one with storeshots_add_layer`);
          ops.setCapture(q, screen, li, size, pickTarget(q));
          return li;
        });
        msg += ` and put it on ${screen} [${li}]`;
        return afterEdit(folder, project, msg, screen, [li], lc);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_import_frame",
    {
      title: "Import a real device frame",
      description:
        'Imports an exact device bezel from art already on this machine into the project\'s frames/ folder: the Xcode Simulator\'s bezel for an iPhone or iPad (source "ios", device by name like "iPhone 17 Pro" or by screen size like "1206x2622"; macOS with Xcode only), or an Android Emulator skin from the SDK (source "android", e.g. "pixel_10_pro"). Returns the frame id to use in a device layer. Prefer this over the built-in vector frames when accuracy matters.',
      inputSchema: {
        source: z.enum(["ios", "android"]),
        device: z.string().describe('iOS: a Simulator device name or WxH screen size; Android: an SDK skin name or skin folder'),
        use_on: z.enum(["none", "matching", "all"]).default("none").describe('"matching": switch device layers whose screenshot is this frame\'s exact size to it; "all": every device layer'),
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ source, device, use_on, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        await folder.load();
        const r = source === "ios" ? await importIosFrame(device, folder.dir) : await importAndroidSkin(device, folder.dir);
        const lines = [`imported ${r.frame.name} as frame "${r.id}" (${r.frame.display.join("×")} screen). ${r.notice}`];
        if (use_on !== "none") {
          const cache = folder.cache();
          const { project, result } = await folder.edit(async (p) => {
            const changed: string[] = [];
            for (const s of p.screens) {
              for (const [i, l] of s.layers.entries()) {
                if (l.type !== "device") continue;
                if (use_on === "matching") {
                  const found = l.capture ? await cache.capture(p, l.capture, p.locales.default) : null;
                  if (!found || found.image.width !== r.frame.display[0] || found.image.height !== r.frame.display[1]) continue;
                }
                l.frame = r.id;
                l.variant = undefined;
                changed.push(`${s.id} [${i}]`);
              }
            }
            return changed;
          });
          lines.push(result.length ? `now used on ${result.join(", ")}` : "no device layers matched");
          const i = await inspectScreen(project, { screen: project.screens[0]!.id }, folder.cache());
          lines.push(inspectionText(i));
        } else {
          // The frame's files were written outside an edit; publish them.
          await folder.flush();
        }
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_render",
    {
      title: "Render store-ready images",
      description:
        "Renders PNG or JPEG files at full store size into the project's store/ folder (or fastlane's folder layout), blocking images a store would reject. Set preview to also get small images back; leave it off to save tokens, since storeshots_inspect_screen already describes the layout.",
      inputSchema: {
        screens: z.array(z.string()).optional().describe("Only these screens; default all"),
        locales: z.array(z.string()).optional().describe("Only these locales; default all"),
        targets: z.array(z.string()).optional().describe("Only these targets; default all"),
        layout: z.enum(["plain", "fastlane"]).default("plain"),
        preview: z.boolean().default(false).describe("Return a small preview image of each rendered screen (costs tokens)"),
        preview_width: z.number().int().min(120).max(720).default(270).describe("Preview width in px"),
        project_dir: projectDir,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ screens, locales, targets, layout, preview, preview_width, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const p = await folder.load();
        for (const s of screens ?? []) ops.getScreen(p, s);
        for (const l of locales ?? []) pickLocale(p, l);
        for (const t of targets ?? []) pickTarget(p, t);
        const host = folder.cache().host;
        const files: string[] = [];
        const summary = await exportProject(p, host, {
          screens,
          locales,
          targets,
          onImage: async (img) => {
            const file = join(folder.outputDir(p), outputPath(p, img, layout));
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, img.bytes);
            files.push(`${folder.isLive ? file : file.slice(folder.dir.length + 1)} ${img.width}×${img.height}`);
          },
        });
        const text = [
          `rendered ${summary.images} image${summary.images === 1 ? "" : "s"}${summary.errors.length ? `, blocked ${summary.errors.length}` : ""}`,
          ...files,
          ...summary.errors.map((e) => `✗ ${e.rule}: ${e.message}`),
          ...summary.warnings.map((w) => `! ${w.where}: ${w.message}`),
        ].join("\n");
        const content: CallToolResult["content"] = [{ type: "text", text }];
        if (preview) {
          const cache = folder.cache();
          const loc = locales?.[0] ?? p.locales.default;
          const t = pickTarget(p, targets?.[0]);
          for (const s of screens ?? p.screens.map((x) => x.id)) {
            const { canvas } = await renderScreen(p, { screen: s, target: t.id, locale: loc, scale: preview_width / t.size[0] }, cache);
            const out = createCanvas(canvas.width, canvas.height);
            out.getContext("2d").drawImage(canvas as never, 0, 0);
            content.push({ type: "image", data: (await out.encode("jpeg", 80)).toString("base64"), mimeType: "image/jpeg" });
          }
        }
        return { content };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_render_device",
    {
      title: "Render one framed screenshot",
      description:
        "Saves one device layer on its own as a transparent PNG: the phone with its screenshot, upright, with the screen at the screenshot's own resolution. For websites, docs or social posts, not for the store listing (use storeshots_render for that). Written to framed/ in the project's output folder.",
      inputSchema: {
        screen: screenId,
        layer: layerIndex.describe("The device layer's number, 0 = bottom"),
        shadow: z.boolean().optional().describe("Draw the drop shadow; default: the layer's own setting"),
        file: z.string().regex(/^[\w.-]+\.png$/).optional().describe('File name, e.g. "home-framed.png"; default from the screenshot\'s name'),
        locale,
        target,
        project_dir: projectDir,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ screen, layer, shadow, file, locale: loc, target: tgt, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const p = await folder.load();
        const l = ops.getLayer(p, screen, layer);
        const lang = pickLocale(p, loc);
        const { canvas } = await renderDevice(p, { screen, layer, target: pickTarget(p, tgt).id, locale: lang, shadow }, folder.cache());
        const out = createCanvas(canvas.width, canvas.height);
        out.getContext("2d").drawImage(canvas as never, 0, 0);
        const base = l.type === "device" && l.capture ? l.capture.replace(/\.[a-z]+$/i, "") : `${screen}-device`;
        const name = file ?? `${base}-framed${lang === p.locales.default ? "" : `-${lang}`}.png`;
        const path = join(folder.outputDir(p), "framed", name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, await out.encode("png"));
        return ok(`saved ${folder.isLive ? path : path.slice(folder.dir.length + 1)} ${canvas.width}×${canvas.height}, transparent background`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

