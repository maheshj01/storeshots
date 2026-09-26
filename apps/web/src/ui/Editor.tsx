import { useEffect, useState } from "react";
import { AssetCache, renderScreen } from "@storeshots/core";
import { useEditor } from "../state/store.ts";
import { saveDoc, saveThumbnail } from "../state/persist.ts";
import { deleteLayer, duplicateLayer, updateLayer } from "../state/actions.ts";
import { assetHost } from "../engine/host.ts";
import { TopBar } from "./TopBar.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { Table } from "./Table.tsx";
import { Inspector } from "./Inspector.tsx";

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/** Saves to IndexedDB shortly after each change, and refreshes the thumbnail now and then. */
function useAutosave(): boolean {
  const doc = useEditor((s) => s.doc);
  const id = useEditor((s) => s.projectId);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    if (!doc || !id) return;
    setSaved(false);
    const t = setTimeout(async () => {
      await saveDoc(id, doc, { folder: useEditor.getState().folder ?? undefined });
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [doc, id]);
  useEffect(() => {
    if (!doc || !id) return;
    const t = setTimeout(async () => {
      const { assets } = useEditor.getState();
      const { canvas } = await renderScreen(
        doc,
        { screen: doc.screens[0]!.id, target: doc.targets[0]!.id, locale: doc.locales.default, scale: 0.25, missingCapture: "placeholder" },
        new AssetCache(assetHost(assets)),
      );
      await saveThumbnail(id, await (canvas as unknown as OffscreenCanvas).convertToBlob({ type: "image/png" }));
    }, 2500);
    return () => clearTimeout(t);
  }, [doc, id]);
  return saved;
}

export function Editor() {
  const saved = useAutosave();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useEditor.getState();
      if (mod && e.key.toLowerCase() === "z" && !typing(e)) {
        e.preventDefault();
        return e.shiftKey ? s.redo() : s.undo();
      }
      if (mod && e.key.toLowerCase() === "y" && !typing(e)) {
        e.preventDefault();
        return s.redo();
      }
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        return window.dispatchEvent(new CustomEvent("storeshots:export"));
      }
      if (typing(e)) return;
      if (mod && e.key.toLowerCase() === "d" && s.selection.layer !== null) {
        e.preventDefault();
        return duplicateLayer();
      }
      if ((e.key === "Backspace" || e.key === "Delete") && s.selection.layer !== null) {
        e.preventDefault();
        return deleteLayer();
      }
      if (e.key === "Escape") return s.select({ layer: null });
      if (e.key === "Enter" && s.selection.layer !== null) {
        window.dispatchEvent(new CustomEvent("storeshots:edit-text"));
        return e.preventDefault();
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const a = arrows[e.key];
      if (a && s.selection.layer !== null && s.doc) {
        e.preventDefault();
        const t = s.doc.targets.find((x) => x.id === s.target) ?? s.doc.targets[0]!;
        const k = e.shiftKey ? 10 : 1;
        updateLayer("Nudge layer", (l) => {
          l.box.x += (a[0] * k) / t.size[0];
          l.box.y += (a[1] * k) / t.size[1];
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar onHome={() => useEditor.getState().close()} saved={saved} />
      <div className="workspace">
        <LeftPanel />
        <Table />
        <Inspector />
      </div>
    </div>
  );
}
