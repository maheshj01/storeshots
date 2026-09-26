# 03 Project format

A project is a folder, normally inside the app's repo:

```
store-assets/
├── storeshots.json        The design: targets, screens, layers, captions
├── captures/              Raw screenshots, e.g. from adb screencap or simctl
│   ├── en/01_home.png
│   └── de/01_home.png
├── fonts/                 Font files used by text layers
└── store/                 Rendered output (gitignored or committed, user's call)
```

## Design rules

- **Human-readable and diff-friendly.** Stable key order, two-space
  indentation, no generated IDs in places people read.
- **Relative paths only**, so the folder moves between machines and CI.
- **`schemaVersion` on every file**, with forward migrations in
  `packages/schema`. The editor and CLI refuse newer versions with a clear
  message instead of silently dropping data.
- **Units are canvas fractions** (0 to 1 of width and height) so a design
  adapts across target sizes. Font sizes are fractions of canvas width.
- **Captures are resolved per locale** with a fallback chain, so a German
  render uses `captures/de/` and falls back to `captures/en/`.

## Sketch

Illustrative, not final. Phase 0 turns this into a JSON Schema.

```json
{
  "schemaVersion": 1,
  "name": "Epoch",
  "locales": { "default": "en", "list": ["en", "de", "ja"] },
  "targets": [
    { "id": "play-phone", "store": "play", "size": [1080, 1920] },
    { "id": "ios-6.9", "store": "appstore", "size": [1320, 2868] }
  ],
  "theme": {
    "fonts": { "heading": "fonts/Poppins-SemiBold.ttf" },
    "colors": { "brand": "#EF5B2A", "ink": "#1C1917" }
  },
  "screens": [
    {
      "id": "home",
      "background": {
        "type": "linear-gradient",
        "angle": 160,
        "stops": [["$brand", 0], ["#FF8A5B", 1]]
      },
      "layers": [
        {
          "type": "text",
          "text": "@caption.home.title",
          "font": "$heading",
          "size": 0.075,
          "color": "#FFFFFF",
          "box": { "x": 0.08, "y": 0.06, "w": 0.84, "h": 0.14 },
          "align": "center",
          "fit": "shrink"
        },
        {
          "type": "device",
          "frame": { "android": "pixel-9-pro", "ios": "iphone-17-pro" },
          "variant": "obsidian",
          "capture": "01_home.png",
          "box": { "x": 0.12, "y": 0.24, "w": 0.76, "h": 0.74 },
          "rotate": 0
        }
      ]
    }
  ],
  "captions": {
    "home.title": {
      "en": "See your year at a glance",
      "de": "Dein Jahr auf einen Blick",
      "ja": "一年をひと目で"
    }
  }
}
```

Notes on the sketch:

- **`$name`** references a theme value, so a brand colour change is one edit.
- **`@caption.key`** references localized text; captions can also be kept in
  separate ARB or JSON files and referenced from here.
- **`frame` per platform** lets one screen design render with a Pixel frame
  for Play targets and an iPhone frame for App Store targets.
- **`fit: "shrink"`** auto-sizes text down so long German or Finnish captions
  stay inside the box instead of overflowing.
