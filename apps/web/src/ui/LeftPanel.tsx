import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Image as ImageIcon, Layers3, PanelLeftClose, PanelLeftOpen, Smartphone, Square, Type, Upload } from "lucide-react";
import type { Project } from "@storeshots/schema";
import { CATALOG, type VectorFrame } from "@storeshots/frames";
import { frameAspect } from "@storeshots/core";
import { isLayerSelected, useEditor, useSelectedScreen } from "../state/store.ts";
import { addImageLayer, addLayer, captureList, fillWithCaptures, moveLayerTo, setCapture, storeCaptures, updateLayer } from "../state/actions.ts";
import { layerName, TYPE_LABEL } from "./layerName.ts";
import { useObjectUrls } from "./useObjectUrls.ts";
import { renderStandalone } from "../engine/preview.ts";
import { decodeImage } from "../engine/host.ts";

type Tab = "layers" | "screenshots" | "frames";

const TABS: Array<{ id: Tab; label: string; icon: typeof Type }> = [
  { id: "layers", label: "Layers", icon: Layers3 },
  { id: "screenshots", label: "Screenshots", icon: ImageIcon },
  { id: "frames", label: "Frames", icon: Smartphone },
];

const COLLAPSED_KEY = "storeshots.left-collapsed";

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Layers, screenshots and frames. It folds down to a strip of icons (the
 * button in its header, or ⌘\) to give the table more room; an icon opens
 * the panel on that tab.
 */
export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("layers");
  const [collapsed, setCollapsedState] = useState(savedCollapsed);
  const setCollapsed = (next: boolean) => {
    try {
      if (next) localStorage.setItem(COLLAPSED_KEY, "1");
      else localStorage.removeItem(COLLAPSED_KEY);
    } catch {
      // private mode: the choice lasts for this visit
    }
    setCollapsedState(next);
  };
  const toggle = useRef(() => {});
  toggle.current = () => setCollapsed(!collapsed);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.code === "Backslash" || e.key === "\\")) {
        e.preventDefault();
        toggle.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (collapsed) {
    return (
      <aside className="panel left collapsed" aria-label="Layers, screenshots and frames (collapsed)">
        <button type="button" className="btn ghost icon" title="Show panel (⌘\)" aria-label="Show panel" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen aria-hidden />
        </button>
        <span className="rail-rule" />
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="btn ghost icon"
            title={label}
            aria-label={`Show ${label.toLowerCase()}`}
            onClick={() => {
              setTab(id);
              setCollapsed(false);
            }}
          >
            <Icon aria-hidden />
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="panel left" aria-label="Layers, screenshots and frames">
      <div className="tabs" role="tablist">
        {TABS.map(({ id, label }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <button type="button" className="collapse" title="Hide panel (⌘\)" aria-label="Hide panel" onClick={() => setCollapsed(true)}>
          <PanelLeftClose aria-hidden />
        </button>
      </div>
      {tab === "layers" && <Layers />}
      {tab === "screenshots" && <Screenshots />}
      {tab === "frames" && <Frames />}
    </aside>
  );
}

const ICONS = { text: Type, device: Smartphone, image: ImageIcon, shape: Square } as const;

/**
 * The selected screen's layers, top of the stack first, as in every design
 * tool. Drag a row to restack it, or use its arrows; hovering a row
 * highlights the layer on the canvas and the other way round.
 */
function Layers() {
  const doc = useEditor((s) => s.doc!);
  const locale = useEditor((s) => s.locale);
  const screen = useSelectedScreen();
  const selected = useEditor((s) => s.selection.layer);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => (s.hover.screen === s.selection.screen ? s.hover.layer : null));
  const imageInput = useRef<HTMLInputElement>(null);
  // Row being dragged, and the row and half it's over.
  const [drag, setDrag] = useState<{ from: number; over: number | null; above: boolean } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  // The click that ends a drag must not select the row now at the old index.
  const justDragged = useRef(false);

  // Keep the selected row in view when the selection changes on the canvas.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, screen?.id]);

  if (!screen) return <p className="hint section">Select a screen to see its layers.</p>;
  const n = screen.layers.length;
  const index = doc.screens.findIndex((s) => s.id === screen.id);
  const rows = screen.layers.map((l, i) => [l, i] as const).reverse();

  /** Final stacking index when dropping above or below row `over`. */
  const dropIndex = (from: number, over: number, above: boolean) => {
    // Rows are drawn top of the stack first, so "above" means a higher index.
    let to = above ? over + 1 : over;
    if (from < to) to -= 1;
    return Math.max(0, Math.min(n - 1, to));
  };

  /**
   * Pointer-driven restacking: a press that moves more than a few pixels
   * becomes a drag; the row under the pointer and its half decide where
   * the layer lands. A press that doesn't move is an ordinary click.
   */
  const startRowDrag = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".row-tools")) return;
    const startY = e.clientY;
    let state: { from: number; over: number | null; above: boolean } | null = null;
    const move = (ev: PointerEvent) => {
      if (!state && Math.abs(ev.clientY - startY) < 4) return;
      state ??= { from, over: null, above: false };
      const rows = [...(list.current?.querySelectorAll<HTMLElement>("li[data-layer]") ?? [])];
      // The row under the pointer, or the first or last row past either end.
      const hit =
        rows.find((r) => {
          const b = r.getBoundingClientRect();
          return ev.clientY >= b.top && ev.clientY < b.bottom;
        }) ?? (ev.clientY < (rows[0]?.getBoundingClientRect().top ?? 0) ? rows[0] : rows[rows.length - 1]);
      if (!hit) return;
      const b = hit.getBoundingClientRect();
      state = { from, over: Number(hit.dataset.layer), above: ev.clientY < b.top + b.height / 2 };
      setDrag(state);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (state && state.over !== null) {
        moveLayerTo(screen.id, state.from, dropIndex(state.from, state.over, state.above));
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 0);
      }
      setDrag(null);
    };
    const cancel = () => {
      state = null;
      up();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <>
      <div className="section">
        <h3>Add</h3>
        <div className="grid4">
          <button type="button" className="btn" title="Add text" onClick={() => addLayer("text")}>
            <Type aria-hidden />
          </button>
          <button type="button" className="btn" title="Add device" onClick={() => addLayer("device")}>
            <Smartphone aria-hidden />
          </button>
          <button type="button" className="btn" title="Add image" onClick={() => imageInput.current?.click()}>
            <ImageIcon aria-hidden />
          </button>
          <button type="button" className="btn" title="Add shape" onClick={() => addLayer("shape")}>
            <Square aria-hidden />
          </button>
        </div>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addImageLayer(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="layers-head">
        <span className="badge">{String(index + 1).padStart(2, "0")}</span>
        <span className="title">
          <b>{screen.id}</b>
          <small>
            {n} {n === 1 ? "layer" : "layers"}
            {n > 1 ? " · top of the stack first" : ""}
          </small>
        </span>
      </div>
      <ul
        ref={list}
        className={`layers${drag ? " sorting" : ""}`}
        aria-label={`Layers of ${screen.id}, top first`}
        onPointerLeave={() => useEditor.getState().setHover({ screen: null, layer: null })}
      >
        {rows.map(([l, i]) => {
          const Icon = ICONS[l.type];
          const moves = drag && drag.over === i && dropIndex(drag.from, i, drag.above) !== drag.from;
          return (
            <li
              key={i}
              className={`${moves ? (drag!.above ? "drop-above" : "drop-below") : ""}${drag?.from === i ? " dragging" : ""}`}
              data-layer={i}
              onPointerDown={(e) => startRowDrag(e, i)}
              onPointerEnter={() => !drag && useEditor.getState().setHover({ screen: screen.id, layer: i })}
            >
              <button
                type="button"
                className={hover === i && selected !== i ? "hovered" : undefined}
                aria-current={isLayerSelected(selection, screen.id, i)}
                onClick={(e) => {
                  if (justDragged.current) return;
                  // Shift adds the layer to the selection (or takes it out).
                  if (e.shiftKey) useEditor.getState().toggleSelect({ screen: screen.id, layer: i });
                  else useEditor.getState().select({ screen: screen.id, layer: i });
                }}
                onKeyDown={(e) => {
                  // Alt + arrows restack from the keyboard.
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  moveLayerTo(screen.id, i, i + (e.key === "ArrowUp" ? 1 : -1));
                }}
                title={`${TYPE_LABEL[l.type]} · layer ${i + 1} of ${n} from the bottom. Drag or Alt+↑/↓ to restack.`}
              >
                <GripVertical className="grip" aria-hidden />
                <Icon aria-hidden />
                <span className="name">{layerName(doc, l, locale)}</span>
                <span className="kind">{TYPE_LABEL[l.type]}</span>
              </button>
              <span className="row-tools">
                <button type="button" className="btn ghost icon" title="Bring forward" aria-label={`Bring ${TYPE_LABEL[l.type].toLowerCase()} forward`} disabled={i === n - 1} onClick={() => moveLayerTo(screen.id, i, i + 1)}>
                  <ChevronUp aria-hidden />
                </button>
                <button type="button" className="btn ghost icon" title="Send backward" aria-label={`Send ${TYPE_LABEL[l.type].toLowerCase()} backward`} disabled={i === 0} onClick={() => moveLayerTo(screen.id, i, i - 1)}>
                  <ChevronDown aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {n === 0 && <p className="hint section">This screen is empty. Add a device and a caption above.</p>}
    </>
  );
}

function Screenshots() {
  const doc = useEditor((s) => s.doc!);
  const assets = useEditor((s) => s.assets);
  const selection = useEditor((s) => s.selection);
  const screen = useSelectedScreen();
  const input = useRef<HTMLInputElement>(null);
  const names = captureList(assets, doc.locales.default);
  const urls = useObjectUrls(names.map((n) => [n, assets.get(`captures/${doc.locales.default}/${n}`)!]));

  const layer = screen && selection.layer !== null ? screen.layers[selection.layer] : undefined;
  const current = layer?.type === "device" ? layer.capture : undefined;

  const assign = async (name: string) => {
    if (!screen) return;
    const i = layer?.type === "device" ? selection.layer! : screen.layers.findIndex((l) => l.type === "device");
    if (i < 0) return;
    const bmp = await decodeImage(assets.get(`captures/${doc.locales.default}/${name}`)!);
    setCapture(screen.id, i, { name, width: bmp.width, height: bmp.height });
  };

  return (
    <div className="section">
      <button type="button" className="dropzone" onClick={() => input.current?.click()}>
        <Upload size={16} aria-hidden />
        <br />
        Add screenshots
        <br />
        <small>PNG or JPEG from adb, simctl or the emulator</small>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          // With nothing to fill, keep them in the library; otherwise fill empty devices.
          const empty = doc.screens.some((s) => s.layers.some((l) => l.type === "device" && !l.capture));
          if (empty) await fillWithCaptures(files, screen?.id);
          else await storeCaptures(files);
        }}
      />
      {names.length > 0 ? (
        <>
          <p className="hint">Drag onto a phone, or click to use on the selected one.</p>
          <div className="captures">
            {names.map((n) => (
              <button
                key={n}
                type="button"
                title={n}
                aria-pressed={current === n}
                draggable
                onDragStart={async (e) => {
                  const img = e.currentTarget.querySelector("img")!;
                  e.dataTransfer.setData("application/x-storeshots-capture", `${n}|${img.naturalWidth}|${img.naturalHeight}`);
                }}
                onClick={() => assign(n)}
              >
                <img src={urls.get(n)} alt={n} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="hint">No screenshots yet. Drop them on the table or add them here.</p>
      )}
    </div>
  );
}

/** Renders a frame on a plain card, once per session. */
const thumbs = new Map<string, Promise<string>>();
function frameThumb(frame: VectorFrame, variant: string): Promise<string> {
  const key = `${frame.id}:${variant}`;
  let p = thumbs.get(key);
  if (!p) {
    const W = 240;
    const H = 480;
    const w = 0.8;
    const h = (w * (W / H)) / frameAspect(frame);
    const doc: Project = {
      schemaVersion: 1,
      name: "thumb",
      locales: { default: "en", list: ["en"] },
      targets: [{ id: "t", store: "play", size: [W, H], format: "png" }],
      theme: { fonts: {}, colors: {} },
      screens: [
        {
          id: "s",
          background: { type: "solid", color: "#FFFFFF" },
          layers: [{ type: "device", frame: frame.id, variant, capture: "", shadow: false, box: { x: 0.1, y: (1 - h) / 2, w, h }, rotate: 0, opacity: 1 }],
        },
      ],
      captions: {},
    };
    p = renderStandalone(doc, new Map(), "s", 1);
    thumbs.set(key, p);
  }
  return p;
}

function FrameThumb({ frame, variant }: { frame: VectorFrame; variant: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => void frameThumb(frame, variant).then(setSrc), [frame, variant]);
  return src ? <img src={src} alt="" /> : <div style={{ aspectRatio: "1 / 2" }} />;
}

function Frames() {
  const screen = useSelectedScreen();
  const selection = useEditor((s) => s.selection);
  const assets = useEditor((s) => s.assets);
  const layer = screen && selection.layer !== null ? screen.layers[selection.layer] : undefined;
  const device = layer?.type === "device" ? layer : undefined;
  const currentId = device ? (typeof device.frame === "string" ? device.frame : device.frame.android) : undefined;
  const imported = [...assets.keys()].filter((p) => /^frames\/[^/]+\/frame\.json$/.test(p)).map((p) => p.split("/")[1]!);

  const apply = (id: string, variant?: string) => {
    if (!device) {
      addLayer("device");
      const s = useEditor.getState();
      const idx = s.selection.layer;
      if (idx === null) return;
      return updateLayer("Change frame", (l) => {
        if (l.type === "device") {
          l.frame = id;
          l.variant = variant;
        }
      });
    }
    updateLayer("Change frame", (l) => {
      if (l.type !== "device") return;
      l.frame = id;
      l.variant = variant;
    });
  };

  return (
    <>
      <div className="section">
        <p className="hint">{device ? "Pick a frame for the selected phone." : "Select a phone on the table to change its frame, or pick one to add a phone."}</p>
        <div className="frames">
          {CATALOG.map((f) => (
            <button key={f.id} type="button" className="frame-card" aria-pressed={currentId === f.id} onClick={() => apply(f.id)}>
              <FrameThumb frame={f} variant={currentId === f.id && device?.variant ? device.variant : f.defaultVariant} />
              <small>{f.name}</small>
            </button>
          ))}
        </div>
      </div>
      {device && currentId && CATALOG.find((f) => f.id === currentId) && (
        <div className="section">
          <h3>Finish</h3>
          <div className="chips">
            {Object.entries(CATALOG.find((f) => f.id === currentId)!.variants).map(([name, v]) => (
              <button key={name} type="button" className="chip" aria-pressed={(device.variant ?? CATALOG.find((f) => f.id === currentId)!.defaultVariant) === name} onClick={() => apply(currentId, name)}>
                <i style={{ background: v.body }} />
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      {imported.length > 0 && (
        <div className="section">
          <h3>Imported skins</h3>
          <div className="chips">
            {imported.map((id) => (
              <button key={id} type="button" className="chip" aria-pressed={currentId === id} onClick={() => apply(id)}>
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="section">
        <p className="hint">
          Exact Android emulator bezels: run <code>storeshots frames import pixel_10_pro</code> in the project folder, then reopen it.
        </p>
      </div>
    </>
  );
}
