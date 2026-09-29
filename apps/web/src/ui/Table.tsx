import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, GalleryHorizontal, GripVertical, LayoutGrid, LayoutTemplate, Plus, Trash2, CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import type { Screen, Target } from "@storeshots/schema";
import { checkImage, checkSet, PLAY, APPSTORE } from "@storeshots/stores";
import { useEditor, useTarget } from "../state/store.ts";
import { addScreen, applyLayoutToAll, deleteScreen, duplicateScreen, fillWithCaptures, moveScreen, setCapture, storeCaptures } from "../state/actions.ts";
import { useScreenPreview } from "../engine/preview.ts";
import { Overlay } from "./Overlay.tsx";
import { toast } from "./toast.ts";

/** Display height of a sheet at 100% zoom, in CSS px. */
const BASE_HEIGHT = 560;

/** Grid spacing, in CSS px (unscaled): kept in step with .strip.grid in styles.css. */
const COL_GAP = 56;
const ROW_GAP = 48;
const MARGIN = 48;
/** The number, size and tools under each screen, which don't scale with zoom. */
const SLUG = 80;

type Layout = "grid" | "row";
const LAYOUT_KEY = "storeshots.table-layout";

function savedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "row" ? "row" : "grid";
  } catch {
    return "grid";
  }
}

/** How many screens of width `w` fit side by side in a view `viewW` wide. */
export function gridColumns(viewW: number, w: number, count: number): number {
  return Math.max(1, Math.min(count, Math.floor((viewW - 2 * MARGIN + COL_GAP) / (w + COL_GAP))));
}

/**
 * The largest zoom at which `count` screens fit the view as a grid, trying
 * every column count. Too many screens to fit at the smallest zoom just
 * scroll.
 */
export function gridFitZoom(viewW: number, viewH: number, aspect: number, count: number): number {
  let best = 0;
  for (let c = 1; c <= Math.max(1, count); c++) {
    const rows = Math.ceil(count / c);
    const zw = (viewW - 2 * MARGIN - (c - 1) * COL_GAP) / (c * BASE_HEIGHT * aspect);
    const zh = (viewH - MARGIN - 40 - (rows - 1) * ROW_GAP - rows * SLUG) / (rows * BASE_HEIGHT);
    best = Math.max(best, Math.min(zw, zh));
  }
  return Math.min(3, Math.max(0.25, best));
}

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

  /**
   * Screens wrap into a grid as wide as the window, so a whole listing can
   * be browsed at a glance; the row keeps them in one line, in store order.
   * The column count is chosen when the grid is fitted to the window, and
   * stays put while zooming, so the grid scales without rearranging.
   */
  const [layout, setLayoutState] = useState<Layout>(savedLayout);
  const [gridCols, setGridCols] = useState(4);
  const cols = layout === "grid" ? gridCols : doc.screens.length + 1;

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
    // A zoom in progress is measured as it looks, then replaced by the real layout.
    const pending = live.current;
    live.current = null;
    if (pending) clearTimeout(pending.timer);
    const view = el.getBoundingClientRect();
    const px = x ?? view.left + view.width / 2;
    const py = y ?? view.top + view.height / 2;
    const items = targets(el);
    let index = -1;
    let best = Infinity;
    items.forEach((it, i) => {
      const r = it.getBoundingClientRect();
      const dx = px < r.left ? r.left - px : px > r.right ? px - r.right : 0;
      const dy = py < r.top ? r.top - py : py > r.bottom ? py - r.bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d < best) [best, index] = [d, i];
    });
    if (index >= 0) {
      const r = items[index]!.getBoundingClientRect();
      anchor.current = { index, fx: (px - r.left) / r.width, fy: (py - r.top) / r.height, x: px, y: py };
    }
    clearLiveTransform();
    useEditor.getState().setZoom(next);
  };

  /**
   * While zooming, only the strip's CSS transform changes: the GPU scales
   * what's already drawn, with no layout and no canvas rendering, so the
   * gesture keeps up with the pointer. 160 ms after the last input the real
   * zoom is applied once and every screen re-renders sharp at its new size.
   */
  const strip = useRef<HTMLDivElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  // Uncontrolled, so React doesn't pull the thumb back to the committed zoom mid-drag.
  const slider = useRef<HTMLInputElement>(null);
  // The label and slider are written directly (React renders them empty or
  // uncontrolled) so live zoom can update them without re-rendering the table.
  useLayoutEffect(() => {
    if (slider.current) slider.current.value = String(zoom);
    if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(zoom * 100)}%`;
  }, [zoom]);
  const live = useRef<{ s: number; tx: number; ty: number; x: number; y: number; timer: number } | null>(null);
  const clearLiveTransform = () => {
    const st = strip.current;
    if (!st) return;
    st.style.transform = "";
    st.style.willChange = "";
  };
  const previewZoom = (factor: number, cx?: number, cy?: number) => {
    const el = scroller.current;
    const st = strip.current;
    if (!el || !st) return;
    const view = el.getBoundingClientRect();
    const x = cx ?? view.left + view.width / 2;
    const y = cy ?? view.top + view.height / 2;
    const base = useEditor.getState().zoom;
    const g = live.current ?? { s: 1, tx: 0, ty: 0, x, y, timer: 0 };
    const s = Math.min(3 / base, Math.max(0.25 / base, g.s * factor));
    const f = s / g.s;
    // The strip's untransformed top-left on screen; scale about the pointer.
    const ox = view.left + st.offsetLeft - el.scrollLeft;
    const oy = view.top + st.offsetTop - el.scrollTop;
    g.tx = x - ox - f * (x - ox - g.tx);
    g.ty = y - oy - f * (y - oy - g.ty);
    g.s = s;
    g.x = x;
    g.y = y;
    st.style.transformOrigin = "0 0";
    st.style.willChange = "transform";
    st.style.transform = `translate(${g.tx}px, ${g.ty}px) scale(${s})`;
    if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(base * s * 100)}%`;
    if (slider.current && document.activeElement !== slider.current) slider.current.value = String(base * s);
    clearTimeout(g.timer);
    g.timer = window.setTimeout(() => {
      if (live.current === g) zoomAtRef.current(base * g.s, g.x, g.y);
    }, 160);
    live.current = g;
  };
  const liveZoom = () => useEditor.getState().zoom * (live.current?.s ?? 1);
  /**
   * Scrolls so a screen sits where the table used to start: a margin in
   * from the top-left, or centred if the strip is narrower than the view.
   */
  const home = (index = 0) => {
    const el = scroller.current;
    const item = el && targets(el)[index];
    if (!el || !item) return;
    const view = el.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const rects = targets(el).map((t) => t.getBoundingClientRect());
    const left = Math.min(...rects.map((b) => b.left));
    const stripW = Math.max(...rects.map((b) => b.right)) - left;
    const x = stripW + 2 * MARGIN <= view.width ? view.left + (view.width - stripW) / 2 + (r.left - left) : view.left + MARGIN;
    el.scrollLeft += r.left - x;
    el.scrollTop += r.top - (view.top + MARGIN);
  };
  // Homing waits for the layout it's measured against (zoom and columns).
  const homeNext = useRef<number | null>(null);
  const [homeTick, setHomeTick] = useState(0);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    anchor.current = null;
    if (homeNext.current !== null) {
      const i = homeNext.current;
      homeNext.current = null;
      return home(i);
    }
    if (!a || !el) return;
    const r = targets(el)[a.index]?.getBoundingClientRect();
    if (!r) return;
    el.scrollLeft += r.left + a.fx * r.width - a.x;
    el.scrollTop += r.top + a.fy * r.height - a.y;
  }, [zoom, cols, homeTick]);

  /**
   * In the grid, zooms so every screen fits the window and shows them all.
   * In the row, zooms so a screen fills the window height and brings the
   * selected screen into view.
   */
  const fit = (mode: Layout = layout) => {
    const el = scroller.current;
    if (!el) return;
    const { doc, selection, zoom: current } = useEditor.getState();
    if (!doc) return;
    const index = Math.max(0, doc.screens.findIndex((s) => s.id === selection.screen));
    const aspect = target.size[0] / target.size[1];
    const next =
      mode === "grid"
        ? gridFitZoom(el.clientWidth, el.clientHeight, aspect, doc.screens.length)
        : Math.min(3, Math.max(0.25, (el.clientHeight - 56 - 110) / BASE_HEIGHT));
    // The add-screen tile counts as one more cell.
    if (mode === "grid") setGridCols(gridColumns(el.clientWidth, Math.round(BASE_HEIGHT * next * aspect), doc.screens.length + 1));
    // A grid that fits is shown from its first screen; otherwise, the selected one.
    homeNext.current = mode === "grid" && next > 0.25 ? 0 : index;
    if (Math.abs(next - current) < 1e-6) setHomeTick((t) => t + 1);
    else zoomAt(next);
  };
  useLayoutEffect(() => fit(), [projectId]);

  const setLayout = (next: Layout) => {
    if (next === layout) return;
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // private mode: the choice lasts for this visit
    }
    setLayoutState(next);
    fit(next);
  };

  // The wheel listener is attached once; it calls the latest functions.
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  const previewZoomRef = useRef(previewZoom);
  previewZoomRef.current = previewZoom;

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
      previewZoomRef.current(factor, e.clientX, e.clientY);
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
          // The empty table: nothing selected, so the inspector shows the project's settings.
          useEditor.getState().select({ screen: null, layer: null });
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
      <div
        className={`strip ${layout}`}
        ref={strip}
        style={layout === "grid" ? { gridTemplateColumns: `repeat(${cols}, ${w}px)` } : undefined}
      >
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
        <span className="seg compact" role="group" aria-label="Arrange screens">
          <button type="button" aria-pressed={layout === "grid"} title="Grid: wrap screens to the window" onClick={() => setLayout("grid")}>
            <LayoutGrid aria-hidden />
          </button>
          <button type="button" aria-pressed={layout === "row"} title="Row: screens in one line, as in the store" onClick={() => setLayout("row")}>
            <GalleryHorizontal aria-hidden />
          </button>
        </span>
        <button
          type="button"
          className="btn ghost"
          style={{ height: 24 }}
          onClick={() => fit()}
          title={layout === "grid" ? "Fit all screens in the window" : "Fit screens to the window height"}
        >
          Fit
        </button>
        <label className="row" title="Zoom (Ctrl or ⌘ + scroll). Hold Space and drag to pan.">
          <span ref={zoomLabel} />
          <input ref={slider} type="range" min={0.25} max={3} step={0.01} defaultValue={zoom} onChange={(e) => previewZoom(+e.target.value / liveZoom())} aria-label="Zoom" />
        </label>
      </div>
    </div>
  );
}

function Sheet({ screen, index, count, width, height, target }: { screen: Screen; index: number; count: number; width: number; height: number; target: Target }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const selected = useEditor((s) => s.selection.screen === screen.id || (s.selection.layer === null && s.selection.more.some((r) => r.screen === screen.id)));
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
        <button
          type="button"
          className="btn ghost icon"
          title="Copy this layout to every screen (keeps their text and screenshots)"
          disabled={count <= 1}
          onClick={() => {
            applyLayoutToAll(screen.id);
            toast(`Copied screen ${index + 1}'s layout to every screen. Undo with ⌘Z.`);
          }}
        >
          <LayoutTemplate aria-hidden />
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
