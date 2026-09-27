import type { Project } from "@storeshots/schema";
import { useEditor } from "./store.ts";

/**
 * Applies a whole project that changed outside the editor (in the linked
 * folder, or from an AI agent over the live link) as one undoable step,
 * keeping the selection on something that still exists.
 */
export function applyExternalProject(next: Project, label: string) {
  const { edit, select, selection } = useEditor.getState();
  edit(label, (d) => {
    for (const key of Object.keys(next) as Array<keyof Project>) (d as Record<string, unknown>)[key] = next[key];
  });
  const doc = useEditor.getState().doc!;
  const screen = doc.screens.find((s) => s.id === selection.screen) ?? doc.screens[0];
  const layer = screen && selection.layer !== null && selection.layer < screen.layers.length ? selection.layer : null;
  select({ screen: screen?.id ?? null, layer });
}
