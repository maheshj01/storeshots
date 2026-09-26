import type { Project } from "./project.ts";
import { captionKey } from "./parse.ts";

/** Resolves a `$theme` colour, or returns the literal. */
export function resolveColor(project: Project, value: string): string {
  if (!value.startsWith("$")) return value;
  const v = project.theme.colors[value.slice(1)];
  if (v === undefined) throw new Error(`unknown theme colour ${value}`);
  return resolveColor(project, v);
}

/** Resolves a `$theme` font to its project-relative path. */
export function resolveFont(project: Project, value: string): string {
  if (!value.startsWith("$")) return value;
  const v = project.theme.fonts[value.slice(1)];
  if (v === undefined) throw new Error(`unknown theme font ${value}`);
  return v;
}

/** Resolves `@caption.key` for a locale, falling back to the default locale. */
export function resolveText(project: Project, text: string, locale: string): string {
  const key = captionKey(text);
  if (key === null) return text;
  const entry = project.captions[key];
  if (!entry) throw new Error(`unknown caption ${key}`);
  return entry[locale] ?? entry[project.locales.default] ?? "";
}

/** Locale fallback chain for captures: the locale, its base language, then the default. */
export function localeChain(project: Project, locale: string): string[] {
  const chain = [locale];
  const base = locale.split(/[-_]/)[0]!;
  if (base !== locale) chain.push(base);
  if (!chain.includes(project.locales.default)) chain.push(project.locales.default);
  return chain;
}
