import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, GripVertical, Plus, Trash2, CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import type { Screen, Target } from "@storeshots/schema";
import { checkImage, checkSet, PLAY, APPSTORE } from "@storeshots/stores";
import { useEditor, useTarget } from "../state/store.ts";
import { addScreen, deleteScreen, duplicateScreen, fillWithCaptures, moveScreen, setCapture, storeCaptures } from "../state/actions.ts";
import { useScreenPreview } from "../engine/preview.ts";
import { Overlay } from "./Overlay.tsx";

/** Display height of a sheet at 100% zoom, in CSS px. */
const BASE_HEIGHT = 560;

export function deviceLabel(t: Target): string {
  const cls =
    t.store === "play" ? PLAY.classes.find((c) => c.id === (t.device ?? "phone")) : APPSTORE.classes.find((c) => c.id === t.device);
  return `${t.store === "play" ? "Play" : "App Store"} ${cls?.label.toLowerCase() ?? t.device ?? ""}`.trim();
}

function typing(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/**
 * Hold Space and drag to pan the table, like design tools. Space is only
 * taken while the pointer is over the table, so it still presses focused
 * buttons elsewhere and types normally in fields.
 */
function useSpacePan(scroller: React.RefObject<HTMLDivElement | null>) {
  const [ready, setReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const hovering = useRef(false);
  const held = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target) || !(hovering.current || held.current)) return;
      e.preventDefault(); // no page scroll, no button press
      if (!held.current) {
        held.current = true;
        setReady(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held.current) return;
      e.preventDefault();
      held.current = false;
      setReady(false);
    };
    const reset = () => {
      held.current = false;
      setReady(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);

  const onPointerDownCapture = (e: React.PointerEvent) => {
    const el = scroller.current;
    if (!held.current || e.button !== 0 || !el) return;
    // Capture phase: the overlay never sees this press, so nothing is selected or moved.
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x);
      el.scrollTop = start.top - (ev.clientY - start.y);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return {
    className: panning ? " panning" : ready ? " pan-ready" : "",
    handlers: {
      onPointerDownCapture,
      onPointerEnter: () => void (hovering.current = true),
      onPointerLeave: () => void (hovering.current = false),
    },
  };
}

/** The things zoom anchors to: each sheet's canvas, then the add-screen tile. */
function targets(scroller: HTMLElement): HTMLElement[] {
  const strip = scroller.querySelector(".strip");
  return [...(strip?.children ?? [])].map((c) => (c.querySelector(".stage") as HTMLElement | null) ?? (c as HTMLElement));
}

function imageFiles(e: React.DragEvent): File[] {
  return [...e.dataTransfer.files].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
}

export function Table() {
  const doc = useEditor((s) => s.doc!);
  const zoom = useEditor((s) => s.zoom);
  const target = useTarget()!;
  const [dropping, setDropping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pan = useSpacePan(scroller);

  const h = Math.round(BASE_HEIGHT * zoom);
  const w = Math.round((h * target.size[0]) / target.size[1]);

  const setIssues = useMemo(
    () => checkSet({ store: target.store, device: target.device, images: doc.screens.map(() => ({ width: target.size[0], height: target.size[1] })) }),
    [doc.screens.length, target],
  );
  const setError = setIssues.find((v) => v.severity === "error");
  const setWarning = setIssues.find((v) => v.severity === "warning");

  const projectId = useEditor((s) => s.projectId);

  /**
   * Zooming keeps one point fixed on screen: the point under the cursor for
   * scroll and pinch zoom, the middle of the view for the slider and Fit.
   * The point is recorded relative to the sheet under it, because gaps and
   * padding between sheets don't scale with zoom; after the new layout, the
   * table scrolls so the same spot on that sheet is back under the point.
   */
  const anchor = useRef<{ index: number; fx: number; fy: number; x: number; y: number } | null>(null);
  const zoomAt = (next: number, x?: number, y?: number) => {
    const el = scroller.current;
    if (!el) return;
    const view = el.getBoundingClientRect();
    const px = x ?? view.left + view.width / 2;
    const py = y ?? view.top + view.height / 2;
    const items = targets(el);
    let index = -1;
    let best = Infinity;
    items.forEach((it, i) => {
      const r = it.getBoundingClientRect();
      const d = px < r.left ? r.left - px : px > r.right ? px - r.right : 0;
      if (d < best) [best, index] = [d, i];
    });
    if (index >= 0) {
      const r = items[index]!.getBoundingClientRect();
      anchor.current = { index, fx: (px - r.left) / r.width, fy: (py - r.top) / r.height, x: px, y: py };
    }
    useEditor.getState().setZoom(next);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    anchor.current = null;
    if (!a || !el) return;
    const r = targets(el)[a.index]?.getBoundingClientRect();
    if (!r) return;
    el.scrollLeft += r.left + a.fx * r.width - a.x;
    el.scrollTop += r.top + a.fy * r.height - a.y;
  }, [zoom]);

  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    // Room for the strip's padding, the slug and the screen tools.
    zoomAt((el.clientHeight - 56 - 110) / BASE_HEIGHT);
  };
  useLayoutEffect(fit, [projectId]);

  // The wheel listener is attached once; it calls the latest zoomAt.
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms the table, like design tools.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Trackpad pinches send many small deltas; mouse wheels send notches of
      // about 100 (or lines). Scale smoothly for the first, 15% per notch for the second.
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
      const factor = notch ? Math.pow(1.15, -Math.sign(e.deltaY)) : Math.exp(-e.deltaY * 0.01);
      zoomAtRef.current(useEditor.getState().zoom * factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={scroller}
      className={`table${dropping ? " dropping" : ""}${pan.className}`}
      {...pan.handlers}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("strip")) {
          useEditor.getState().select({ layer: null });
        }
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={async (e) => {
        setDropping(false);
        const files = imageFiles(e);
        if (!files.length) return;
        e.preventDefault();
        await fillWithCaptures(files);
      }}
    >
      <div className="strip">
        {doc.screens.map((screen, i) => (
          <Sheet key={screen.id} screen={screen} index={i} count={doc.screens.length} width={w} height={h} target={target} />
        ))}
        <button type="button" className="add-sheet" style={{ width: w, height: h }} onClick={() => addScreen()}>
          <span>
            <Plus aria-hidden />
            <br />
            Add screen
            <br />
            <small>or drop screenshots anywhere</small>
          </span>
        </button>
      </div>
      <div className="table-foot">
        <span className="listing-status" title={setError?.message ?? setWarning?.message ?? "Ready for the store"}>
          {setError ? (
            <CircleAlert color="var(--bad)" aria-hidden />
          ) : setWarning ? (
            <TriangleAlert color="var(--warn)" aria-hidden />
          ) : (
            <CircleCheck color="var(--ok)" aria-hidden />
          )}
          {doc.screens.length} {doc.screens.length === 1 ? "screen" : "screens"} ·{" "}
          {setError
            ? setError.message
            : setWarning
              ? "below Play promotion rules (4 or more at 1080 px)"
              : target.store === "play"
                ? "eligible for Play promotion"
                : "valid for the App Store"}
        </span>
        <span className="grow" />
        <button type="button" className="btn ghost" style={{ height: 24 }} onClick={fit} title="Fit screens to the window height">
          Fit
        </button>
        <label className="row" title="Zoom (Ctrl or ⌘ + scroll). Hold Space and drag to pan.">
          <span>{Math.round(zoom * 100)}%</span>
          <input type="range" min={0.25} max={2} step={0.05} value={zoom} onChange={(e) => zoomAt(+e.target.value)} aria-label="Zoom" />
        </label>
      </div>
    </div>
  );
}

function Sheet({ screen, index, count, width, height, target }: { screen: Screen; index: number; count: number; width: number; height: number; target: Target }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const selected = useEditor((s) => s.selection.screen === screen.id);
  const preview = useScreenPreview(canvas, screen.id, width);
  const [over, setOver] = useState(false);
  const issues = useMemo(
    () => checkImage({ store: target.store, device: target.device, width: target.size[0], height: target.size[1], format: target.format, hasAlpha: false }),
    [target],
  );
  const bad = issues.find((i) => i.severity === "error");
  const warn = preview.error ?? preview.warnings[0]?.message;

  return (
    <div
      className={`sheet${selected ? " selected" : ""}${over ? " drag-over" : ""}`}
      style={{ width }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("application/x-storeshots-screen")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("application/x-storeshots-screen");
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          moveScreen(id, index);
        }
      }}
    >
      <div
        className="stage"
        style={{ width, height }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files") || [...e.dataTransfer.types].includes("application/x-storeshots-capture")) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={async (e) => {
          const capture = e.dataTransfer.getData("application/x-storeshots-capture");
          const files = imageFiles(e);
          if (!capture && !files.length) return;
          e.preventDefault();
          e.stopPropagation();
          useEditor.getState().select({ screen: screen.id });
          if (files.length > 1) return void (await fillWithCaptures(files, screen.id));
          // One image lands on the device under the pointer, or the first device.
          const devices = screen.layers.map((l, i) => [l, i] as const).filter(([l]) => l.type === "device");
          if (!devices.length) return void (await fillWithCaptures(files, screen.id));
          const b = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - b.left) / b.width;
          const py = (e.clientY - b.top) / b.height;
          const under = [...devices].reverse().find(([l]) => px >= l.box.x && px <= l.box.x + l.box.w && py >= l.box.y && py <= l.box.y + l.box.h);
          const [, li] = under ?? devices[0]!;
          if (capture) {
            const [name, w, h] = capture.split("|");
            setCapture(screen.id, li, { name: name!, width: +w!, height: +h! });
          } else {
            const [stored] = await storeCaptures(files);
            if (stored) setCapture(screen.id, li, stored);
          }
          useEditor.getState().select({ layer: li });
        }}
      >
        <canvas ref={canvas} className="preview" style={{ width, height }} aria-label={`Screen ${index + 1} preview`} />
        <Overlay screen={screen} width={width} height={height} target={target.size} active={selected} />
        <div className="crop" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="slug">
        <span
          className="grip"
          draggable
          title="Drag to reorder"
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-storeshots-screen", screen.id);
            e.dataTransfer.effectAllowed = "move";
          }}
        >
          <GripVertical size={13} aria-hidden />
        </span>
        <span className="n">{String(index + 1).padStart(2, "0")}</span>
        <span className="id">{screen.id}</span>
        <span className="grow" />
        <span>
          {target.size[0]} × {target.size[1]}
        </span>
        {bad ? (
          <span className="bad" title={bad.message}>
            ✕
          </span>
        ) : warn ? (
          <span className="warn" title={warn}>
            !
          </span>
        ) : (
          <span className="ok" title={`Accepted as ${deviceLabel(target)}`}>
            ✓
          </span>
        )}
      </div>
      <div className="sheet-tools">
        <button type="button" className="btn ghost icon" title="Move left" disabled={index === 0} onClick={() => moveScreen(screen.id, index - 1)}>
          <ArrowLeft aria-hidden />
        </button>
        <button type="button" className="btn ghost icon" title="Move right" disabled={index === count - 1} onClick={() => moveScreen(screen.id, index + 1)}>
          <ArrowRight aria-hidden />
        </button>
        <button type="button" className="btn ghost icon" title="Duplicate screen" onClick={() => duplicateScreen(screen.id)}>
          <Copy aria-hidden />
        </button>
        <button type="button" className="btn ghost icon danger" title="Delete screen" disabled={count <= 1} onClick={() => deleteScreen(screen.id)}>
          <Trash2 aria-hidden />
        </button>
      </div>
    </div>
  );
}
