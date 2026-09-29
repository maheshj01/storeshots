import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { useEditor } from "../state/store.ts";

/** A text input that commits on blur or Enter, so typing isn't one undo step per key. */
export function TextInput(props: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => draft !== props.value && props.onCommit(draft);
  return (
    <input
      className={props.className ?? "input"}
      value={draft}
      placeholder={props.placeholder}
      aria-label={props["aria-label"]}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(props.value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/**
 * A number field whose label can be dragged left and right to scrub the
 * value, like design tools. Scrubbing is one undo step.
 */
export function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  title?: string;
  /** The selected layers differ here: the field shows "Mixed" and sets them all when changed. */
  mixed?: boolean;
}) {
  const { step = 1, digits = 0 } = props;
  const shown = props.mixed ? "" : props.value.toFixed(digits);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);
  const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
  const scrub = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const start = props.value;
    const { beginGesture, endGesture } = useEditor.getState();
    beginGesture(`Change ${props.label}`);
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : 1;
      props.onChange(clamp(+(start + Math.round((ev.clientX - startX) / 2) * step * k).toFixed(digits + 2)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <label className="num" title={props.title} style={{ "--pad": `${14 + props.label.length * 7}px` } as React.CSSProperties}>
      <b onPointerDown={scrub} aria-hidden>
        {props.label}
      </b>
      <input
        className="input"
        inputMode="decimal"
        aria-label={props.title ?? props.label}
        value={draft}
        placeholder={props.mixed ? "Mixed" : undefined}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const v = parseFloat(draft);
          if (Number.isFinite(v) && (props.mixed || v !== props.value)) props.onChange(clamp(v));
          else setDraft(shown);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            props.onChange(clamp(+(props.value + step * k).toFixed(digits + 2)));
          }
        }}
      />
    </label>
  );
}

export function Segmented<T extends string>(props: {
  /** null when the selected items differ: nothing is shown as chosen. */
  value: T | null;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === props.value} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; mixed?: boolean }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = !!props.mixed;
  }, [props.mixed]);
  return (
    <label className="toggle" title={props.hint}>
      <span>{props.label}</span>
      <input ref={box} type="checkbox" checked={props.mixed ? false : props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

/** Resolves `$theme` colours for display. */
export function useResolvedColor(value: string): string {
  const colors = useEditor((s) => s.doc?.theme.colors ?? {});
  let v = value;
  for (let i = 0; i < 5 && v.startsWith("$"); i++) v = colors[v.slice(1)] ?? "#000000";
  return v;
}

/** Opens the project's theme colours in the inspector (by selecting nothing). */
export function showThemeColors() {
  useEditor.getState().select({ screen: null, layer: null });
}

/**
 * A colour: a swatch that opens the system picker, and either a hex field
 * or, when it uses a theme colour, that colour's name. Theme colours are the
 * project's named colours (its design system): choosing one from the chips
 * links to it, so changing the theme colour later changes this too.
 */
export function ColorField(props: { label: string; value: string; onChange: (v: string) => void; mixed?: boolean }) {
  const colors = useEditor((s) => s.doc?.theme.colors ?? {});
  const resolved = useResolvedColor(props.value);
  const hex6 = resolved.slice(0, 7);
  const alpha = resolved.length === 9 ? resolved.slice(7) : "";
  const linked = !props.mixed && props.value.startsWith("$") ? props.value.slice(1) : null;
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="color">
        <label className="swatch" title={linked ? `Pick a colour (stops using the theme colour ${linked})` : "Pick a colour"}>
          <i style={{ background: resolved }} />
          <input
            type="color"
            value={hex6.length === 7 ? hex6 : "#000000"}
            onChange={(e) => props.onChange(e.target.value.toUpperCase() + alpha)}
          />
        </label>
        {linked ? (
          <div className="linked" title={`Uses the theme colour "${linked}". Change it under Theme colours and everything using it updates.`}>
            <Link2 aria-hidden />
            <b>{linked}</b>
            <span className="mono">{resolved}</span>
            <button type="button" className="btn ghost" onClick={() => props.onChange(resolved)} title="Use this colour as a plain value, not linked to the theme">
              Unlink
            </button>
          </div>
        ) : (
          <TextInput
            className="input mono"
            aria-label={`${props.label} hex`}
            value={props.mixed ? "" : props.value}
            placeholder={props.mixed ? "Mixed" : undefined}
            onCommit={(v) => {
              const t = v.trim();
              if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || (t.startsWith("$") && t.slice(1) in colors)) props.onChange(t);
            }}
          />
        )}
      </div>
      {Object.keys(colors).length > 0 && (
        <div className="chips" aria-label="Theme colours">
          {Object.entries(colors).map(([name, c]) => (
            <button key={name} type="button" className="chip" aria-pressed={linked === name} onClick={() => props.onChange(`$${name}`)} title={`Use the theme colour ${name}`}>
              <ThemeDot value={c} />
              {name}
            </button>
          ))}
          <button type="button" className="chip link" onClick={showThemeColors} title="Add, rename or change the project's theme colours">
            Edit theme…
          </button>
        </div>
      )}
    </div>
  );
}

function ThemeDot({ value }: { value: string }) {
  const resolved = useResolvedColor(value);
  return <i style={{ background: resolved }} />;
}

export function Section(props: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="section">
      <h3>
        {props.title}
        {props.action}
      </h3>
      {props.children}
    </section>
  );
}
