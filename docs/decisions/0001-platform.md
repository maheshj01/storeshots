# ADR 0001: Platform — web app, desktop app, CLI

Status: proposed, awaiting sign-off

## Context

The product has two faces. A visual editor for designing screens, and a
renderer that turns a project into store-ready files, interactively or in CI.
We need to decide which delivery shells to build and in what order, knowing
that each shell costs ongoing maintenance for years.

## Options

| | Web app (PWA) | Desktop app (Tauri or Electron) | CLI | Native Mac app | Flutter (web + desktop) |
|---|---|---|---|---|---|
| Time to first user | Seconds, a link | Download, install, OS warnings | `npx`, developers only | App Store or download | Seconds on web |
| Discoverability | Search, shareable links | Low | Low | Mac App Store | Search |
| Reach | Every OS | Every OS, three builds | Every OS with Node | macOS only | Every OS |
| File system and repo | Chromium: open a folder directly. Safari and Firefox: import and export | Full access, watch folders | Full access | Full access | Web: limited. Desktop: full |
| Run adb and simulators | No (WebUSB adb on Chromium only) | Yes | Yes | Yes, iOS only | Desktop only |
| CI rendering | No | No | Yes, the whole point | No | Awkward, needs a headless Dart renderer |
| Update and release cost | Deploy static files | Signing, notarization, auto-update, 3 OSes | npm publish | Apple review | Signing per desktop OS |
| Shares code with the rest | Core engine in TypeScript | Wraps the web app | Same engine | None | Editor yes, CI engine no |

## Decision

**Build one TypeScript core, delivered as a web app and a CLI from the start.
Add a desktop shell later, only if specific triggers fire.**

1. **Web app first, as the editor.** It's where users look for this, it has
   zero install, and every competitor's funnel starts there. Local-first:
   all work stays in the browser (Origin Private File System and IndexedDB),
   works offline as a PWA, and on Chromium opens a project folder inside the
   user's repo with the File System Access API. Safari and Firefox get
   project import and export as a zip.
2. **CLI from the same engine, shipped in the second phase but designed in
   from day one.** `storeshots render` turns a project into store-ready
   files in CI or locally. This is the differentiator, so the architecture
   must never let the editor render something the CLI can't.
3. **Desktop app deferred.** It adds no rendering capability over the web
   app plus CLI, and costs signing, notarization and updates on three
   platforms. Build it with Tauri, wrapping the same web editor, when one of
   these becomes true:
   - Users need to capture straight from devices (adb, iOS Simulator) from
     inside the editor, and the CLI capture command isn't enough.
   - Folder watching and auto-rerender on new captures becomes a top request.
   - Safari and Firefox users are a large share and the zip workflow hurts.

## Why not the others

- **Desktop first:** slower adoption and higher release cost for no rendering
  gain. Most of its benefits come later via Tauri over the same code.
- **CLI only:** that's frameit. The audience wants to see and tweak the
  design; the CLI is the automation half, not the product.
- **Native Mac app:** excludes Windows and Linux Android developers, who are
  a core audience for a Play-first tool.
- **Flutter:** attractive given the team's Flutter experience, and the editor
  would be fine. But the CLI needs to render identically in CI without a
  browser or a device, and Dart has no mature headless 2D engine with
  browser-grade text layout. Splitting the renderer across two languages
  would break the "same pixels everywhere" promise.

## Consequences

- The rendering core must be pure TypeScript over a Canvas 2D-compatible
  surface: the browser's canvas in the editor, a Skia-backed canvas in Node
  for the CLI. See the architecture doc.
- Fonts must be bundled and loaded explicitly in both environments; never
  rely on system fonts, or CI output drifts.
- Golden-image tests compare editor and CLI output on every change.
- Phase 0 includes a spike to prove browser-versus-Node rendering parity is
  good enough. If it isn't, the CLI renders through headless Chromium
  instead, trading install size for exact parity.
