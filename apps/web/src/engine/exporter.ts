import type { ExportSummary } from "@storeshots/core";

export interface ExportJob {
  doc: unknown;
  assets: Array<[string, Blob]>;
  locales?: string[] | undefined;
  targets?: string[] | undefined;
  screens?: string[] | undefined;
  format: "target" | "png" | "jpeg";
  layout: "plain" | "fastlane";
}

export type ExportMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; summary: ExportSummary; zip: Uint8Array | null }
  | { type: "error"; message: string };

/**
 * Runs an export in a worker at full resolution, so the editor never stalls.
 * Resolves with the zip (null if every image was blocked) and the summary.
 */
export function runExport(
  job: ExportJob,
  onProgress: (done: number, total: number) => void,
): Promise<{ summary: ExportSummary; zip: Uint8Array | null }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ExportMessage>) => {
      const m = e.data;
      if (m.type === "progress") return onProgress(m.done, m.total);
      worker.terminate();
      if (m.type === "done") resolve({ summary: m.summary, zip: m.zip });
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "export worker failed"));
    };
    worker.postMessage(job);
  });
}
