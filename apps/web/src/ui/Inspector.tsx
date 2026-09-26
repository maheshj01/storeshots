import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Copy, Trash2, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, LayoutTemplate } from "lucide-react";
import type { Background, DeviceLayer, ImageLayer, Layer, ShapeLayer, TextLayer } from "@storeshots/schema";
import { CATALOG } from "@storeshots/frames";
import { useEditor, useSelectedScreen, useTarget } from "../state/store.ts";
import {
  addFont, applyLayoutToAll, captureList, deleteLayer, duplicateLayer, ensureFonts, layerText, moveLayer, setCapture, setLayerText, switchTemplate, updateLayer,
} from "../state/actions.ts";
import { BUNDLED_FONTS, TEMPLATES } from "../state/templates.ts";
import { decodeImage } from "../engine/host.ts";
import { ColorField, NumberField, Section, Segmented, Toggle } from "./fields.tsx";

export function Inspector() {
  const screen = useSelectedScreen();
  const index = useEditor((s) => s.selection.layer);
  const layer = screen && index !== null ? screen.layers[index] : undefined;
  return (
    <aside className="panel right" aria-label="Inspector">
      {!screen ? (
        <p className="hint section">Select a screen on the table.</p>
      ) : layer ? (
        <LayerInspector layer={layer} key={`${screen.id}:${index}`} />
      ) : (
        <ScreenInspector />
      )}
    </aside>
  );
}

function ScreenInspector() {
  const screen = useSelectedScreen()!;
  const doc = useEditor((s) => s.doc!);
  const edit = (label: string, fn: (b: Background) => Background) =>
    useEditor.getState().edit(label, (d) => {
      const s = d.screens.find((x) => x.id === screen.id)!;
      s.background = fn(s.background as Background);
    }, `bg:${screen.id}:${label}`);
  const bg = screen.background;
  const first = bg.type === "solid" ? bg.color : bg.type === "linear-gradient" ? bg.stops[0]![0] : (bg.color ?? "#FFFFFF");

  return (
    <>
      <Section title={`Screen ${doc.screens.findIndex((s) => s.id === screen.id) + 1}`}>
        <p className="hint">Click a layer on the table to edit it. Double-click text to change the words.</p>
      </Section>
      <Section title="Background">
        <Segmented
          label="Background type"
          value={bg.type === "image" ? "solid" : bg.type}
          options={[
            { value: "solid", label: "Solid" },
            { value: "linear-gradient", label: "Gradient" },
          ]}
          onChange={(v) =>
            edit("Background type", () =>
              v === "solid" ? { type: "solid", color: first } : { type: "linear-gradient", angle: 180, stops: [[first, 0], ["#FFFFFF", 1]] },
            )
          }
        />
        {bg.type === "solid" && <ColorField label="Colour" value={bg.color} onChange={(c) => edit("Background colour", () => ({ type: "solid", color: c }))} />}
        {bg.type === "linear-gradient" && (
          <>
            <ColorField label="From" value={bg.stops[0]![0]} onChange={(c) => edit("Gradient start", (b) => ({ ...(b as typeof bg), stops: [[c, 0], ...(b as typeof bg).stops.slice(1)] }))} />
            <ColorField
              label="To"
              value={bg.stops[bg.stops.length - 1]![0]}
              onChange={(c) => edit("Gradient end", (b) => ({ ...(b as typeof bg), stops: [...(b as typeof bg).stops.slice(0, -1), [c, 1]] }))}
            />
            <div className="field">
              <span>Angle {Math.round(bg.angle)}°</span>
              <input type="range" min={0} max={360} value={bg.angle} onChange={(e) => edit("Gradient angle", (b) => ({ ...(b as typeof bg), angle: +e.target.value }))} aria-label="Gradient angle" />
            </div>
          </>
        )}
      </Section>
      <Section title="Layout">
        <button type="button" className="btn" onClick={() => applyLayoutToAll(screen.id)} title="Copies this screen's background and layer positions onto every screen, keeping their text and screenshots">
          <LayoutTemplate aria-hidden /> Apply this layout to all screens
        </button>
        <div className="field">
          <span>Template for every screen</span>
          <select className="input" value="" onChange={(e) => e.target.value && void switchTemplate(e.target.value)} aria-label="Apply a template">
            <option value="">Choose a template…</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}: {t.blurb}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">Templates keep your captions and screenshots.</p>
      </Section>
      <ThemeColors />
    </>
  );
}

function ThemeColors() {
  const colors = useEditor((s) => s.doc!.theme.colors);
  return (
    <Section title="Theme colours">
      <p className="hint">Layers using a theme colour update everywhere when you change it here.</p>
      {Object.entries(colors).map(([name, value]) => (
        <ColorField
          key={name}
          label={name}
          value={value}
          onChange={(v) => {
            if (v === `$${name}`) return;
            useEditor.getState().edit(`Theme colour ${name}`, (d) => {
              d.theme.colors[name] = v;
            }, `theme:${name}`);
          }}
        />
      ))}
    </Section>
  );
}

function LayerInspector({ layer }: { layer: Layer }) {
  const target = useTarget()!;
  const [W, H] = target.size;
  const up = (label: string, fn: (l: Layer) => void) => updateLayer(label, fn);
  const title = { text: "Text", device: "Device", image: "Image", shape: "Shape" }[layer.type];
  return (
    <>
      <Section
        title={title}
        action={
          <span className="row" style={{ gap: 0 }}>
            <button type="button" className="btn ghost icon" title="Bring forward" onClick={() => moveLayer(1)}>
              <ArrowUp aria-hidden />
            </button>
            <button type="button" className="btn ghost icon" title="Send backward" onClick={() => moveLayer(-1)}>
              <ArrowDown aria-hidden />
            </button>
            <button type="button" className="btn ghost icon" title="Duplicate (⌘D)" onClick={duplicateLayer}>
              <Copy aria-hidden />
            </button>
            <button type="button" className="btn ghost icon danger" title="Delete (⌫)" onClick={deleteLayer}>
              <Trash2 aria-hidden />
            </button>
          </span>
        }
      >
        {layer.type === "text" && <TextFields layer={layer} />}
        {layer.type === "device" && <DeviceFields layer={layer} />}
        {layer.type === "image" && <ImageFields layer={layer} />}
        {layer.type === "shape" && <ShapeFields layer={layer} />}
      </Section>
      <Section title="Position">
        <div className="grid2">
          <NumberField label="X" title="Left, in output pixels" value={layer.box.x * W} onChange={(v) => up("Move layer", (l) => void (l.box.x = v / W))} />
          <NumberField label="Y" title="Top, in output pixels" value={layer.box.y * H} onChange={(v) => up("Move layer", (l) => void (l.box.y = v / H))} />
          <NumberField label="W" title="Width, in output pixels" min={8} value={layer.box.w * W} onChange={(v) => up("Resize layer", (l) => void (l.box.w = v / W))} />
          <NumberField label="H" title="Height, in output pixels" min={8} value={layer.box.h * H} onChange={(v) => up("Resize layer", (l) => void (l.box.h = v / H))} />
          <NumberField label="°" title="Rotation in degrees" min={-180} max={180} digits={1} step={0.5} value={layer.rotate} onChange={(v) => up("Rotate layer", (l) => void (l.rotate = v))} />
          <NumberField label="%" title="Opacity" min={0} max={100} value={layer.opacity * 100} onChange={(v) => up("Opacity", (l) => void (l.opacity = v / 100))} />
        </div>
      </Section>
    </>
  );
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const doc = useEditor((s) => s.doc!);
  const assets = useEditor((s) => s.assets);
  const upload = useRef<HTMLInputElement>(null);
  const projectFonts = [...assets.keys()].filter((p) => /^fonts\/.+\.(ttf|otf)$/i.test(p));
  const bundled = BUNDLED_FONTS.filter((f) => !projectFonts.includes(`fonts/${f.file}`));
  const label = (p: string) => p.replace(/^fonts\//, "").replace(/\.(ttf|otf)$/i, "").replace(/[-_]/g, " ");
  return (
    <div className="field">
      <span>Font</span>
      <select
        className="input"
        value={value}
        aria-label="Font"
        onChange={async (e) => {
          const v = e.target.value;
          if (v === "__upload") return upload.current?.click();
          if (v.startsWith("bundled:")) {
            const file = v.slice(8);
            await ensureFonts([file]);
            return onChange(`fonts/${file}`);
          }
          onChange(v);
        }}
      >
        {Object.keys(doc.theme.fonts).map((k) => (
          <option key={k} value={`$${k}`}>
            Theme {k} ({label(doc.theme.fonts[k]!)})
          </option>
        ))}
        <optgroup label="In this project">
          {projectFonts.map((p) => (
            <option key={p} value={p}>
              {label(p)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Add to project">
          {bundled.map((f) => (
            <option key={f.file} value={`bundled:${f.file}`}>
              {f.label}
            </option>
          ))}
          <option value="__upload">Upload a TTF or OTF…</option>
        </optgroup>
      </select>
      <input
        ref={upload}
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const path = await addFont(f);
          if (path) onChange(path);
        }}
      />
    </div>
  );
}

function TextFields({ layer }: { layer: TextLayer }) {
  const doc = useEditor((s) => s.doc!);
  const locale = useEditor((s) => s.locale);
  const sel = useEditor((s) => s.selection);
  const target = useTarget()!;
  const value = layerText(doc, layer, locale);
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const focus = () => {
      area.current?.focus();
      area.current?.select();
    };
    window.addEventListener("storeshots:edit-text", focus);
    return () => window.removeEventListener("storeshots:edit-text", focus);
  }, []);
  const up = (label: string, fn: (l: TextLayer) => void) => updateLayer(label, (l) => l.type === "text" && fn(l));
  const W = target.size[0];
  return (
    <>
      <label className="field">
        <span>Text{doc.locales.list.length > 1 ? ` (${locale})` : ""}</span>
        <textarea
          ref={area}
          className="input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setLayerText(sel.screen!, sel.layer!, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
        />
      </label>
      <FontSelect value={layer.font} onChange={(v) => up("Change font", (l) => void (l.font = v))} />
      <div className="grid2">
        <NumberField label="Size" title="Font size in output pixels" min={4} value={layer.size * W} onChange={(v) => up("Font size", (l) => void (l.size = v / W))} />
        <NumberField label="LH" title="Line height" min={0.6} max={3} step={0.01} digits={2} value={layer.lineHeight} onChange={(v) => up("Line height", (l) => void (l.lineHeight = v))} />
      </div>
      <ColorField label="Colour" value={layer.color} onChange={(c) => up("Text colour", (l) => void (l.color = c))} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Segmented
          label="Horizontal alignment"
          value={layer.align}
          options={[
            { value: "left", label: <AlignLeft aria-label="Left" />, title: "Align left" },
            { value: "center", label: <AlignCenter aria-label="Centre" />, title: "Centre" },
            { value: "right", label: <AlignRight aria-label="Right" />, title: "Align right" },
          ]}
          onChange={(v) => up("Align text", (l) => void (l.align = v))}
        />
        <Segmented
          label="Vertical alignment"
          value={layer.valign}
          options={[
            { value: "top", label: <AlignVerticalJustifyStart aria-label="Top" />, title: "Top" },
            { value: "middle", label: <AlignVerticalJustifyCenter aria-label="Middle" />, title: "Middle" },
            { value: "bottom", label: <AlignVerticalJustifyEnd aria-label="Bottom" />, title: "Bottom" },
          ]}
          onChange={(v) => up("Align text", (l) => void (l.valign = v))}
        />
      </div>
      <Toggle label="Shrink to fit the box" hint="Long translations get smaller instead of overflowing" checked={layer.fit === "shrink"} onChange={(v) => up("Shrink to fit", (l) => void (l.fit = v ? "shrink" : "none"))} />
      <Toggle label="Balance lines" hint="Evens out line lengths so no word sits alone" checked={layer.balance} onChange={(v) => up("Balance lines", (l) => void (l.balance = v))} />
    </>
  );
}

function DeviceFields({ layer }: { layer: DeviceLayer }) {
  const doc = useEditor((s) => s.doc!);
  const assets = useEditor((s) => s.assets);
  const sel = useEditor((s) => s.selection);
  const frameId = typeof layer.frame === "string" ? layer.frame : (layer.frame.android ?? "");
  const frame = CATALOG.find((f) => f.id === frameId);
  const imported = [...assets.keys()].filter((p) => /^frames\/[^/]+\/frame\.json$/.test(p)).map((p) => p.split("/")[1]!);
  const captures = captureList(assets, doc.locales.default);
  const up = (label: string, fn: (l: DeviceLayer) => void) => updateLayer(label, (l) => l.type === "device" && fn(l));
  return (
    <>
      <div className="field">
        <span>Screenshot</span>
        <select
          className="input"
          value={layer.capture}
          aria-label="Screenshot"
          onChange={async (e) => {
            const name = e.target.value;
            if (!name) return up("Remove screenshot", (l) => void (l.capture = ""));
            const bmp = await decodeImage(assets.get(`captures/${doc.locales.default}/${name}`)!);
            setCapture(sel.screen!, sel.layer!, { name, width: bmp.width, height: bmp.height });
          }}
        >
          <option value="">None</option>
          {captures.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Frame</span>
        <select className="input" value={frameId} aria-label="Frame" onChange={(e) => up("Change frame", (l) => ((l.frame = e.target.value), (l.variant = undefined)))}>
          {CATALOG.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          {imported.map((id) => (
            <option key={id} value={id}>
              {id} (imported skin)
            </option>
          ))}
        </select>
      </div>
      {frame && (
        <div className="field">
          <span>Finish</span>
          <div className="chips">
            {Object.entries(frame.variants).map(([name, v]) => (
              <button key={name} type="button" className="chip" aria-pressed={(layer.variant ?? frame.defaultVariant) === name} onClick={() => up("Change finish", (l) => void (l.variant = name))}>
                <i style={{ background: v.body }} />
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      <Toggle label="Drop shadow" checked={layer.shadow} onChange={(v) => up("Drop shadow", (l) => void (l.shadow = v))} />
    </>
  );
}

function ImageFields({ layer }: { layer: ImageLayer }) {
  const target = useTarget()!;
  const up = (label: string, fn: (l: ImageLayer) => void) => updateLayer(label, (l) => l.type === "image" && fn(l));
  return (
    <>
      <p className="hint">{layer.src}</p>
      <Segmented
        label="Fit"
        value={layer.fit}
        options={[
          { value: "contain", label: "Contain" },
          { value: "cover", label: "Cover" },
          { value: "fill", label: "Stretch" },
        ]}
        onChange={(v) => up("Image fit", (l) => void (l.fit = v))}
      />
      <NumberField label="R" title="Corner radius in output pixels" min={0} value={layer.radius * target.size[0]} onChange={(v) => up("Corner radius", (l) => void (l.radius = v / target.size[0]))} />
    </>
  );
}

function ShapeFields({ layer }: { layer: ShapeLayer }) {
  const target = useTarget()!;
  const up = (label: string, fn: (l: ShapeLayer) => void) => updateLayer(label, (l) => l.type === "shape" && fn(l));
  return (
    <>
      <Segmented
        label="Shape"
        value={layer.shape}
        options={[
          { value: "rect", label: "Rectangle" },
          { value: "ellipse", label: "Ellipse" },
        ]}
        onChange={(v) => up("Change shape", (l) => void (l.shape = v))}
      />
      <ColorField label="Colour" value={layer.color} onChange={(c) => up("Shape colour", (l) => void (l.color = c))} />
      {layer.shape === "rect" && (
        <NumberField label="R" title="Corner radius in output pixels" min={0} value={layer.radius * target.size[0]} onChange={(v) => up("Corner radius", (l) => void (l.radius = v / target.size[0]))} />
      )}
    </>
  );
}

