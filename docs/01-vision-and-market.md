# 01 Vision and market

## Who it's for

1. **Indie and small-team mobile developers** shipping on one or both stores.
   They are not designers, they update screenshots every few releases, and
   they hate redoing them. Primary audience.
2. **Teams that localize.** Ten languages times eight screens times two
   stores is 160 images. This is where existing tools hurt most.
3. **Agencies and studios** managing many apps, who need templates and
   consistency. Later audience; don't design for them first.

## Jobs to be done

- "Make my raw screenshots look like a professional store listing in minutes."
- "Put this screenshot in the right device frame, including new devices."
- "Regenerate everything when the UI changes, without redoing the design."
- "Ship the same listing in every language I support."
- "Give me files the store accepts the first time."

## The market today (September 2026)

| Tool | Shape | Automation | Notes |
|---|---|---|---|
| AppLaunchpad | Web editor, subscription (Pro from about $29/mo) | No | 1000+ templates, localization |
| AppScreens | Web editor, subscription (about $99/yr Pro) | No | Bulk generation, localization |
| Previewed | Web editor, one-time indie tier | No | Panoramic, 3D, video |
| Screenshots.pro | Web editor, free tier | No | Panoramic, machine translation |
| AppMockUp | Web editor, free with watermark | No | Android and iOS frames |
| Screenshots.live | Web editor plus cloud REST API | Yes, cloud, Pro plan | YAML templates, fastlane output |
| fastlane frameit | Open-source CLI | Yes, local | Frames only, no design; frame catalog lags new devices (no iPhone 17 frames as of Aug 2026) |
| Mockly, ScreenshotWhale, Screenshot Bro, many more | Mac apps and web editors | Mostly no | Newer entrants, AI captions |

Sources: [AppLaunchpad roundup](https://theapplaunchpad.com/blog/best-app-store-screenshot-generator/),
[AppScreens pricing](https://appscreens.com/pricing),
[Screenshots.live comparison](https://screenshots.live/en/compare/best-screenshot-tools),
[frameit docs](https://docs.fastlane.tools/actions/frameit/),
[frameit alternative writeup](https://appstorescreenshotstudio.com/posts/fastlane-frameit-alternative/).

What this shows:

- **Editors are a commodity.** Templates, text, gradients and frames are table
  stakes. We need them, polished, but they don't win on their own.
- **Automation exists but is locked up.** The only design-plus-automation
  product renders on someone else's servers, behind a paid plan, from a
  template stored in their account.
- **Frames lag reality.** Bitmap frame catalogs depend on someone producing
  art for every new phone, and they fall behind every autumn.
- **Your design isn't yours.** Every editor keeps the project in its cloud.
  Nothing can be diffed, reviewed or versioned with the app.

## Where we win

1. **The project file is yours.** One readable JSON file plus an assets
   folder, committed next to the app. Reviewable in PRs, versioned, portable.
2. **One engine, rendered anywhere.** The editor preview, the CLI in CI and
   any future desktop app run the same renderer, so what you see is what CI
   produces. Offline, no account, no API key, no per-render cost.
3. **Localization as data.** Captions are keys with per-locale values,
   imported from ARB, JSON, CSV or XLIFF. Adding a language is adding a
   column, then re-rendering.
4. **Vector device frames we control.** Frames drawn as parametric SVG ship
   the week a device is announced, stay sharp at any size, recolor for
   device finishes, and avoid third-party art licences. Android emulator
   skins from the user's own SDK can be imported for exact fidelity.
5. **Store rules enforced, not documented.** Export refuses to produce a file
   either store would reject, and warns when a set misses promotion rules.
6. **Fast and calm.** Instant preview on a 20-screen, 10-locale project;
   opinionated defaults that look good in five minutes.

The short pitch: **"Screenshots as code, with a designer's editor."**

## Non-goals for the first year

- AI-generated designs or captions. Revisit once the core is loved.
- Video previews, 3D tilted mockups, panoramic spreads. Phase 3 candidates.
- Accounts, cloud sync, teams, billing. The free local product must be
  complete on its own.
- Machine translation. We import translations; we don't produce them.
- A template marketplace.
