#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseProject, type Project } from "@storeshots/schema";
import { exportProject, outputPath } from "@storeshots/core";
import { CATALOG } from "@storeshots/frames";
import { importAndroidSkin, importIosFrame, listIosDevices, nodeHost, readProjectFile } from "@storeshots/node";

const USAGE = `storeshots <command> [options]

Commands:
  render [dir]                 Render every screen, target and locale to <dir>/store/
      --locale en,de           Only these locales
      --target play-phone      Only these targets
      --out <dir>              Output folder (default <dir>/store)
      --fastlane               Use fastlane supply/deliver folder layout
  validate [dir]               Check the project and store rules without writing files
  frames list                  List the built-in device frames
  frames import <skin> [dir]   Import an Android Emulator skin (SDK name or folder) into <dir>/frames/
  frames import ios:<device> [dir]
                               Import the Simulator's bezel for an iPhone or iPad, by name
                               ("ios:iPhone 17 Pro") or screen size ("ios:1206x2622"); needs Xcode

Exit codes: 0 ok, 1 invalid project or store rule violation, 2 usage error.`;

function list(v: string | undefined): string[] | undefined {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
}

async function load(dir: string): Promise<Project> {
  const r = parseProject(await readProjectFile(dir));
  if (!r.ok) {
    console.error(`${join(dir, "storeshots.json")} is invalid:`);
    for (const i of r.issues) console.error(`  ${i.path || "(root)"}: ${i.message}`);
    process.exit(1);
  }
  for (const i of r.issues) console.warn(`warning: ${i.path}: ${i.message}`);
  return r.project;
}

async function render(dir: string, flags: Record<string, string | boolean | undefined>, write: boolean) {
  const project = await load(dir);
  const out = resolve(typeof flags.out === "string" ? flags.out : join(dir, "store"));
  const layout = flags.fastlane ? "fastlane" : "plain";
  const started = performance.now();
  const summary = await exportProject(project, nodeHost(dir), {
    locales: list(flags.locale as string | undefined),
    targets: list(flags.target as string | undefined),
    onImage: async (img) => {
      if (!write) return;
      const file = join(out, outputPath(project, img, layout));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, img.bytes);
      console.log(`${file.replace(process.cwd() + "/", "")}  ${img.width}×${img.height}`);
    },
  });
  for (const w of summary.warnings) console.warn(`warning: ${w.where}: ${w.message}`);
  for (const e of summary.errors) console.error(`error: [${e.rule}] ${e.message}`);
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  const verb = write ? "rendered" : "checked";
  console.log(`${summary.images} images ${verb} in ${secs}s, ${summary.errors.length} errors, ${summary.warnings.length} warnings`);
  if (summary.errors.length > 0) process.exit(1);
}

/** "ios:iPhone 17 Pro" or "ios:1206x2622" imports a Simulator bezel; anything else is an Android skin. */
async function importFrame(spec: string, dir: string) {
  const r = spec.startsWith("ios:") ? await importIosFrame(spec.slice(4), dir) : await importAndroidSkin(spec, dir);
  console.log(`imported ${r.frame.name} to ${r.dir} (${r.frame.display.join("×")} display). Use "frame": "${r.id}" in a device layer.`);
  console.log(r.notice);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      locale: { type: "string" },
      target: { type: "string" },
      out: { type: "string" },
      fastlane: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd) {
    console.log(USAGE);
    return;
  }
  switch (cmd) {
    case "render":
      return render(rest[0] ?? ".", values, true);
    case "validate":
      return render(rest[0] ?? ".", values, false);
    case "frames":
      if (rest[0] === "list") {
        for (const f of CATALOG) console.log(`${f.id.padEnd(18)} ${f.name.padEnd(18)} ${f.display.join("×").padEnd(10)} ${Object.keys(f.variants).join(", ")}`);
        const sims = (await listIosDevices()).filter((d) => d.mask);
        if (sims.length) {
          console.log("\nImportable from Xcode's Simulator (storeshots frames import ios:<name or WxH>):");
          for (const d of sims) console.log(`  ${d.name.padEnd(28)} ${d.screen.join("×")}`);
        }
        return;
      }
      if (rest[0] === "import" && rest[1]) return importFrame(rest[1], rest[2] ?? ".");
      break;
  }
  console.error(USAGE);
  process.exit(2);
}

main().catch((e: Error) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
