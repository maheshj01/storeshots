# ADR 0002: Render parity, browser versus Node

Status: accepted for phase 0, revisit before the phase 2 CLI release

## Context

The pitch is "what you see in the editor is what CI produces". ADR 0001 left
one question for a phase 0 spike: is Skia in Node (`@napi-rs/canvas`) close
enough to the browser's canvas, or must the CLI render through headless
Chromium?

## What was measured

`tools/parity` renders the epoch fixture (4 screens, en and de, 1080×1920)
in Chromium 152 on macOS and compares every pixel with the Node render
(`@napi-rs/canvas` 0.1.100, same machine). Differences are the largest
per-channel difference per pixel, out of 255.

| Stage | Pixels off by more than 8 | Off by more than 32 | Mean difference |
|---|---|---|---|
| First run, canvas `shadowBlur` | 3.0 to 3.9% | 0.3 to 0.7% | 1.0 to 1.4 |
| Shadows computed in core | 0.6 to 1.0% | 0.3 to 0.7% | 0.4 to 0.9 |

Findings:

1. **Layout is identical.** Text widths differ by 0.1 to 0.3 px over about
   1000 px, and every line break and shrink-to-fit size matched in all 8
   images. Vertical metrics come from the font file (`fontmetrics.ts`), not
   the engine.
2. **`shadowBlur` is not portable.** The same value gives a visibly wider
   falloff in Node. Shadows are now blurred in core with integer box blurs
   (`shadow.ts`), which removed three quarters of the difference.
3. **What's left is glyph anti-aliasing.** 70 to 80% of the remaining
   pixels are on glyph edges: same positions, a few levels of coverage
   apart. The rest is image resampling on capture edges. None of it is
   visible at 1:1.
4. **GPU versus software canvas made no difference** in Chromium.

## Decision

- **Keep Skia in Node for the CLI.** No headless Chromium. Layout parity,
  which is what users would notice, is exact on this fixture.
- **Golden tests compare Node against Node** with a tolerance of 0.1% of
  pixels beyond 8/255, so they catch real changes. The browser parity page
  is a manual check for now, and should become a Playwright job in CI
  before the phase 2 CLI release.
- **Never use canvas features whose output is implementation defined**
  (`shadowBlur`, `filter`, `textBaseline` metrics, `letterSpacing`) in the
  renderer. Do the work in core.

## Revisit if

- A line break or shrink size ever differs between editor and CLI. Line
  breaking depends on `measureText` agreeing to well under a pixel. If it
  doesn't, the fix is to shape text in core (harfbuzzjs, WebAssembly, about
  600 KB) and fill glyph outlines as paths. That also makes glyph
  anti-aliasing identical, because path fills already match closely.
- Linux CI renders differ from macOS beyond the golden tolerance. This
  hasn't been measured yet: there's no CI run.
