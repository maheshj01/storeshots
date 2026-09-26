import { z } from "zod";
import { Project, SCHEMA_VERSION } from "./project.ts";
import { migrate } from "./migrations.ts";

export interface Issue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; project: Project; issues: Issue[] }
  | { ok: false; issues: Issue[] };

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

/**
 * Parses a project document: checks the schema version, migrates older
 * versions forward, validates the shape and applies defaults, then checks
 * cross references (theme values, captions, locales).
 */
export function parseProject(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: "", message: "project must be a JSON object" }] };
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, issues: [{ path: "schemaVersion", message: "missing or not an integer" }] };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: "schemaVersion",
          message: `this project uses schema version ${version}, but this version of storeshots reads up to ${SCHEMA_VERSION}. Update storeshots to open it.`,
        },
      ],
    };
  }
  const migrated = migrate(input as Record<string, unknown>, version);
  const result = Project.safeParse(migrated);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
    };
  }
  const issues = checkReferences(result.data);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) return { ok: false, issues: errors };
  return { ok: true, project: result.data, issues: issues.filter((i) => i.severity === "warning") };
}

interface RefIssue extends Issue {
  severity: "error" | "warning";
}

function checkReferences(p: Project): RefIssue[] {
  const issues: RefIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });

  if (!p.locales.list.includes(p.locales.default)) {
    err("locales.default", `default locale "${p.locales.default}" is not in locales.list`);
  }
  const ids = new Set<string>();
  p.targets.forEach((t, i) => {
    if (ids.has(t.id)) err(`targets[${i}].id`, `duplicate target id "${t.id}"`);
    ids.add(t.id);
  });
  const screenIds = new Set<string>();
  const color = (path: string, value: string) => {
    if (value.startsWith("$") && !(value.slice(1) in p.theme.colors)) {
      err(path, `unknown theme colour "${value}"`);
    }
  };
  p.screens.forEach((s, si) => {
    const sp = `screens[${si}]`;
    if (screenIds.has(s.id)) err(`${sp}.id`, `duplicate screen id "${s.id}"`);
    screenIds.add(s.id);
    const bg = s.background;
    if (bg.type === "solid") color(`${sp}.background.color`, bg.color);
    if (bg.type === "linear-gradient") bg.stops.forEach(([c], i) => color(`${sp}.background.stops[${i}]`, c));
    if (bg.type === "image" && bg.color) color(`${sp}.background.color`, bg.color);
    s.layers.forEach((l, li) => {
      const lp = `${sp}.layers[${li}]`;
      if (l.type === "text") {
        color(`${lp}.color`, l.color);
        if (l.font.startsWith("$") && !(l.font.slice(1) in p.theme.fonts)) {
          err(`${lp}.font`, `unknown theme font "${l.font}"`);
        }
        const key = captionKey(l.text);
        if (key !== null) {
          const entry = p.captions[key];
          if (!entry) err(`${lp}.text`, `unknown caption "${key}"`);
          else
            for (const loc of p.locales.list) {
              if (!(loc in entry)) warn(`captions.${key}`, `no "${loc}" text; falls back to "${p.locales.default}"`);
            }
        }
      }
      if (l.type === "shape") color(`${lp}.color`, l.color);
    });
  });
  return issues;
}

/** Returns the caption key for `@caption.key`, or null for literal text. */
export function captionKey(text: string): string | null {
  return text.startsWith("@caption.") ? text.slice("@caption.".length) : null;
}

/** JSON Schema for editors and external tooling. */
export function projectJsonSchema(): unknown {
  return z.toJSONSchema(Project, { io: "input" });
}
