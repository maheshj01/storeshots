import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Copy, Trash2, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Plus } from "lucide-react";
import type { Background, DeviceLayer, ImageLayer, Layer, ShapeLayer, TextLayer } from "@storeshots/schema";
import { CATALOG } from "@storeshots/frames";
import { selectedLayerRefs, selectedScreenIds, useEditor, useSelectedScreen, useTarget } from "../state/store.ts";
import {
  addFont, addThemeColor, captureList, deleteThemeColor, renameScreen, renameThemeColor, deleteLayer, duplicateLayer, ensureFonts, layerText, moveLayerTo, setCapture, setLayerText, switchTemplate, updateBackground, updateLayer,
} from "../state/actions.ts";
import { BUNDLED_FONTS, TEMPLATES, themeColorUses } from "@storeshots/ops";
import { decodeImage } from "../engine/host.ts";
import { DeviceExport } from "./DeviceExport.tsx";
import { ColorField, NumberField, Section, Segmented, TextInput, Toggle, useResolvedColor } from "./fields.tsx";

/** A value shared by every selected item, or `mixed` (showing the primary's) when they differ. */
function common<T, V>(items: T[], get: (t: T) => V): { value: V; mixed: boolean } {
  const value = get(items[0]!);
  const key = JSON.stringify(value);
  return { value, mixed: items.some((t) => JSON.stringify(get(t)) !== key) };
}

const PLURAL = { text: "text layers", device: "devices", image: "images", shape: "shapes" } as const;

/**
 * Settings for what's selected, and only that: the selected layers, the
 * selected screens, or with nothing selected, the whole project. With
 * several items selected, it shows the settings they all have and changes
 * them all together.
 */
export function Inspector() {
  const doc = useEditor((s) => s.doc!);
  const selection = useEditor((s) => s.selection);
  const layerRefs = selectedLayerRefs(selection);
  const layers = layerRefs.map((r) => doc.screens.find((s) => s.id === r.screen)?.layers[r.layer]).filter((l): l is Layer => !!l);
  const screenIds = selectedScreenIds(selection).filter((id) => doc.screens.some((s) => s.id === id));
  return (
    <aside className="panel right" aria-label="Inspector">
      {layers.length ? (
        <LayerInspector layers={layers} key={layerRefs.map((r) => `${r.screen}:${r.layer}`).join(",")} />
      ) : screenIds.length ? (
        <ScreenInspector ids={screenIds} />
      ) : (
        <ProjectInspector />
      )}
    </aside>
  );
}

function ProjectInspector() {
  return (
    <>
      <Section title="Project">
        <p className="hint">Select a screen or a layer to edit it. Shift-click to select several.</p>
      </Section>
      <ThemeColors />
      <Section title="Style every screen">
        <TemplateSelect onPick={(id) => void switchTemplate(id)} label="Apply a template to every screen" />
        <p className="hint">Re-lays out every screen and sets the theme. Captions and screenshots stay.</p>
      </Section>
    </>
  );
}

function TemplateSelect({ onPick, label }: { onPick: (id: string) => void; label: string }) {
  return (
    <select className="input" value="" onChange={(e) => e.target.value && onPick(e.target.value)} aria-label={label}>
      <option value="">Choose a layout…</option>
      {TEMPLATES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}: {t.blurb}
        </option>
      ))}
    </select>
  );
}

function ScreenInspector({ ids }: { ids: string[] }) {
  const doc = useEditor((s) => s.doc!);
  const screens = ids.map((id) => doc.screens.find((s) => s.id === id)!);
  const one = screens.length === 1;
  const edit = updateBackground;
  const bgs = screens.map((s) => s.background as Background);
  const bg = bgs[0]!;
  const type = common(bgs, (b) => (b.type === "image" ? "solid" : b.type));
  const first = (b: Background) => (b.type === "solid" ? b.color : b.type === "linear-gradient" ? b.stops[0]![0] : (b.color ?? "#FFFFFF"));
  const numbers = screens.map((s) => doc.screens.indexOf(s) + 1);

  return (
    <>
      <Section title={one ? `Screen ${numbers[0]}` : `${screens.length} screens`}>
        {one && <ScreenNameField id={screens[0]!.id} />}
        <p className="hint">{one ? "Shift-click other screens to edit them together." : `Screens ${numbers.join(", ")}. Changes apply to all of them.`}</p>
      </Section>
      <Section title="Background">
        <Segmented
          label="Background type"
          value={type.mixed ? null : type.value}
          options={[
            { value: "solid", label: "Solid" },
            { value: "linear-gradient", label: "Gradient" },
          ]}
          onChange={(v) =>
            edit("Background type", (b) =>
              v === "solid"
                ? { type: "solid", color: first(b) }
                : b.type === "linear-gradient"
                  ? b
                  : { type: "linear-gradient", angle: 180, stops: [[first(b), 0], ["#FFFFFF", 1]] },
            )
          }
        />
        {!type.mixed && bg.type === "solid" && (
          <ColorField label="Colour" {...common(bgs, first)} onChange={(c) => edit("Background colour", () => ({ type: "solid", color: c }))} />
        )}
        {!type.mixed && bg.type === "linear-gradient" && (
          <GradientFields bgs={bgs as Array<Extract<Background, { type: "linear-gradient" }>>} />
        )}
      </Section>
      <Section title="Layout">
        <TemplateSelect onPick={(id) => void switchTemplate(id, ids)} label={one ? "Change this screen's layout" : "Change these screens' layout"} />
        <p className="hint">Re-lays out {one ? "this screen" : "these screens"} only. Captions and screenshots stay.</p>
      </Section>
    </>
  );
}

function ScreenNameField({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="field">
      <span>Name</span>
      <TextInput className="input mono" aria-label="Screen name" value={id} onCommit={(v) => setError(v.trim() ? renameScreen(id, v) : null)} />
      <small className={error ? "bad" : "hint"}>{error ?? "How you and your AI agent refer to this screen; also names its exported file."}</small>
    </label>
  );
}

function GradientFields({ bgs }: { bgs: Array<Extract<Background, { type: "linear-gradient" }>> }) {
  type G = (typeof bgs)[number];
  const edit = (label: string, fn: (g: G) => G) => updateBackground(label, (b) => (b.type === "linear-gradient" ? fn(b) : b));
  const angle = common(bgs, (g) => Math.round(g.angle));
  return (
    <>
      <ColorField label="From" {...common(bgs, (g) => g.stops[0]![0])} onChange={(c) => edit("Gradient start", (g) => ({ ...g, stops: [[c, 0], ...g.stops.slice(1)] }))} />
      <ColorField
        label="To"
        {...common(bgs, (g) => g.stops[g.stops.length - 1]![0])}
        onChange={(c) => edit("Gradient end", (g) => ({ ...g, stops: [...g.stops.slice(0, -1), [c, 1]] }))}
      />
      <div className="field">
        <span>Angle {angle.mixed ? "(mixed)" : `${angle.value}°`}</span>
        <input type="range" min={0} max={360} value={angle.value} onChange={(e) => edit("Gradient angle", (g) => ({ ...g, angle: +e.target.value }))} aria-label="Gradient angle" />
      </div>
    </>
  );
}

/**
 * The project's theme colours: its design system. Backgrounds and layers
 * link to them by name (shown as $name in storeshots.json), so changing one
 * here restyles everything that uses it.
 */
function ThemeColors() {
  const colors = useEditor((s) => s.doc!.theme.colors);
  const doc = useEditor((s) => s.doc!);
  return (
    <Section
      title="Theme colours"
      action={
        <button type="button" className="btn ghost icon" title="Add a theme colour" aria-label="Add a theme colour" onClick={() => addThemeColor()}>
          <Plus aria-hidden />
        </button>
      }
    >
      <p className="hint">Your design system's named colours. Backgrounds and layers can use them by name; change one here and everything using it updates.</p>
      {Object.entries(colors).map(([name, value]) => (
        <ThemeColorRow key={name} name={name} value={value} uses={themeColorUses(doc, name)} />
      ))}
    </Section>
  );
}

function ThemeColorRow({ name, value, uses }: { name: string; value: string; uses: number }) {
  const resolved = useResolvedColor(value);
  const [error, setError] = useState<string | null>(null);
  const set = (v: string) => {
    if (v === `$${name}`) return;
    useEditor.getState().edit(`Theme colour ${name}`, (d) => {
      d.theme.colors[name] = v;
    }, `theme:${name}`);
  };
  return (
    <div className="theme-row">
      <label className="swatch" title="Pick a colour">
        <i style={{ background: resolved }} />
        <input type="color" value={resolved.slice(0, 7)} onChange={(e) => set(e.target.value.toUpperCase() + (resolved.length === 9 ? resolved.slice(7) : ""))} />
      </label>
      <TextInput
        aria-label={`Name of the theme colour ${name}`}
        value={name}
        onCommit={(v) => setError(renameThemeColor(name, v.trim()))}
      />
      <TextInput
        className="input mono"
        aria-label={`${name} hex`}
        value={value}
        onCommit={(v) => /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|\$[A-Za-z][\w-]*)$/i.test(v.trim()) && set(v.trim())}
      />
      <button
        type="button"
        className="btn ghost icon danger"
        title={uses ? `Remove (the ${uses} ${uses === 1 ? "place" : "places"} using it keep this colour, unlinked)` : "Remove"}
        aria-label={`Remove the theme colour ${name}`}
        disabled={name === "brand"}
        onClick={() => deleteThemeColor(name)}
      >
        <Trash2 aria-hidden />
      </button>
      {error ? <small className="bad">{error}</small> : <small>{uses ? `Used in ${uses} ${uses === 1 ? "place" : "places"}` : "Not used yet"}</small>}
    </div>
  );
}

function LayerInspector({ layers }: { layers: Layer[] }) {
  const target = useTarget()!;
  const [W, H] = target.size;
  const sel = useEditor((s) => s.selection);
  const single = layers.length === 1;
  const layer = layers[0]!;
  const count = useSelectedScreen()!.layers.length;
  const index = sel.layer!;
  const up = (label: string, fn: (l: Layer) => void) => updateLayer(label, fn);
  const type = common(layers, (l) => l.type);
  const title = single ? { text: "Text", device: "Device", image: "Image", shape: "Shape" }[layer.type] : `${layers.length} ${type.mixed ? "layers" : PLURAL[layer.type]}`;
  const restack = (to: number) => moveLayerTo(sel.screen!, index, to);
  const box = (k: "x" | "y" | "w" | "h") => common(layers, (l) => l.box[k]);
  const x = box("x");
  const y = box("y");
  const w = box("w");
  const h = box("h");
  const rotate = common(layers, (l) => l.rotate);
  const opacity = common(layers, (l) => l.opacity);
  return (
    <>
      <Section
        title={title}
        action={
          <span className="row" style={{ gap: 0 }}>
            {single && (
              <button type="button" className="btn ghost icon" title="Duplicate (⌘D)" onClick={duplicateLayer}>
                <Copy aria-hidden />
              </button>
            )}
            <button type="button" className="btn ghost icon danger" title="Delete (⌫)" onClick={deleteLayer}>
              <Trash2 aria-hidden />
            </button>
          </span>
        }
      >
        {!single && <p className="hint">{type.mixed ? "Different kinds of layer: only the settings they share are shown." : "Changes apply to all of them."}</p>}
        {!type.mixed && layer.type === "text" && <TextFields layers={layers as TextLayer[]} />}
        {!type.mixed && layer.type === "device" && <DeviceFields layers={layers as DeviceLayer[]} />}
        {!type.mixed && layer.type === "image" && <ImageFields layers={layers as ImageLayer[]} />}
        {!type.mixed && layer.type === "shape" && <ShapeFields layers={layers as ShapeLayer[]} />}
      </Section>
      {single && (
        <Section title="Stacking" action={<span className="label">layer {index + 1} of {count}, from the bottom</span>}>
          <div className="seg stack" role="group" aria-label="Stacking order">
            <button type="button" title="Send to back (⇧⌘[)" disabled={index === 0} onClick={() => restack(0)}>
              <ChevronsDown aria-hidden /> Back
            </button>
            <button type="button" title="Send backward (⌘[)" disabled={index === 0} onClick={() => restack(index - 1)}>
              <ChevronDown aria-hidden /> Backward
            </button>
            <button type="button" title="Bring forward (⌘])" disabled={index === count - 1} onClick={() => restack(index + 1)}>
              <ChevronUp aria-hidden /> Forward
            </button>
            <button type="button" title="Bring to front (⇧⌘])" disabled={index === count - 1} onClick={() => restack(count - 1)}>
              <ChevronsUp aria-hidden /> Front
            </button>
          </div>
        </Section>
      )}
      <Section title="Position">
        <div className="grid2">
          <NumberField label="X" title="Left, in output pixels" value={x.value * W} mixed={x.mixed} onChange={(v) => up("Move layer", (l) => void (l.box.x = v / W))} />
          <NumberField label="Y" title="Top, in output pixels" value={y.value * H} mixed={y.mixed} onChange={(v) => up("Move layer", (l) => void (l.box.y = v / H))} />
          <NumberField label="W" title="Width, in output pixels" min={8} value={w.value * W} mixed={w.mixed} onChange={(v) => up("Resize layer", (l) => void (l.box.w = v / W))} />
          <NumberField label="H" title="Height, in output pixels" min={8} value={h.value * H} mixed={h.mixed} onChange={(v) => up("Resize layer", (l) => void (l.box.h = v / H))} />
          <NumberField label="°" title="Rotation in degrees" min={-180} max={180} digits={1} step={0.5} value={rotate.value} mixed={rotate.mixed} onChange={(v) => up("Rotate layer", (l) => void (l.rotate = v))} />
          <NumberField label="%" title="Opacity" min={0} max={100} value={opacity.value * 100} mixed={opacity.mixed} onChange={(v) => up("Opacity", (l) => void (l.opacity = v / 100))} />
        </div>
      </Section>
      {single && layer.type === "device" && <DeviceExport screen={sel.screen!} layer={index} />}
    </>
  );
}

function FontSelect({ value, onChange, mixed }: { value: string; onChange: (v: string) => void; mixed?: boolean }) {
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
        value={mixed ? "" : value}
        aria-label="Font"
        onChange={async (e) => {
          const v = e.target.value;
          if (v === "__upload") return upload.current?.click();
          if (v.startsWith("bundled:")) {
            const file = v.slice(8);
            await ensureFonts([file]);
            return onChange(`fonts/${file}`);
          }
          if (v) onChange(v);
        }}
      >
        {mixed && <option value="">Mixed</option>}
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

function TextFields({ layers }: { layers: TextLayer[] }) {
  const doc = useEditor((s) => s.doc!);
  const locale = useEditor((s) => s.locale);
  const sel = useEditor((s) => s.selection);
  const target = useTarget()!;
  const layer = layers[0]!;
  const single = layers.length === 1;
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
  const c = <V,>(get: (l: TextLayer) => V) => common(layers, get);
  const size = c((l) => l.size);
  const lh = c((l) => l.lineHeight);
  const align = c((l) => l.align);
  const valign = c((l) => l.valign);
  const fit = c((l) => l.fit === "shrink");
  const balance = c((l) => l.balance);
  return (
    <>
      {/* Each layer has its own words, so they're only edited one at a time. */}
      {single && (
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
      )}
      <FontSelect {...c((l) => l.font)} onChange={(v) => up("Change font", (l) => void (l.font = v))} />
      <div className="grid2">
        <NumberField label="Size" title="Font size in output pixels" min={4} value={size.value * W} mixed={size.mixed} onChange={(v) => up("Font size", (l) => void (l.size = v / W))} />
        <NumberField label="LH" title="Line height" min={0.6} max={3} step={0.01} digits={2} value={lh.value} mixed={lh.mixed} onChange={(v) => up("Line height", (l) => void (l.lineHeight = v))} />
      </div>
      <ColorField label="Colour" {...c((l) => l.color)} onChange={(v) => up("Text colour", (l) => void (l.color = v))} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Segmented
          label="Horizontal alignment"
          value={align.mixed ? null : align.value}
          options={[
            { value: "left", label: <AlignLeft aria-label="Left" />, title: "Align left" },
            { value: "center", label: <AlignCenter aria-label="Centre" />, title: "Centre" },
            { value: "right", label: <AlignRight aria-label="Right" />, title: "Align right" },
          ]}
          onChange={(v) => up("Align text", (l) => void (l.align = v))}
        />
        <Segmented
          label="Vertical alignment"
          value={valign.mixed ? null : valign.value}
          options={[
            { value: "top", label: <AlignVerticalJustifyStart aria-label="Top" />, title: "Top" },
            { value: "middle", label: <AlignVerticalJustifyCenter aria-label="Middle" />, title: "Middle" },
            { value: "bottom", label: <AlignVerticalJustifyEnd aria-label="Bottom" />, title: "Bottom" },
          ]}
          onChange={(v) => up("Align text", (l) => void (l.valign = v))}
        />
      </div>
      <Toggle label="Shrink to fit the box" hint="Long translations get smaller instead of overflowing" checked={fit.value} mixed={fit.mixed} onChange={(v) => up("Shrink to fit", (l) => void (l.fit = v ? "shrink" : "none"))} />
      <Toggle label="Balance lines" hint="Evens out line lengths so no word sits alone" checked={balance.value} mixed={balance.mixed} onChange={(v) => up("Balance lines", (l) => void (l.balance = v))} />
    </>
  );
}

const frameIdOf = (l: DeviceLayer) => (typeof l.frame === "string" ? l.frame : (l.frame.android ?? ""));

function DeviceFields({ layers }: { layers: DeviceLayer[] }) {
  const doc = useEditor((s) => s.doc!);
  const assets = useEditor((s) => s.assets);
  const sel = useEditor((s) => s.selection);
  const layer = layers[0]!;
  const single = layers.length === 1;
  const frameId = common(layers, frameIdOf);
  const frame = frameId.mixed ? undefined : CATALOG.find((f) => f.id === frameId.value);
  const finish = common(layers, (l) => l.variant ?? frame?.defaultVariant);
  const shadow = common(layers, (l) => l.shadow);
  const imported = [...assets.keys()].filter((p) => /^frames\/[^/]+\/frame\.json$/.test(p)).map((p) => p.split("/")[1]!);
  const captures = captureList(assets, doc.locales.default);
  const up = (label: string, fn: (l: DeviceLayer) => void) => updateLayer(label, (l) => l.type === "device" && fn(l));
  return (
    <>
      {/* Each device shows its own screenshot, so it's only chosen one at a time. */}
      {single && (
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
      )}
      <div className="field">
        <span>Frame</span>
        <select
          className="input"
          value={frameId.mixed ? "" : frameId.value}
          aria-label="Frame"
          onChange={(e) => e.target.value && up("Change frame", (l) => ((l.frame = e.target.value), (l.variant = undefined)))}
        >
          {frameId.mixed && <option value="">Mixed</option>}
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
      {/* Finishes belong to a frame, so they're offered only when every device has the same one. */}
      {frame && (
        <div className="field">
          <span>Finish</span>
          <div className="chips">
            {Object.entries(frame.variants).map(([name, v]) => (
              <button key={name} type="button" className="chip" aria-pressed={!finish.mixed && finish.value === name} onClick={() => up("Change finish", (l) => void (l.variant = name))}>
                <i style={{ background: v.body }} />
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      <Toggle label="Drop shadow" checked={shadow.value} mixed={shadow.mixed} onChange={(v) => up("Drop shadow", (l) => void (l.shadow = v))} />
    </>
  );
}

function ImageFields({ layers }: { layers: ImageLayer[] }) {
  const target = useTarget()!;
  const up = (label: string, fn: (l: ImageLayer) => void) => updateLayer(label, (l) => l.type === "image" && fn(l));
  const fit = common(layers, (l) => l.fit);
  const radius = common(layers, (l) => l.radius);
  return (
    <>
      {layers.length === 1 && <p className="hint">{layers[0]!.src}</p>}
      <Segmented
        label="Fit"
        value={fit.mixed ? null : fit.value}
        options={[
          { value: "contain", label: "Contain" },
          { value: "cover", label: "Cover" },
          { value: "fill", label: "Stretch" },
        ]}
        onChange={(v) => up("Image fit", (l) => void (l.fit = v))}
      />
      <NumberField label="R" title="Corner radius in output pixels" min={0} value={radius.value * target.size[0]} mixed={radius.mixed} onChange={(v) => up("Corner radius", (l) => void (l.radius = v / target.size[0]))} />
    </>
  );
}

function ShapeFields({ layers }: { layers: ShapeLayer[] }) {
  const target = useTarget()!;
  const up = (label: string, fn: (l: ShapeLayer) => void) => updateLayer(label, (l) => l.type === "shape" && fn(l));
  const shape = common(layers, (l) => l.shape);
  const radius = common(layers, (l) => l.radius);
  return (
    <>
      <Segmented
        label="Shape"
        value={shape.mixed ? null : shape.value}
        options={[
          { value: "rect", label: "Rectangle" },
          { value: "ellipse", label: "Ellipse" },
        ]}
        onChange={(v) => up("Change shape", (l) => void (l.shape = v))}
      />
      <ColorField label="Colour" {...common(layers, (l) => l.color)} onChange={(v) => up("Shape colour", (l) => void (l.color = v))} />
      {/* Only rectangles have corners. */}
      {!shape.mixed && shape.value === "rect" && (
        <NumberField label="R" title="Corner radius in output pixels" min={0} value={radius.value * target.size[0]} mixed={radius.mixed} onChange={(v) => up("Corner radius", (l) => void (l.radius = v / target.size[0]))} />
      )}
    </>
  );
}
