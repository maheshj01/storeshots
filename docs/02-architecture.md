# 02 Architecture

## Principles

1. **One renderer.** Every pixel, in the editor preview, in export and in CI,
   comes from the same `render(project, screen, target, locale)` function.
2. **The project file is the source of truth.** The editor is a friendly way
   to edit JSON. Nothing important lives only in editor state.
3. **Local-first.** No server is required to design or export. A server, if
   ever added, is for sync and sharing, not rendering.
4. **Data over code for devices and stores.** Frames and store specs are
   versioned data packages, updated without an app release.

## Monorepo layout

```
storeshots/
├── packages/
│   ├── schema/      Project types, JSON Schema, validation, version migrations
│   ├── core/        Renderer, layout, text, frame compositing, export rules
│   ├── frames/      Device frame catalog (SVG + manifest) and skin importer
│   ├── stores/      Store targets and rules (Play, App Store), as data
│   └── i18n/        ARB, JSON, CSV, XLIFF caption import and export
├── apps/
│   ├── web/         Editor: React UI over core, PWA, local storage
│   └── cli/         `storeshots` command: render, validate, init, frames
└── tools/
    └── goldens/     Reference images and the parity test harness
```

Tooling: TypeScript throughout, pnpm workspaces, Vite for the web app,
Vitest for tests, Playwright for editor end-to-end tests. Node 22 LTS or
later for the CLI.

## Rendering core

- **Surface:** the Canvas 2D API. Browser uses `OffscreenCanvas`, in a worker
  for exports so the UI never stalls. Node uses a Skia-backed canvas;
  `@napi-rs/canvas` is the first choice because it ships prebuilt binaries
  with no system dependencies, with `skia-canvas` as the alternative.
- **Scene model:** each screen is an ordered list of layers: background,
  device, text, image, shape. The renderer is a pure function from layers to
  draw calls. No retained scene library, so there is nothing that exists in
  the editor but not in the CLI.
- **Why not Konva or Fabric.js:** they bring their own retained scene graph
  and rendering. The editor would render through one engine and the CLI
  through another, which is exactly the drift we promise won't happen.
  Interaction is built as a thin layer instead (see Editor).
- **Text:** fonts are project assets, loaded explicitly via the FontFace API
  in the browser and font registration in Node. Line breaking and
  auto-fit-to-box are implemented in core, not left to the platform, so
  wrapping is identical everywhere. Right-to-left and CJK need testing from
  the first localization milestone.
- **Resolution independence:** layers are positioned in canvas units relative
  to the target size, so one design renders to a 1080 by 1920 Play target
  and a 1320 by 2868 App Store target without redesigning.

## Device frames

Two sources, one runtime format.

- **Vector frames (the catalog we own).** Each device is an SVG body plus a
  manifest: screen rectangle, corner radius, cutout shape, colour variants,
  physical size. Drawn from published device dimensions, so new devices can
  ship the week they're announced. Small, sharp at any scale, recolourable.
- **Imported bitmap skins.** The importer reads Android Emulator skins from
  the user's own SDK (`layout`, `back.webp`, `mask.webp`), the same logic as
  epoch's `tool/frame_screenshot.py`. Imported locally, never redistributed.
- **Runtime format:** both become `{ body, screenRect, screenMask, overlay }`,
  so the renderer doesn't care where a frame came from. iPhones and iPads are
  just more catalog entries.

## Editor (apps/web)

- React with TypeScript. State in a single store (Zustand) holding the
  project document; every edit is an Immer patch, which gives undo, redo and
  autosave for free.
- The canvas shows the renderer's output. Selection boxes, drag handles,
  snapping guides and inline text editing are DOM and SVG overlays on top,
  mapped to canvas coordinates. They never draw into the export.
- Screens are shown as a horizontal strip, the way a store listing looks.
  "Apply to all screens" and linked layers keep a set consistent.
- Previews render at display resolution; exports render at full target
  resolution in a worker and are zipped with `fflate`.

## CLI (apps/cli)

```
storeshots init                      Create storeshots.json in the current repo
storeshots render [--locale en,de]   Render all targets to ./store/ (fastlane layout optional)
storeshots validate                  Check sizes, counts and store rules without rendering
storeshots frames list|import        Browse the catalog, import SDK emulator skins
```

Exit codes are CI-friendly: non-zero on invalid projects, missing assets, or
output a store would reject. Output folder layouts match fastlane `supply`
(Play) and `deliver` (App Store) so upload stays with existing tools.

## Testing strategy

- **Schema:** round-trip and migration tests for every schema version.
- **Renderer:** golden images per layer type and per frame, rendered in Node
  and in headless Chromium, compared with a small pixel tolerance. A parity
  failure blocks merge.
- **Store rules:** table-driven tests against the specs in doc 04.
- **Editor:** Playwright flows for upload, frame, text, export.
