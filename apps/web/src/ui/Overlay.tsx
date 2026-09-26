import { useRef, useState } from "react";
import type { DeviceLayer, Layer, Screen } from "@storeshots/schema";
import { findFrame } from "@storeshots/frames";
import { frameGeometry } from "@storeshots/core";
import { useEditor } from "../state/store.ts";
import { updateLayer } from "../state/actions.ts";
import { useFrameDef } from "../engine/preview.ts";

/**
 * Selection, move, resize and rotate, drawn as DOM on top of the rendered
 * canvas. Nothing here draws into the export: it only edits layer boxes.
 */
interface Props {
  screen: Screen;
  width: number;
  height: number;
  /** Target size in px, for readouts in real output pixels. */
  target: [number, number];
  active: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Array<{ id: Handle; sx: number; sy: number }> = [
  { id: "nw", sx: -1, sy: -1 },
  { id: "n", sx: 0, sy: -1 },
  { id: "ne", sx: 1, sy: -1 },
  { id: "e", sx: 1, sy: 0 },
  { id: "se", sx: 1, sy: 1 },
  { id: "s", sx: 0, sy: 1 },
  { id: "sw", sx: -1, sy: 1 },
  { id: "w", sx: -1, sy: 0 },
];
const CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

/** Snap distance in CSS pixels. */
const SNAP = 6;

const rad = (deg: number) => (deg * Math.PI) / 180;
const rotateVec = (x: number, y: number, deg: number) => {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: x * c - y * s, y: x * s + y * c };
};

function frameIdOf(l: DeviceLayer, store: string): string | undefined {
  if (typeof l.frame === "string") return l.frame;
  return store === "play" ? l.frame.android : l.frame.ios;
}

export function Overlay({ screen, width, height, target, active }: Props) {
  const selectedLayer = useEditor((s) => (s.selection.screen === screen.id ? s.selection.layer : null));
  const store = useEditor((s) => s.doc?.targets.find((t) => t.id === s.target)?.store ?? "play");
  const [hover, setHover] = useState<number | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const rectOf = (l: Layer): Rect => ({ x: l.box.x * width, y: l.box.y * height, w: l.box.w * width, h: l.box.h * height });

  /** The visible body of a layer: devices are smaller than their box. */
  const bodyOf = (l: Layer): Rect => {
    const r = rectOf(l);
    if (l.type !== "device") return r;
    const f = findFrame(frameIdOf(l, store) ?? "");
    return f ? frameGeometry(f, r).body : r;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const b = root.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const hitTest = (p: { x: number; y: number }): number | null => {
    for (let i = screen.layers.length - 1; i >= 0; i--) {
      const l = screen.layers[i]!;
      const r = rectOf(l);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const q = rotateVec(p.x - cx, p.y - cy, -l.rotate);
      const body = bodyOf(l);
      const bx = body.x - cx;
      const by = body.y - cy;
      if (q.x >= bx && q.x <= bx + body.w && q.y >= by && q.y <= by + body.h) return i;
    }
    return null;
  };

  /** Snap lines: canvas edges and centre, plus other layers' edges and centres. */
  const snapLines = (except: number) => {
    const v = [0, width / 2, width];
    const h = [0, height / 2, height];
    screen.layers.forEach((l, i) => {
      if (i === except || l.rotate) return;
      const r = bodyOf(l);
      v.push(r.x, r.x + r.w / 2, r.x + r.w);
      h.push(r.y, r.y + r.h / 2, r.y + r.h);
    });
    return { v, h };
  };

  const snap1 = (edges: number[], lines: number[]) => {
    let best: { d: number; line: number } | null = null;
    for (const e of edges)
      for (const line of lines) {
        const d = line - e;
        if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
      }
    return best;
  };

  const startDrag = (
    e: React.PointerEvent,
    index: number,
    mode: { kind: "move" } | { kind: "resize"; handle: (typeof HANDLES)[number] } | { kind: "rotate" },
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const layer = screen.layers[index]!;
    // A device draws centred inside its box; dragging tightens the box to the
    // visible body (same render) so handles sit exactly on the device's corners.
    const startBody = bodyOf(layer);
    const start = layer.type === "device" ? startBody : rectOf(layer);
    const p0 = local(e);
    const lines = snapLines(index);
    const { beginGesture, endGesture } = useEditor.getState();
    beginGesture(mode.kind === "move" ? "Move layer" : mode.kind === "rotate" ? "Rotate layer" : "Resize layer");
    const keepAspect = layer.type === "device" || layer.type === "image";
    (e.target as Element).setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const p = local(ev);
      const set = (r: Rect, rotate = layer.rotate) =>
        updateLayer("Edit layer", (l) => {
          l.box = { x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height };
          l.rotate = rotate;
        }, { screen: screen.id, layer: index });

      if (mode.kind === "move") {
        let dx = p.x - p0.x;
        let dy = p.y - p0.y;
        const g = { v: [] as number[], h: [] as number[] };
        if (!ev.altKey && !layer.rotate) {
          const bx = startBody.x + dx;
          const by = startBody.y + dy;
          const sx = snap1([bx, bx + startBody.w / 2, bx + startBody.w], lines.v);
          const sy = snap1([by, by + startBody.h / 2, by + startBody.h], lines.h);
          if (sx) {
            dx += sx.d;
            g.v.push(sx.line);
          }
          if (sy) {
            dy += sy.d;
            g.h.push(sy.line);
          }
        }
        if (ev.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        setGuides(g);
        set({ ...start, x: start.x + dx, y: start.y + dy });
        const rx = Math.round(((start.x + dx) / width) * target[0]);
        const ry = Math.round(((start.y + dy) / height) * target[1]);
        setReadout({ x: start.x + dx + start.w / 2, y: start.y + dy + start.h, text: `${rx}, ${ry}` });
      } else if (mode.kind === "rotate") {
        const cx = start.x + start.w / 2;
        const cy = start.y + start.h / 2;
        let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (deg > 180) deg -= 360;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        else for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(deg - a) < 3) deg = a;
        deg = Math.round(deg * 10) / 10;
        set(start, deg === -180 ? 180 : deg);
        setReadout({ x: cx, y: start.y + start.h, text: `${deg.toFixed(1)}°` });
      } else {
        // Resize in the layer's own rotated frame, anchored at the opposite side.
        const { sx, sy } = mode.handle;
        const cx = start.x + start.w / 2;
        const cy = start.y + start.h / 2;
        const q = rotateVec(p.x - cx, p.y - cy, -layer.rotate);
        const ax = -sx * (start.w / 2);
        const ay = -sy * (start.h / 2);
        let w = sx ? Math.max(12, sx * (q.x - ax)) : start.w;
        let h = sy ? Math.max(12, sy * (q.y - ay)) : start.h;
        if (keepAspect && (sx === 0 || sy === 0 || !ev.shiftKey)) {
          const k = sx && sy ? Math.max(w / start.w, h / start.h) : sx ? w / start.w : h / start.h;
          w = start.w * k;
          h = start.h * k;
        } else if (!keepAspect && ev.shiftKey && sx && sy) {
          const k = Math.max(w / start.w, h / start.h);
          w = start.w * k;
          h = start.h * k;
        }
        // Centre of the new box, in local coordinates, then back to canvas.
        const lcx = sx ? ax + sx * (w / 2) : 0;
        const lcy = sy ? ay + sy * (h / 2) : 0;
        const c = rotateVec(lcx, lcy, layer.rotate);
        const ncx = cx + c.x;
        const ncy = cy + c.y;
        set({ x: ncx - w / 2, y: ncy - h / 2, w, h });
        setReadout({
          x: ncx,
          y: ncy + h / 2,
          text: `${Math.round((w / width) * target[0])} × ${Math.round((h / height) * target[1])}`,
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      endGesture();
      setGuides({ v: [], h: [] });
      setReadout(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const hit = hitTest(local(e));
    useEditor.getState().select({ screen: screen.id, layer: hit });
    if (hit !== null) startDrag(e, hit, { kind: "move" });
  };

  const sel = selectedLayer !== null ? screen.layers[selectedLayer] : undefined;
  const hov = hover !== null && hover !== selectedLayer ? screen.layers[hover] : undefined;

  return (
    <div
      ref={root}
      className="overlay"
      onPointerDown={onPointerDown}
      onPointerMove={(e) => setHover(hitTest(local(e)))}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={() => {
        if (sel?.type === "text") window.dispatchEvent(new CustomEvent("storeshots:edit-text"));
      }}
    >
      {screen.layers.map((l, i) =>
        l.type === "device" && !l.capture ? <EmptyScreen key={i} layer={l} rect={rectOf(l)} frameId={frameIdOf(l, store)} /> : null,
      )}
      {hov && <Box rect={bodyOf(hov)} rotate={hov.rotate} center={rectOf(hov)} className="sel hover" />}
      {sel && active && (
        <Selection
          layer={sel}
          rect={rectOf(sel)}
          body={bodyOf(sel)}
          onHandle={(e, handle) => startDrag(e, selectedLayer!, { kind: "resize", handle })}
          onRotate={(e) => startDrag(e, selectedLayer!, { kind: "rotate" })}
        />
      )}
      {guides.v.map((x, i) => (
        <div key={`v${i}`} className="guide v" style={{ left: x }} />
      ))}
      {guides.h.map((y, i) => (
        <div key={`h${i}`} className="guide h" style={{ top: y }} />
      ))}
      {readout && (
        <div className="readout" style={{ left: readout.x, top: readout.y }}>
          {readout.text}
        </div>
      )}
    </div>
  );
}

/** A rotated rectangle positioned around its layer box's centre. */
function Box({ rect, center, rotate, className, children }: { rect: Rect; center: Rect; rotate: number; className: string; children?: React.ReactNode }) {
  const cx = center.x + center.w / 2;
  const cy = center.y + center.h / 2;
  return (
    <div
      className={className}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transformOrigin: `${cx - rect.x}px ${cy - rect.y}px`,
        transform: `rotate(${rotate}deg)`,
      }}
    >
      {children}
    </div>
  );
}

function Selection(props: {
  layer: Layer;
  rect: Rect;
  body: Rect;
  onHandle: (e: React.PointerEvent, h: (typeof HANDLES)[number]) => void;
  onRotate: (e: React.PointerEvent) => void;
}) {
  const { layer, rect, body } = props;
  // Devices and images resize from the corners and keep their proportions.
  const handles = layer.type === "device" ? HANDLES.filter((h) => h.sx && h.sy) : HANDLES;
  return (
    <Box rect={body} center={rect} rotate={layer.rotate} className="sel">
      {handles.map((h) => (
        <div
          key={h.id}
          className="handle"
          style={{ left: `${((h.sx + 1) / 2) * 100}%`, top: `${((h.sy + 1) / 2) * 100}%`, cursor: CURSORS[h.id] }}
          onPointerDown={(e) => props.onHandle(e, h)}
        />
      ))}
      <div className="rot-stem" />
      <div className="handle rot" style={{ left: "50%", top: -24 }} title="Rotate (Shift snaps to 15°)" onPointerDown={props.onRotate} />
    </Box>
  );
}

/** "Drop a screenshot" hint over a device that has none yet. */
function EmptyScreen({ layer, rect, frameId }: { layer: DeviceLayer; rect: Rect; frameId: string | undefined }) {
  const frame = useFrameDef(frameId);
  if (!frame) return null;
  const g = frameGeometry(frame, rect);
  if (g.screen.w < 60) return null;
  return (
    <Box rect={g.screen} center={rect} rotate={layer.rotate} className="empty-screen">
      <span>
        Drop a screenshot
        <br />
        here
      </span>
    </Box>
  );
}
