# storeshots MCP server

Lets Claude Code, Claude Desktop or any MCP client read, check and edit a
storeshots project (`storeshots.json` and its files) without looking at
screenshots. The server describes every screen as text: where each layer
lands in output pixels, how captions wrap and shrink, where phones bleed off
the canvas, and what is wrong (overflowing, clipped or hidden text, low
contrast, missing screenshots, store rule violations). Every edit returns
the updated layout, so an agent can change a design in a few hundred tokens
per step instead of reading a rendered image each time.

It uses the same edit operations as the web editor and the same renderer
as the CLI, so what an agent changes is what people see and what exports.

## Set up

Needs Node.js 20 or later.

Claude Code:

```
claude mcp add storeshots -- npx -y storeshots-mcp-server
```

Claude Desktop (Settings → Developer → Edit Config), Cursor
(`.cursor/mcp.json`) and other MCP clients:

```json
{
  "mcpServers": {
    "storeshots": { "command": "npx", "args": ["-y", "storeshots-mcp-server"] }
  }
}
```

Then pick what the agent works on:

- **The project open in the web editor (live).** In the editor, click
  **AI → Connect this tab**. The tab links to the server on
  `127.0.0.1:47821`; the agent's edits appear on screen as it makes them,
  each one undoable, and your edits are visible to the agent straight away.
  Nothing leaves your computer. Renders go to `./storeshots-export/<project>/`.
- **A folder with a `storeshots.json`**, e.g. in your app's repo: start the
  server with `--project ./store-assets` (or from inside that folder), or
  pass `project_dir` to any tool. In the web editor, **Link a folder** keeps
  the same folder in sync both ways.

Without `--project`, the server uses a `storeshots.json` in the folder it
starts in, and otherwise the live project. `project_dir: "live"` always
means the live project.

### From this repository

`pnpm mcp --project <folder>` runs the TypeScript sources directly.
`pnpm --filter storeshots-mcp-server build` bundles `dist/` and copies the
template fonts, and `npm pack` in `apps/mcp` makes the package that gets
published.

## Tools

| Tool | What it does |
|---|---|
| `storeshots_get_project` | Overview: targets, locales, theme, fonts, frames, templates, screenshots, and each screen with a problem count. Start here. |
| `storeshots_inspect_screen` | One screen as it will render, layer by layer, with findings. `format: "json"` for code. |
| `storeshots_check` | Every screen, locale and target against layout checks and store rules. Lists problems only. |
| `storeshots_update_layer` | Change position, size, rotation, opacity, text, font, colour, alignment, frame, finish, screenshot, shape or radius, on one layer or several at once (`layers`), even across screens. |
| `storeshots_add_layer` | Add text, device, shape or image, with initial properties. |
| `storeshots_arrange_layer` | Remove, duplicate or restack a layer. |
| `storeshots_align_layer` | Line up what a layer draws (text ink, phone body) with the canvas edges or centre. |
| `storeshots_edit_screens` | Add, duplicate, remove, rename or reorder screens; copy one screen's layout to all. |
| `storeshots_set_background` | Solid or gradient background, on one screen, several, or all. |
| `storeshots_set_theme` | Add, change, rename or remove theme colours; set theme fonts. Restyles every screen that uses them. |
| `storeshots_apply_template` | Re-lay out every screen, or just some, with a starter template, keeping captions and screenshots. |
| `storeshots_import_capture` | Copy a screenshot into `captures/<locale>/` and put it on a phone. |
| `storeshots_import_frame` | Import an exact bezel from this machine: Xcode's Simulator (iPhone, iPad) or an Android SDK skin; optionally switch matching phones to it. |
| `storeshots_render` | Write store-ready files to `store/`. Preview images only when asked. |
| `storeshots_render_device` | Save one phone with its screenshot as a transparent PNG, for websites and social posts. |

Positions and sizes are output pixels of the target (default: the first
one), with x,y at the top-left. Layers are numbered from the bottom,
starting at 0.

### Theme colours

A project's theme colours are its design system: named colours such as
`brand`, `ink` or `paper`. Anywhere a colour goes, `"$name"` refers to one,
so changing the theme colour restyles every background and layer that
uses it, on every screen. `storeshots_get_project` lists them with how
often each is used; `storeshots_set_theme` adds, changes, renames (every
reference follows) and removes them (what used a removed colour keeps it
as a plain `#hex`). The web editor shows the same colours under **Theme
colours** when nothing is selected.

### Screen names

A screen's id is its name: people rename screens in the editor (double-click
the name under a screen), so "change the headline on add-event" means the
screen `add-event`. Renaming (`storeshots_edit_screens` with `rename`) turns
a name into an id ("Add event" becomes `add-event`), moves the screen's
captions with it, and names its exported files (`03_add-event.png`).

### Changing several things at once

- `storeshots_update_layer` with `layers: [{screen, layer}, …]` changes
  them all in one step, say every caption's font. Each layer gets only the
  fields its type has (a font goes to text, not phones); the result lists
  what was skipped.
- `storeshots_set_background` takes a list of screens, or `"*"`.
- `storeshots_apply_template` with `screens` re-lays out only those
  screens: they get the template's colours and fonts as plain values, and
  the theme and the other screens stay as they are. Without `screens`,
  every screen changes and the template becomes the theme.

## What a screen looks like to an agent

```
screen progress · play-phone 1080×1920 · en · background gradient 160° $brand@0 → $brandLight@1
[0] text "See your year / at a glance" · Poppins-SemiBold.ttf 84.2px · 2 lines · $white (#FFFFFF) · center/bottom · box 86.4,76.8 907.2×230.4 · ink 248.1,105 583.8×202.2 · @caption.progress.title
[1] text "Every day is a dot" · Poppins-Regular.ttf 43.2px · 1 line · #FFFFFFD9 · center/top · box 108,330.2 864×96 · ink 351.3,330.2 377.3×51.8 · @caption.progress.sub
[2] device pixel-9-pro · 01_progress.png 1280×2856 · box 140.4,480 799.2×1536 · body 178.1,480 723.8×1536 · bleeds bottom 96
findings:
  ! [1] low_contrast: contrast 2.7:1 against the background, below 3:1; change the text or background colour
  i [2] device_bleed: phone runs 96px past the bottom edge (cropped in the export)
```

## Safety

- Edits are validated before they are written; an edit that would make the
  project invalid is refused and nothing is saved.
- Writes are atomic and one at a time.
- Every edit saves `storeshots.json` immediately. Keep the project in git to
  review or revert what an agent did.
- Tools only write inside the project folder, and font and image paths
  can't point outside it. `storeshots_import_capture` reads the source
  file you name and copies it in.

## Live link security

- The link listens on 127.0.0.1 only and accepts pages from
  `https://storeshots-mcp.vercel.app` and localhost; add others with
  `STORESHOTS_ALLOWED_ORIGINS` (comma-separated).
- The newest connected editor tab is the one the agent works on.
- The server exits when its AI tool closes the session, freeing the port.
  `--port` or `STORESHOTS_PORT` changes it (the editor expects 47821);
  `--no-live` turns the link off.

## Known limits

- One server at a time can hold the live link's port. A second one (say,
  Claude Code and Claude Desktop both running) still works on folders and
  says why the live link is unavailable.
- Browsers may ask once before the editor site can talk to a server on
  your computer. Safari may not allow it; use a linked folder there.
- Contrast is checked against solid colours, gradients and shapes; text
  over a screenshot or image isn't checked.
- Tool definitions are about 22 KB, a one-time cost per session.
