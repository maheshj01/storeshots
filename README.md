# storeshots (working name)

A tool for making App Store and Google Play screenshots: upload raw captures,
put them in real device frames, compose them on store-sized canvases with
backgrounds and text, and export exactly what each store accepts.

Status: phase 0 (foundations) and phase 1 (the web editor) are built. See
[Getting started](#getting-started).

## The bet in one paragraph

The market has a dozen polished browser editors (AppScreens, AppLaunchpad,
Previewed, Screenshots.pro, AppMockUp, and more) and one cloud API for
automation (Screenshots.live, on its top plan). What nobody offers is a design
you own: a project file that lives in your app's repo, renders offline with an
open engine, and regenerates every screen in every language with one command
when the app changes. We build a great editor on top of that engine, rather
than an engine bolted onto an editor.

## Documents

| Doc | What it answers |
|---|---|
| [01 Vision and market](docs/01-vision-and-market.md) | Who it's for, what competitors do, where we win, what we won't do |
| [ADR 0001 Platform](docs/decisions/0001-platform.md) | Web app, desktop app, CLI, or all three, and in what order |
| [ADR 0002 Render parity](docs/decisions/0002-render-parity.md) | Phase 0 spike result: Skia in Node versus the browser |
| [02 Architecture](docs/02-architecture.md) | Monorepo layout, rendering engine, editor, CLI, frames catalog |
| [03 Project format](docs/03-project-format.md) | The `storeshots.json` schema that everything reads and writes |
| [04 Store specs](docs/04-store-specs.md) | Verified Play Store and App Store size rules the exporter enforces |
| [05 Roadmap](docs/05-roadmap.md) | Phases, scope and exit criteria |
| [06 Risks and open questions](docs/06-risks-and-open-questions.md) | What could sink it and what still needs a decision |

## Getting started

Needs Node 22 or later and pnpm 9.

```
pnpm install
pnpm check                  # typecheck and tests
pnpm dev                    # the editor on http://localhost:5180
pnpm render:example         # renders examples/epoch to examples/epoch/store/
pnpm parity                 # opens the browser-versus-Node comparison on :5173
```

To try the editor with real captures: New project, pick a template, then
drag `examples/epoch/captures/en/*.png` onto the table. They fill the empty
phones in order. Export gives a zip of store-ready PNGs; "Project .zip"
gives a folder the CLI can render.

The CLI runs straight from TypeScript source (Node strips the types):

```
node apps/cli/src/main.ts render examples/epoch --fastlane
node apps/cli/src/main.ts validate examples/epoch
node apps/cli/src/main.ts frames list
node apps/cli/src/main.ts frames import pixel_10_pro examples/epoch
```

| Path | What's there |
|---|---|
| `packages/schema` | Project types (zod), validation with paths, reference checks, JSON Schema, migrations |
| `packages/stores` | Play and App Store rules as data, image and set checks |
| `packages/frames` | Vector frame catalog (Pixel 9 Pro, Pixel 7, generic Android) and the emulator skin importer |
| `packages/core` | The renderer, text layout, deterministic shadows, RGB PNG encoder, export pipeline |
| `apps/cli` | `storeshots` command and the Node render host; golden tests |
| `apps/web` | The editor: React over the same core, IndexedDB storage, export worker, offline PWA |
| `tools/parity` | Browser render host and the parity page |
| `tools/goldens` | Reference images at half size; `UPDATE_GOLDENS=1 pnpm test` regenerates |
| `examples/epoch` | The dogfood fixture: 4 screens, en and de |

## Decisions still needed from you

Phase 0 went ahead with placeholders. These still block publishing
anything:

1. Product name. `storeshots` and the `@storeshots/*` scope are placeholders.
2. Licence and business model. No licence file yet, so the code is all rights
   reserved by default. The recommendation is an open-source engine and CLI
   with a free editor, paid features later. See the risks doc.
3. Confirm the platform order in ADR 0001: web editor and CLI first, desktop
   later only if the triggers in that ADR fire.
