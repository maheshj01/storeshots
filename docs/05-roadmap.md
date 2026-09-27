# 05 Roadmap

Durations assume one experienced full-time developer. Each phase ends with
something a real user can use; epoch is the first dogfood project.

## Phase 0: Foundations (about 2 weeks) — built, September 2026

Done: everything below. The parity result is in ADR 0002. Differences from
the plan: frames are parametric data drawn with canvas paths, not SVG files,
so no SVG rasterizer is needed in either environment; the CLI already has
`render`, `validate` and `frames`, ahead of phase 2. Not done: lint config,
and a browser parity job in CI (the parity page is manual for now).

Prove the risky parts before building UI.

- Monorepo, CI, lint, test setup.
- `packages/schema`: JSON Schema v1, validation, migration scaffolding.
- `packages/core`: render background, image, text and device layers to a
  canvas; export PNG without alpha.
- **Parity spike:** render the same project in Chromium and in Node with
  `@napi-rs/canvas`; measure pixel difference, especially text. Decide
  Skia-in-Node versus headless Chromium for the CLI.
- Frame format and three vector frames (a current Pixel, an older Pixel, a
  generic Android), plus the SDK emulator skin importer.
- `packages/stores` with the rules in doc 04 and tests.

Exit: a script renders epoch's screenshots into framed, store-valid images
from a hand-written `storeshots.json`, identically in Node and Chromium.

## Phase 1: Editor MVP, Android first (about 5 to 6 weeks) — built, September 2026

Done: everything below, in `apps/web`. How it differs from the plan:

- Storage is IndexedDB only (projects, files and thumbnails); OPFS wasn't
  needed.
- Text is edited in the inspector (double-click or Enter on the canvas
  focuses it), not inline on the canvas.
- Snapping guides apply while moving. Resizing doesn't snap yet.
- The editor is verified with unit tests of the store, actions and
  templates, plus manual checks in Chromium: drop captures, drag, resize,
  rotate, undo, export in the worker, zip round trip, offline reload, and a
  project saved by the editor rendered by the CLI.
- Not done: Playwright end-to-end tests, and testing Open folder, which
  needs a real folder picker.

The two features from the original brief, done properly.

- Upload captures (drag and drop, multiple files), stored locally.
- Frame picker: browse the catalog with thumbnails, apply a frame to any
  capture, colour variants.
- Canvas editor on Play targets: solid and gradient backgrounds, text layers
  with font, size, colour, alignment and auto-fit, device layer move, scale
  and rotate, snapping guides, undo and redo.
- Screen strip with add, duplicate, reorder, delete; "apply layout to all".
- Export: one screen or all, PNG or JPEG, zipped, with rule validation.
- Local-first persistence (OPFS and IndexedDB), offline PWA, project
  import and export as a folder or zip. On Chromium, open a folder in a repo.
- A handful of starter templates that look genuinely good.

Exit: a developer with no design skills produces a promotion-eligible Play
set of 4 to 8 screens in under 10 minutes, and it re-opens exactly.

## Phase 2: The differentiators (about 4 to 5 weeks)

- `storeshots` CLI: init, render, validate, frames; npm package; GitHub
  Actions example; fastlane-compatible output.
- Localization: caption keys, per-locale values, ARB, JSON and CSV import,
  locale switcher in the editor, per-locale capture folders, render all
  locales in one command. Right-to-left and CJK tested.
- Theme tokens (colours, fonts) and linked styles across screens.
- Epoch's `make capture-screens` pipeline ends with `storeshots render`.

Exit: changing one caption or replacing captures and running one command
regenerates every screen in every locale, identically to the editor.

## Phase 3: iOS and breadth (about 4 to 6 weeks)

- App Store targets (6.9 inch iPhone, 13 inch iPad), iPhone and iPad vector
  frames, per-platform frames on one design.
- Play tablet, Chromebook and feature graphic targets.
- Panoramic backgrounds across screens, simple 3D tilt.
- Desktop shell with Tauri **only if** a trigger in ADR 0001 has fired,
  adding device capture and folder watching.

## Later, driven by users

- Optional sync and sharing, team libraries, review links.
- Direct upload to Play Console and App Store Connect.
- Video and animated previews.
- ~~An MCP server so coding agents can update screenshots.~~ Built early,
  September 2026, in `apps/mcp`.
- AI caption drafting, only as a suggestion, never silently.

## Milestones at a glance

| Milestone | Cumulative time | User-visible result |
|---|---|---|
| Phase 0 | about 2 weeks | Framed, store-valid PNGs from a script |
| Phase 1 | about 8 weeks | Public beta of the web editor for Play |
| Phase 2 | about 13 weeks | CLI and localization, the pitch is real |
| Phase 3 | about 18 weeks | Both stores covered |
