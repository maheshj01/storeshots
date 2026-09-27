import type { Layer, Project } from "@storeshots/schema";
import { CATALOG } from "@storeshots/frames";
import { layerText } from "../state/actions.ts";

export const TYPE_LABEL = { text: "Text", device: "Device", image: "Image", shape: "Shape" } as const;

/** A short human name for a layer: its words, its phone and screenshot, its file or its shape. */
export function layerName(doc: Project, l: Layer, locale: string): string {
  if (l.type === "text") return layerText(doc, l, locale).replace(/\n/g, " ") || "Empty text";
  if (l.type === "device") {
    const id = typeof l.frame === "string" ? l.frame : (l.frame.android ?? l.frame.ios ?? "");
    const name = CATALOG.find((f) => f.id === id)?.name ?? id;
    return l.capture ? `${name} · ${l.capture}` : `${name} · no screenshot`;
  }
  if (l.type === "image") return l.src.split("/").pop() ?? "Image";
  return l.shape === "ellipse" ? "Ellipse" : "Rectangle";
}
