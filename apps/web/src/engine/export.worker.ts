/// <reference lib="webworker" />
import { zipSync, type Zippable } from "fflate";
import { parseProject } from "@storeshots/schema";
import { exportProject, outputPath, type ExportSummary } from "@storeshots/core";
import { assetHost } from "./host.ts";
import type { ExportJob, ExportMessage } from "./exporter.ts";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<ExportJob>) => {
  const job = e.data;
  const post = (m: ExportMessage, transfer: Transferable[] = []) => self.postMessage(m, transfer);
  try {
    const parsed = parseProject(job.doc);
    if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    const project = parsed.project;
    if (job.format !== "target") for (const t of project.targets) t.format = job.format;
    const files: Zippable = {};
    const summary: ExportSummary = await exportProject(project, assetHost(new Map(job.assets)), {
      locales: job.locales,
      targets: job.targets,
      screens: job.screens,
      onProgress: (done, total) => post({ type: "progress", done, total }),
      onImage: (img) => {
        // PNG and JPEG are already compressed; store them as-is.
        files[outputPath(project, img, job.layout)] = [img.bytes, { level: 0 }];
      },
    });
    const zip = summary.images > 0 ? zipSync(files) : null;
    post({ type: "done", summary, zip }, zip ? [zip.buffer] : []);
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};
