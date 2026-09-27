import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, stat, writeFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { skinToFrame, type BitmapFrame } from "@storeshots/frames";

/**
 * Importing device frames from art already on the user's machine: Android
 * Emulator skins from the SDK, and the bezels Xcode's Simulator draws.
 * Both are the platform owners' art, so they're imported into a project's
 * frames/ folder for local use and never bundled with storeshots.
 */

const run = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface ImportedFrame {
  id: string;
  frame: BitmapFrame;
  /** Where the frame was written: <project>/frames/<id>. */
  dir: string;
  notice: string;
}

// Android ----------------------------------------------------------------

export function androidSkinDirs(): string[] {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT];
  const home = homedir();
  roots.push(join(home, "Library/Android/sdk"), join(home, "Android/Sdk"), join(home, "AppData/Local/Android/Sdk"));
  return roots.filter((r): r is string => !!r).map((r) => join(r, "skins"));
}

/** Copies an Android Emulator skin (an SDK skin name or a folder) into the project. */
export async function importAndroidSkin(spec: string, projectDir: string): Promise<ImportedFrame> {
  let skinDir: string | undefined;
  if (await exists(join(spec, "layout"))) skinDir = spec;
  else for (const d of androidSkinDirs()) if (await exists(join(d, spec, "layout"))) skinDir = join(d, spec);
  if (!skinDir) throw new Error(`Android skin "${spec}" not found (searched ${androidSkinDirs().join(", ")})`);
  const id = basename(resolve(skinDir));
  const frame = skinToFrame(id, await readFile(join(skinDir, "layout"), "utf8"));
  const dest = join(projectDir, "frames", id);
  await mkdir(dest, { recursive: true });
  await copyFile(join(skinDir, frame.background.src), join(dest, frame.background.src));
  if (frame.mask) await copyFile(join(skinDir, frame.mask.src), join(dest, frame.mask.src));
  await writeFile(join(dest, "frame.json"), JSON.stringify(frame, null, 2) + "\n");
  return { id, frame, dir: dest, notice: "Emulator skins are Google's art from your own SDK; keep them out of anything you redistribute." };
}

// iOS Simulator ----------------------------------------------------------

const DEVICE_TYPES = "/Library/Developer/CoreSimulator/Profiles/DeviceTypes";
const DEVICEKIT = "/Library/Developer/DeviceKit";

export interface IosDevice {
  name: string;
  /** Screen size in pixels. */
  screen: [number, number];
  scale: number;
  chrome: string;
  mask: string | undefined;
}

async function plist(path: string): Promise<Record<string, unknown>> {
  const { stdout } = await run("plutil", ["-convert", "json", "-o", "-", path], { maxBuffer: 8 << 20 });
  return JSON.parse(stdout);
}

/** The iPhone and iPad device types Xcode's Simulator knows, newest names first. */
export async function listIosDevices(): Promise<IosDevice[]> {
  if (process.platform !== "darwin" || !(await exists(DEVICE_TYPES))) return [];
  const out: IosDevice[] = [];
  for (const entry of await readdir(DEVICE_TYPES)) {
    if (!entry.endsWith(".simdevicetype") || !/^(iPhone|iPad)/.test(entry)) continue;
    try {
      const p = await plist(join(DEVICE_TYPES, entry, "Contents/Resources/profile.plist"));
      if (typeof p.chromeIdentifier !== "string") continue;
      out.push({
        name: entry.replace(/\.simdevicetype$/, ""),
        screen: [Number(p.mainScreenWidth), Number(p.mainScreenHeight)],
        scale: Number(p.mainScreenScale),
        chrome: p.chromeIdentifier,
        mask: typeof p.framebufferMask === "string" ? p.framebufferMask : undefined,
      });
    } catch {
      // not a readable device profile
    }
  }
  // Newest first; within a generation "Pro" sorts ahead of the base model.
  return out.sort((a, b) => generation(b.name) - generation(a.name) || b.name.localeCompare(a.name, "en", { numeric: true }));
}

/** Rough release order from the name, so the newest devices list first ("X" was the 10th). */
function generation(name: string): number {
  const n = /(?:iPhone|iPad[^\d]*?)\s(\d+)/.exec(name)?.[1];
  if (n) return Number(n);
  if (/iPhone X/.test(name)) return 10;
  if (/iPhone Air/.test(name)) return 17;
  return 0;
}

/** Picks a device by name ("iPhone 17 Pro") or by screen size ("1206x2622"). */
export async function findIosDevice(spec: string): Promise<IosDevice> {
  const devices = await listIosDevices();
  if (!devices.length) throw new Error("no iOS Simulator device types found; importing iPhone frames needs macOS with Xcode installed");
  const size = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(spec.trim());
  const found = size
    ? devices.find((d) => d.screen[0] === +size[1]! && d.screen[1] === +size[2]!)
    : devices.find((d) => d.name.toLowerCase() === spec.trim().toLowerCase());
  if (!found) {
    const phones = devices.filter((d) => d.name.startsWith("iPhone") && d.mask).slice(0, 12);
    throw new Error(
      `no Simulator device ${size ? "with a " + spec + " screen" : `named "${spec}"`}. Recent ones: ${phones.map((d) => `${d.name} (${d.screen.join("x")})`).join(", ")}`,
    );
  }
  return found;
}

// The chrome ships as vector PDFs. A small CoreGraphics program rasterises
// them at the device's pixel scale, alpha included; it's compiled once with
// swiftc (part of Xcode, which the Simulator needs anyway) and cached.
const PDF2PNG_SWIFT = `import CoreGraphics
import ImageIO
import Foundation
import UniformTypeIdentifiers
// pdf2png in.pdf out.png scale [in.pdf out.png scale ...]
let a = Array(CommandLine.arguments.dropFirst())
guard !a.isEmpty, a.count % 3 == 0 else {
    FileHandle.standardError.write("usage: pdf2png in.pdf out.png scale [...]\\n".data(using: .utf8)!); exit(2)
}
for i in stride(from: 0, to: a.count, by: 3) {
    guard let scale = Double(a[i + 2]), let doc = CGPDFDocument(URL(fileURLWithPath: a[i]) as CFURL),
          let page = doc.page(at: 1) else {
        FileHandle.standardError.write("can't read \\(a[i])\\n".data(using: .utf8)!); exit(1)
    }
    let box = page.getBoxRect(.mediaBox)
    let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    ctx.translateBy(x: -box.minX, y: -box.minY)
    ctx.drawPDFPage(page)
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[i + 1]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    if !CGImageDestinationFinalize(dest) { exit(1) }
}
`;

async function pdf2png(): Promise<string> {
  const cache = join(homedir(), "Library/Caches/storeshots");
  const exe = join(cache, "pdf2png");
  const src = join(cache, "pdf2png.swift");
  const current = (await exists(src)) && (await readFile(src, "utf8")) === PDF2PNG_SWIFT;
  if (!current || !(await exists(exe))) {
    await mkdir(cache, { recursive: true });
    await writeFile(src, PDF2PNG_SWIFT);
    try {
      await run("swiftc", ["-O", "-o", exe, src]);
    } catch (e) {
      throw new Error(`couldn't compile the PDF rasteriser with swiftc (install Xcode or its command line tools): ${(e as Error).message}`);
    }
  }
  return exe;
}

/** Rasterises page 1 of each PDF at its scale, in one run of the helper. */
async function renderPdfs(jobs: Array<{ path: string; scale: number }>): Promise<Image[]> {
  const tmp = await mkdtemp(join(tmpdir(), "storeshots-pdf-"));
  try {
    const outs = jobs.map((_, i) => join(tmp, `${i}.png`));
    await run(await pdf2png(), jobs.flatMap((j, i) => [j.path, outs[i]!, String(j.scale)]));
    return await Promise.all(outs.map(async (o) => loadImage(await readFile(o))));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function renderPdf(path: string, scale: number): Promise<Image> {
  return (await renderPdfs([{ path, scale }]))[0]!;
}

type Canvas2D = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

/** Draws `img` stretched to w×h, keeping `cap`-pixel corners unscaled. */
function nineSlice(ctx: Canvas2D, img: Image, x: number, y: number, w: number, h: number, cap: number) {
  if (img.width === w && img.height === h) return ctx.drawImage(img, x, y);
  const sx = [0, cap, img.width - cap, img.width];
  const sy = [0, cap, img.height - cap, img.height];
  const dx = [0, cap, w - cap, w];
  const dy = [0, cap, h - cap, h];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const sw = sx[i + 1]! - sx[i]!;
      const sh = sy[j + 1]! - sy[j]!;
      const tw = dx[i + 1]! - dx[i]!;
      const th = dy[j + 1]! - dy[j]!;
      if (sw > 0 && sh > 0 && tw > 0 && th > 0) ctx.drawImage(img, sx[i]!, sy[j]!, sw, sh, x + dx[i]!, y + dy[j]!, tw, th);
    }
}

interface Chrome {
  identifier: string;
  images: Record<string, string> & {
    sizing: { leftWidth: number; rightWidth: number; topHeight: number; bottomHeight: number };
    padding: { width: number; height: number };
  };
  inputs?: Array<{ type: string; image: string; anchor: string; onTop?: boolean; offsets: { normal: { x: number; y: number } } }>;
}

async function findChrome(identifier: string): Promise<{ dir: string; chrome: Chrome }> {
  const root = join(DEVICEKIT, "Chrome");
  for (const entry of await readdir(root)) {
    const dir = join(root, entry, "Contents/Resources");
    try {
      const chrome = JSON.parse(await readFile(join(dir, "chrome.json"), "utf8")) as Chrome;
      if (chrome.identifier === identifier) return { dir, chrome };
    } catch {
      // not a chrome bundle
    }
  }
  throw new Error(`Xcode has no DeviceKit chrome "${identifier}"`);
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Builds a frame from the bezel the Simulator draws for a device: the
 * bezel PDF (one composite, or nine edge pieces) around the screen, the
 * side buttons at the Simulator's own offsets, and the screen-shape mask
 * turned into an overlay that rounds the corners.
 */
export async function importIosFrame(spec: string, projectDir: string): Promise<ImportedFrame> {
  const device = await findIosDevice(spec);
  if (!device.mask) throw new Error(`${device.name} has a rectangular screen with no mask; pick a device with rounded corners`);
  const { dir, chrome } = await findChrome(device.chrome);
  const s = device.scale;
  const buttons = (chrome.inputs ?? []).filter((b) => b.type === "button" && !b.onTop);
  const im0 = chrome.images;
  const names = [
    ...(im0.composite ? [im0.composite] : [im0.topLeft, im0.top, im0.topRight, im0.left, im0.right, im0.bottomLeft, im0.bottom, im0.bottomRight]),
    ...buttons.map((b) => b.image),
  ].filter((n): n is string => !!n);
  const rendered = await renderPdfs(names.map((n) => ({ path: join(dir, `${n}.pdf`), scale: s })));
  const byName = new Map(names.map((n, i) => [n, rendered[i]!]));
  const img = async (name: string) => {
    const found = byName.get(name);
    if (!found) throw new Error(`chrome image "${name}" missing`);
    return found;
  };
  const [sw, sh] = device.screen;
  const im = chrome.images;

  // The bezel around the screen.
  let border: [number, number, number, number]; // left, top, right, bottom
  let bezel: (ctx: Canvas2D, x: number) => void;
  if (im.composite) {
    const composite = await img(im.composite);
    let b = Math.round((composite.width - sw) / 2);
    if (b <= 0 || composite.height - sh !== 2 * b) b = im.sizing.leftWidth * s;
    border = [b, b, b, b];
    bezel = (ctx, x) => nineSlice(ctx, composite, x, 0, sw + 2 * b, sh + 2 * b, Math.floor(composite.width / 3));
  } else {
    const [tl, t, tr, l, r, bl, b, br] = await Promise.all(
      [im.topLeft, im.top, im.topRight, im.left, im.right, im.bottomLeft, im.bottom, im.bottomRight].map((n) => img(n!)),
    );
    border = [im.sizing.leftWidth * s, im.sizing.topHeight * s, im.sizing.rightWidth * s, im.sizing.bottomHeight * s];
    bezel = (ctx, x) => {
      const W = sw + border[0] + border[2];
      const H = sh + border[1] + border[3];
      ctx.drawImage(t!, x + tl!.width, 0, W - tl!.width - tr!.width, t!.height);
      ctx.drawImage(b!, x + bl!.width, H - b!.height, W - bl!.width - br!.width, b!.height);
      ctx.drawImage(l!, x, tl!.height, l!.width, H - tl!.height - bl!.height);
      ctx.drawImage(r!, x + W - r!.width, tr!.height, r!.width, H - tr!.height - br!.height);
      ctx.drawImage(tl!, x, 0);
      ctx.drawImage(tr!, x + W - tr!.width, 0);
      ctx.drawImage(bl!, x, H - bl!.height);
      ctx.drawImage(br!, x + W - br!.width, H - br!.height);
    };
  }
  const bodyW = sw + border[0] + border[2];
  const bodyH = sh + border[1] + border[3];
  const pad = im.padding.width * s;
  const canvas = createCanvas(bodyW + 2 * pad, bodyH);
  const ctx = canvas.getContext("2d");

  // Side buttons sit beneath the bezel, at the Simulator's own offsets.
  for (const input of buttons) {
    const button = await img(input.image);
    let x = input.offsets.normal.x * s;
    const y = input.offsets.normal.y * s;
    if (input.anchor === "right") x = canvas.width + x - button.width;
    ctx.drawImage(button, x, y);
  }
  bezel(ctx, pad);

  // The screen shape (opaque where the screen shows), used to cut the
  // screenshot. An overlay wouldn't do: the screen's rounded corners reach
  // past the bezel's outer curve, so painting them black would show.
  const maskPdf = join(DEVICEKIT, "FramebufferMasks", `${device.mask}.pdf`);
  let mask = await renderPdf(maskPdf, 1);
  if (mask.width !== sw) mask = await renderPdf(maskPdf, sw / mask.width);
  const mc = createCanvas(sw, sh);
  mc.getContext("2d").drawImage(mask, 0, 0, sw, sh);

  const id = `sim-${slug(device.name)}`;
  const frame: BitmapFrame = {
    kind: "bitmap",
    id,
    name: `${device.name} (Simulator)`,
    platform: "ios",
    size: [canvas.width, canvas.height],
    display: [sw, sh],
    screen: { x: pad + border[0], y: border[1], w: sw, h: sh, radius: 0 },
    background: { src: "back.png", x: 0, y: 0 },
    screenMask: { src: "screen-mask.png" },
  };
  const dest = join(projectDir, "frames", id);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, "back.png"), await canvas.encode("png"));
  await writeFile(join(dest, "screen-mask.png"), await mc.encode("png"));
  await writeFile(join(dest, "frame.json"), JSON.stringify(frame, null, 2) + "\n");
  return {
    id,
    frame,
    dir: dest,
    notice: "This bezel is Apple's art from your own Xcode install; use it for your screenshots and keep it out of anything you redistribute.",
  };
}
