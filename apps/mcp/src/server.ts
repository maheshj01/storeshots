import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createCanvas } from "@napi-rs/canvas";
import type { Layer, Project, Screen } from "@storeshots/schema";
import { CATALOG, findFrame } from "@storeshots/frames";
import { checkImage, checkSet } from "@storeshots/stores";
import { exportProject, inspectScreen, outputPath, renderScreen, type ScreenInspection } from "@storeshots/core";
import * as ops from "@storeshots/ops";
import { BUNDLED_FONTS_DIR } from "@storeshots/ops/fonts-dir";
import { ProjectFolder, pickLocale, pickTarget } from "./project.ts";
import { counts, findingLine, inspectionText } from "./format.ts";

export const SERVER_NAME = "storeshots-mcp-server";

const UNITS =
  "Positions and sizes are output pixels of the target (default: the first target), x,y is the top-left corner. Layers are numbered from the bottom, starting at 0.";

// Shared parameter schemas -------------------------------------------------

const projectDir = z
  .string()
  .optional()
  .describe("Folder containing storeshots.json. Defaults to the folder the server was started with.");
const screenId = z.string().describe('Screen id, e.g. "home". storeshots_get_project lists them.');
const layerIndex = z.number().int().min(0).describe("Layer number on the screen, 0 = bottom.");
const locale = z.string().optional().describe("Locale for text, e.g. \"de\". Defaults to the project's default locale.");
const target = z.string().optional().describe('Target id, e.g. "play-phone". Defaults to the first target.');
const color = z.string().describe("#RGB, #RRGGBB, #RRGGBBAA, or a theme colour like $brand");

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
  color: color.optional().describe("Text and shape layers: colour, #hex or $themeColor"),
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

async function inspect(folder: ProjectFolder, p: Project, screen: string, loc?: string, tgt?: string): Promise<ScreenInspection> {
  return inspectScreen(p, { screen, locale: pickLocale(p, loc), target: pickTarget(p, tgt).id }, folder.cache());
}

/** After an edit: the touched layers, then every finding on the screen. */
async function afterEdit(folder: ProjectFolder, p: Project, done: string, screen: string, layers?: number[], loc?: string, tgt?: string) {
  const i = await inspect(folder, p, screen, loc, tgt);
  return ok(`${done}\n${inspectionText(i, { layers })}`);
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

export function createServer(defaultDir: string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: "0.1.0" },
    {
      instructions: `Edits App Store and Google Play screenshot designs stored as storeshots.json. Start with storeshots_get_project, read a screen with storeshots_inspect_screen, and change it with the edit tools: each edit returns the updated layout and any problems, so you rarely need to render. ${UNITS} Run storeshots_check before exporting with storeshots_render. Every edit is saved to storeshots.json immediately; use git to review or revert.`,
    },
  );
  const folders = new Map<string, ProjectFolder>();
  const folderFor = (dir?: string) => {
    const key = resolve(dir ?? defaultDir);
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
      description: `Summarises a storeshots project: targets and sizes, locales, theme colours and fonts, available frames, templates and screenshots, and each screen's layers with a count of problems. Start here. ${UNITS}`,
      inputSchema: { project_dir: projectDir },
      annotations: read,
    },
    async ({ project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const p = await folder.load();
        const cache = folder.cache();
        const lines = [`project ${JSON.stringify(p.name)} · ${folder.file}`];
        lines.push(`targets: ${p.targets.map((t, i) => `${t.id} ${t.size.join("×")} (${t.store}${t.device ? ` ${t.device}` : ""}, ${t.format})${i === 0 ? " [default]" : ""}`).join(" · ")}`);
        lines.push(`locales: ${p.locales.list.map((l) => (l === p.locales.default ? `${l} (default)` : l)).join(", ")}`);
        lines.push(`theme colours: ${Object.entries(p.theme.colors).map(([k, v]) => `$${k} ${v}`).join(" · ") || "none"}`);
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
      title: "Update a layer",
      description: `Changes one layer: position and size, rotation, opacity, and type-specific properties (text, font, font size, colour, alignment for text; frame, finish, screenshot for devices; shape, colour, radius for shapes). Only the fields you pass change. Returns the updated layer and the screen's problems. ${UNITS}`,
      inputSchema: { screen: screenId, layer: layerIndex, set: LayerPatch.describe("Fields to change"), locale, target, project_dir: projectDir },
      annotations: write,
    },
    async ({ screen, layer, set, locale: loc, target: tgt, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const { project } = await folder.edit(async (p) => applyPatch(folder, p, screen, layer, set, tgt, pickLocale(p, loc)));
        return afterEdit(folder, project, `updated ${screen} [${layer}]: ${Object.keys(set).join(", ")}`, screen, [layer], loc, tgt);
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
        'action "remove" deletes the layer; "duplicate" copies it just above itself (text gets its own caption); "move_to" puts it at stacking position `to` (0 = bottom). Layer numbers above the change shift, so the result lists the screen again.',
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
        'action "add" inserts a screen after `screen` (default: last) copying its layout with placeholder captions and no screenshot; "duplicate" copies `screen` with its own captions; "remove" deletes it; "move_to" puts it at position `to` (0 = first in the listing); "apply_layout_to_all" copies its background and layer positions onto every other screen, keeping their text and screenshots.',
      inputSchema: {
        action: z.enum(["add", "duplicate", "remove", "move_to", "apply_layout_to_all"]),
        screen: z.string().optional().describe("The screen to act on (for add: the one to insert after)"),
        to: z.number().int().min(0).optional().describe("For move_to"),
        new_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).optional().describe("For add: id of the new screen"),
        project_dir: projectDir,
      },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ action, screen, to, new_id, project_dir }) => {
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
      title: "Set a screen's background",
      description: "Sets a solid colour or a linear gradient background on one screen, or on every screen with screen \"*\". Colours can be #hex or $themeColor.",
      inputSchema: {
        screen: z.string().describe('Screen id, or "*" for every screen'),
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
          const targets = screen === "*" ? p.screens : [ops.getScreen(p, screen)];
          for (const s of targets) {
            s.background = c
              ? { type: "solid", color: c }
              : { type: "linear-gradient", angle: gradient!.angle, stops: gradient!.stops.map((s) => [s.color, s.at] as [string, number]) };
          }
        });
        const first = screen === "*" ? project.screens[0]!.id : screen;
        return afterEdit(folder, project, `set background on ${screen === "*" ? "every screen" : screen}`, first, []);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "storeshots_set_theme",
    {
      title: "Set theme colours and fonts",
      description:
        "Adds or changes theme colours and fonts. Layers that use $name pick up the change on every screen, so this is the way to restyle a whole listing (e.g. change $brand). Fonts are file paths under fonts/; bundled fonts are copied in.",
      inputSchema: {
        colors: z.record(z.string(), z.string()).optional().describe('e.g. {"brand": "#2F6FEB"}'),
        fonts: z.record(z.string(), z.string()).optional().describe('e.g. {"heading": "fonts/DMSerifDisplay-Regular.ttf"}'),
        project_dir: projectDir,
      },
      annotations: write,
    },
    async ({ colors, fonts, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const { project } = await folder.edit(async (p) => {
          Object.assign(p.theme.colors, colors ?? {});
          for (const [k, v] of Object.entries(fonts ?? {})) {
            await ensureFont(folder, v);
            p.theme.fonts[k] = v;
          }
        });
        const cache = folder.cache();
        const lines = [`theme colours: ${Object.entries(project.theme.colors).map(([k, v]) => `$${k} ${v}`).join(" · ")}`, `theme fonts: ${Object.entries(project.theme.fonts).map(([k, v]) => `$${k} ${v}`).join(" · ")}`, "screens:"];
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
        "Re-lays out screens with a starter template (headline, editorial, tilt, flip), keeping every screen's captions and screenshots. Optionally sets the brand colour first. Copies the template's fonts into the project.",
      inputSchema: {
        template: z.enum(ops.TEMPLATES.map((t) => t.id) as [string, ...string[]]),
        brand: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Brand colour, #RRGGBB"),
        project_dir: projectDir,
      },
      annotations: { ...write, destructiveHint: true },
    },
    async ({ template, brand, project_dir }) => {
      try {
        const folder = folderFor(project_dir);
        const { project } = await folder.edit(async (p) => {
          if (brand) p.theme.colors.brand = brand;
          for (const f of ops.applyTemplate(p, template)) await ensureFont(folder, `fonts/${f}`);
        });
        const cache = folder.cache();
        const lines = [`applied template ${template}`, "screens:"];
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
        if (!screen) return ok(msg);
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
            const file = join(folder.dir, "store", outputPath(p, img, layout));
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, img.bytes);
            files.push(`${file.slice(folder.dir.length + 1)} ${img.width}×${img.height}`);
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

  return server;
}

