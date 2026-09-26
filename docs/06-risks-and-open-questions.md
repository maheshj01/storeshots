# 06 Risks and open questions

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Text renders differently in browser and Node | Breaks the core promise | Phase 0 parity spike; bundled fonts only; line breaking in core; fallback to headless Chromium in the CLI |
| Device frame art licensing | Takedown or legal exposure | Draw our own vector frames from public dimensions; import Android SDK skins only from the user's machine, never redistribute; don't bundle Apple Design Resources art |
| Competing on templates with teams that have 1000+ | Looks thin next to incumbents | Compete on ownership, automation and localization; ship fewer, better templates |
| Editor scope creep toward Figma | Never ships | Non-goals list in doc 01; every feature must serve a store screenshot |
| Browser memory with many full-resolution images | Crashes on low-end laptops | Downscaled previews, full-size only in export workers, release bitmaps aggressively |
| Safari and Firefox lack folder access | Weaker repo workflow there | Zip import and export; CLI covers the repo workflow; Tauri later if needed |
| Store rules change | Rejected uploads | Rules as versioned data, re-verified before releases, with tests |
| Solo maintainer burnout on frames | Catalog goes stale like frameit's | Frames as data with a contribution guide and a validation script |

## Open questions for you

1. **Name.** Needed for the repo, npm package, CLI command and domain.
   `storeshots` is a placeholder; check availability before choosing.
2. **Licence and business model.** Recommendation: open-source the schema,
   core, frames and CLI (MIT or Apache 2.0) to earn trust and CI adoption;
   keep the web editor free and local; charge later for sync, teams and
   hosted extras. Alternative: closed source with a generous free tier.
   This decision shapes the repo layout, so make it before phase 0.
3. **Hosting.** Any static host works for the editor (Cloudflare Pages,
   Vercel, Netlify, Firebase Hosting). Choose one; it's easy to change.
4. **Where epoch fits.** Recommended as the first real project and the
   phase 0 test fixture.
5. **Design ownership.** The editor's own look matters in this market.
   Decide whether to design it yourself, hire, or start from a component
   kit (shadcn/ui on Radix) and refine.

## Decisions already made

- Platform order: web editor and CLI on one TypeScript core, desktop later.
  See ADR 0001.
- Rendering: a single pure renderer over Canvas 2D; no Konva or Fabric.
- Frames: vector catalog we own, plus local import of SDK emulator skins.
