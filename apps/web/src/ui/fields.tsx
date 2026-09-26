import { useEffect, useRef, useState, type ReactNode } from "react";
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
}) {
  const { step = 1, digits = 0 } = props;
  const [draft, setDraft] = useState(props.value.toFixed(digits));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(props.value.toFixed(digits));
  }, [props.value, digits]);
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
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const v = parseFloat(draft);
          if (Number.isFinite(v) && v !== props.value) props.onChange(clamp(v));
          else setDraft(props.value.toFixed(digits));
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
  value: T;
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

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={props.hint}>
      <span>{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
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

/**
 * A colour: a swatch that opens the system picker, a hex field, and chips
 * for theme colours. Choosing a chip stores the `$name` reference, so later
 * theme edits flow through.
 */
export function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  const colors = useEditor((s) => s.doc?.theme.colors ?? {});
  const resolved = useResolvedColor(props.value);
  const hex6 = resolved.slice(0, 7);
  const alpha = resolved.length === 9 ? resolved.slice(7) : "";
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="color">
        <label className="swatch" title="Pick a colour">
          <i style={{ background: resolved }} />
          <input
            type="color"
            value={hex6.length === 7 ? hex6 : "#000000"}
            onChange={(e) => props.onChange(e.target.value.toUpperCase() + alpha)}
          />
        </label>
        <TextInput
          className="input mono"
          aria-label={`${props.label} hex`}
          value={props.value}
          onCommit={(v) => {
            const t = v.trim();
            if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || (t.startsWith("$") && t.slice(1) in colors)) props.onChange(t);
          }}
        />
      </div>
      {Object.keys(colors).length > 0 && (
        <div className="chips">
          {Object.entries(colors).map(([name, c]) => (
            <button key={name} type="button" className="chip" aria-pressed={props.value === `$${name}`} onClick={() => props.onChange(`$${name}`)} title={`${name} ${c}`}>
              <ThemeDot value={c} />
              {name}
            </button>
          ))}
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
