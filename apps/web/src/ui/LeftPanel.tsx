import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Smartphone, Square, Type, Upload } from "lucide-react";
import type { Layer, Project } from "@storeshots/schema";
import { CATALOG, type VectorFrame } from "@storeshots/frames";
import { frameAspect } from "@storeshots/core";
import { useEditor, useSelectedScreen } from "../state/store.ts";
import { addImageLayer, addLayer, captureList, fillWithCaptures, layerText, setCapture, storeCaptures, updateLayer } from "../state/actions.ts";
import { renderStandalone } from "../engine/preview.ts";
import { decodeImage } from "../engine/host.ts";

type Tab = "layers" | "screenshots" | "frames";

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("layers");
  return (
    <aside className="panel left" aria-label="Layers, screenshots and frames">
      <div className="tabs" role="tablist">
        {(["layers", "screenshots", "frames"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "layers" && <Layers />}
      {tab === "screenshots" && <Screenshots />}
      {tab === "frames" && <Frames />}
    </aside>
  );
}

const ICONS = { text: Type, device: Smartphone, image: ImageIcon, shape: Square } as const;

function layerName(doc: Project, l: Layer, locale: string): string {
  if (l.type === "text") return layerText(doc, l, locale) || "Empty text";
  if (l.type === "device") {
    const id = typeof l.frame === "string" ? l.frame : (l.frame.android ?? l.frame.ios ?? "");
    const name = CATALOG.find((f) => f.id === id)?.name ?? id;
    return l.capture ? `${name} · ${l.capture}` : `${name} · no screenshot`;
  }
  if (l.type === "image") return l.src.split("/").pop() ?? "Image";
  return l.shape === "ellipse" ? "Ellipse" : "Rectangle";
}

function Layers() {
  const doc = useEditor((s) => s.doc!);
  const locale = useEditor((s) => s.locale);
  const screen = useSelectedScreen();
  const selected = useEditor((s) => s.selection.layer);
  const imageInput = useRef<HTMLInputElement>(null);
  if (!screen) return <p className="hint section">Select a screen to see its layers.</p>;
  // Topmost first, like every design tool.
  const rows = screen.layers.map((l, i) => [l, i] as const).reverse();
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
      <ul className="layers" aria-label={`Layers of ${screen.id}`}>
        {rows.map(([l, i]) => {
          const Icon = ICONS[l.type];
          return (
            <li key={i}>
              <button type="button" aria-current={selected === i} onClick={() => useEditor.getState().select({ layer: i })}>
                <Icon aria-hidden />
                <span>{layerName(doc, l, locale)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {screen.layers.length === 0 && <p className="hint section">This screen is empty. Add a device and a caption above.</p>}
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
  const urls = useMemo(() => new Map(names.map((n) => [n, URL.createObjectURL(assets.get(`captures/${doc.locales.default}/${n}`)!)])), [assets, names.join()]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

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
