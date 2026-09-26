import type { Ctx } from "./host.ts";

export interface TextLayoutInput {
  text: string;
  family: string;
  /** Requested font size in px. */
  size: number;
  lineHeight: number;
  maxWidth: number;
  maxHeight: number;
  fit: "shrink" | "none";
  /** Evens out line lengths without adding lines, so no word is left alone. */
  balance: boolean;
}

export interface TextLayout {
  size: number;
  lines: Array<{ text: string; width: number }>;
  /** True when the text doesn't fit even at the smallest allowed size. */
  overflow: boolean;
}

/** Smallest size shrink-to-fit will go to, as a fraction of the requested size. */
const MIN_SHRINK = 0.35;

// CJK ideographs, kana and Hangul may break between any two characters.
const BREAK_ANYWHERE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
// Closing punctuation that must not start a line.
const NO_LINE_START = /^[、。，．：；？！）」』】〉》ー…,.;:!?)\]]/;

/** Splits a paragraph into unbreakable tokens, each with the separator that precedes it. */
export function tokenize(paragraph: string): Array<{ sep: string; word: string }> {
  const tokens: Array<{ sep: string; word: string }> = [];
  let sep = "";
  let word = "";
  const flush = () => {
    if (word) tokens.push({ sep, word });
    sep = "";
    word = "";
  };
  for (const ch of paragraph) {
    if (ch === " " || ch === "\t") {
      if (word) flush();
      sep = " ";
    } else if (BREAK_ANYWHERE.test(ch)) {
      if (word) flush();
      word = ch;
      flush();
    } else if (NO_LINE_START.test(ch) && !word && tokens.length > 0 && !sep) {
      // Attach closing punctuation to the previous token.
      tokens[tokens.length - 1]!.word += ch;
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

function fontString(family: string, size: number): string {
  return `${size}px "${family}"`;
}

function breakLines(ctx: Ctx, text: string, maxWidth: number): Array<{ text: string; width: number }> {
  const out: Array<{ text: string; width: number }> = [];
  for (const paragraph of text.split("\n")) {
    const tokens = tokenize(paragraph);
    let line = "";
    for (const { sep, word } of tokens) {
      const candidate = line ? line + sep + word : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        out.push({ text: line, width: ctx.measureText(line).width });
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push({ text: line, width: line ? ctx.measureText(line).width : 0 });
  }
  return out;
}

function fits(lines: Array<{ width: number }>, size: number, input: TextLayoutInput): boolean {
  const height = lines.length * size * input.lineHeight;
  return height <= input.maxHeight + 0.01 && lines.every((l) => l.width <= input.maxWidth + 0.01);
}

/**
 * Greedy line breaking plus shrink-to-fit, done in core rather than left to
 * the platform so wrapping is the same in the editor and in CI. Sizes are
 * searched in 1/4 px steps so results don't depend on float noise.
 */
export function layoutText(ctx: Ctx, input: TextLayoutInput): TextLayout {
  const at = (size: number) => {
    ctx.font = fontString(input.family, size);
    return breakLines(ctx, input.text, input.maxWidth);
  };
  const full = at(input.size);
  if (input.fit === "none" || fits(full, input.size, input)) {
    return { size: input.size, lines: full, overflow: !fits(full, input.size, input) };
  }
  let lo = Math.ceil(input.size * MIN_SHRINK * 4);
  let hi = Math.floor(input.size * 4) - 1;
  const smallest = at(lo / 4);
  if (!fits(smallest, lo / 4, input)) return { size: lo / 4, lines: smallest, overflow: true };
  let best = { size: lo / 4, lines: smallest };
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const lines = at(mid / 4);
    if (fits(lines, mid / 4, input)) {
      best = { size: mid / 4, lines };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  ctx.font = fontString(input.family, best.size);
  return { ...best, overflow: false };
}

/**
 * Finds the narrowest width, in whole pixels, that keeps the same number of
 * lines, then re-breaks at that width. Like CSS `text-wrap: balance`, but
 * computed here so every renderer agrees.
 */
function balanceLines(ctx: Ctx, text: string, lines: TextLayout["lines"], maxWidth: number): TextLayout["lines"] {
  if (lines.length < 2) return lines;
  let lo = Math.ceil(maxWidth / lines.length);
  let hi = Math.floor(maxWidth);
  let best = lines;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const trial = breakLines(ctx, text, mid);
    if (trial.length <= lines.length && trial.every((l) => l.width <= maxWidth + 0.01)) {
      best = trial;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

/** Line breaking, shrink-to-fit, then optional balancing. */
export function layoutTextBlock(ctx: Ctx, input: TextLayoutInput): TextLayout {
  const layout = layoutText(ctx, input);
  if (!input.balance || layout.overflow) return layout;
  ctx.font = fontString(input.family, layout.size);
  return { ...layout, lines: balanceLines(ctx, input.text, layout.lines, input.maxWidth) };
}

export { fontString };
