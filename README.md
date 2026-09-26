# storeshots (working name)

A tool for making App Store and Google Play screenshots: upload raw captures,
put them in real device frames, compose them on store-sized canvases with
backgrounds and text, and export exactly what each store accepts.

This folder is the plan. No code yet.

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
| [02 Architecture](docs/02-architecture.md) | Monorepo layout, rendering engine, editor, CLI, frames catalog |
| [03 Project format](docs/03-project-format.md) | The `storeshots.json` schema that everything reads and writes |
| [04 Store specs](docs/04-store-specs.md) | Verified Play Store and App Store size rules the exporter enforces |
| [05 Roadmap](docs/05-roadmap.md) | Phases, scope and exit criteria |
| [06 Risks and open questions](docs/06-risks-and-open-questions.md) | What could sink it and what still needs a decision |

## Decisions needed from you before phase 0

1. Product name, so the repo, CLI command and file extension can be fixed.
2. Licence and business model. The recommendation is an open-source engine
   and CLI with a free editor, paid features later. See the risks doc.
3. Confirm the platform order in ADR 0001: web editor and CLI first, desktop
   later only if the triggers in that ADR fire.
