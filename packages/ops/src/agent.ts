/**
 * Ready-made instructions that hand the work of making store screenshots to
 * an AI agent: plan a brief, build the screens from it, and refresh them when
 * the app's screenshots change. One text, offered three ways: as a Claude
 * Code skill (SKILL.md), as MCP prompts, and as copyable prompts in the
 * editor, filled in with the project's folder.
 */

/** The web editor, where the setup steps are. */
export const STORESHOTS_SITE = "https://storeshots-mcp.vercel.app";

/**
 * The MCP server: one bundled file with its fonts, attached to a GitHub
 * release (it isn't on npm). npx downloads it once and caches it; it runs on
 * Node 20 or later. Bump with apps/mcp/package.json when releasing.
 */
export const MCP_VERSION = "0.1.0";
export const MCP_PACKAGE = `https://github.com/maheshj01/storeshots/releases/download/v${MCP_VERSION}/storeshots-mcp-server-${MCP_VERSION}.tgz`;

/** Adds the MCP server to Claude Code for every project. */
export const MCP_INSTALL = `claude mcp add --scope user storeshots -- npx -y ${MCP_PACKAGE}`;

/** The storeshots skill, from the skills repository, for every project (-g). */
export const SKILL_INSTALL = "npx skills add maheshj01/skills --skill storeshots -g";

/** What a screenshot's description file (<name>.json) can say; every field is optional. */
export const DESCRIPTION_EXAMPLE = `{
  "description": "Year view: a grid of 365 dots, today's highlighted",
  "feature": "Year progress",
  "theme": "dark",
  "regions": { "grid": { "x": 64, "y": 420, "w": 1050, "h": 1300 } },
  "texts": ["2026", "47% of the year is gone"]
}`;

/**
 * store-assets/README.md: how the folder works and how to have an agent make
 * the screenshots, written beside the projects when one is created.
 */
export function storeAssetsReadme(): string {
  return `# Store screenshots

This folder holds the app's App Store and Google Play screenshot designs, made with storeshots (${STORESHOTS_SITE}).

- \`ios/\`: the App Store project. \`android/\`: the Google Play project.
- Each has a \`storeshots.json\` (the design), \`captures/<locale>/\` (the app's screenshots), and \`store/\` (the rendered images to upload).

## Have an AI agent make them

Once per machine:

\`\`\`
${MCP_INSTALL}
${SKILL_INSTALL}
\`\`\`

Then in the app's folder, ask Claude: "Make App Store screenshots for this app" (or Google Play). It finds the app's screenshots, writes \`brief.md\` for you to review, and after you confirm, designs and renders every screen. Later, after retaking the app's screenshots: "Refresh the store screenshots".

The agent works from text, not images. For better captions, save a description next to each screenshot (\`home.json\` beside \`home.png\`, or in a \`meta/\` folder); every field is optional and regions are in screenshot pixels:

\`\`\`json
${DESCRIPTION_EXAMPLE}
\`\`\`

## Edit by hand

Open ${STORESHOTS_SITE} in Chrome or Edge, click Open folder and pick the app's folder. Changes sync both ways, including the agent's, within about a second.
`;
}

export interface AgentContext {
  /** The project: a folder with a storeshots.json (e.g. "store-assets/ios"), or "live" for the editor tab. */
  project?: string | undefined;
  /** Anything the person adds, e.g. "lead with the year view". */
  notes?: string | undefined;
}

export type AgentTask = "plan" | "build" | "refresh";

export const AGENT_TASKS: Array<{ id: AgentTask; title: string; description: string }> = [
  {
    id: "plan",
    title: "Plan the screenshots",
    description: "Reads the app and its screenshots, then writes brief.md (pitch, screen order, captions, colours) for you to review. Changes nothing else.",
  },
  {
    id: "build",
    title: "Build the screenshots",
    description: "Designs every screen from brief.md with the storeshots tools, fixes every problem the check finds, and renders the store-ready images.",
  },
  {
    id: "refresh",
    title: "Refresh after new screenshots",
    description: "After the app's screenshots are retaken: checks every screen, fixes what the new screenshots broke without redesigning, and renders again.",
  },
];

function where(ctx: AgentContext): string {
  if (ctx.project === "live") return 'the project open in the storeshots editor (project_dir "live")';
  if (ctx.project) return `the storeshots project in ${ctx.project} (pass it as project_dir)`;
  return "this repository's storeshots project: store-assets/ios for the App Store, store-assets/android for Google Play (pass the folder as project_dir; if both exist and the user hasn't said which store, ask)";
}

function folder(ctx: AgentContext): string {
  return ctx.project && ctx.project !== "live" ? ctx.project : "<project>";
}

/** Rules every task follows. */
function ground(ctx: AgentContext): string {
  const p = folder(ctx);
  return `You are working on ${where(ctx)}, which holds App Store or Google Play screenshot designs.

Ground rules:
- Make every change through the storeshots MCP tools (storeshots_*). Never edit storeshots.json by hand: the tools check each change and report layout problems, and the editor shows them live.
- If the project doesn't exist yet, create it with storeshots_create_project (store "appstore" for iOS, "play" for Android; ask which if the user hasn't said and the app has both). Never write storeshots.json yourself.
- If the project has no screenshots, or the app's screenshots are newer, find them in the repository (a screenshots/ folder, integration test output, fastlane) and bring them in with storeshots_import_captures. Use the folder for the right platform and device: iPhone shots for the App Store, Android shots for Google Play.
- If you can't find any screenshots of the app for that store, stop before creating or changing anything. Tell the user where you looked, and ask them to capture the app's screens first (for example from integration tests) or to tell you which folder they're in. Don't design screens around placeholder phones.
- Work from text, not images. storeshots_inspect_screen describes each screen as it will render. The app's screenshots are in ${p}/captures/<locale>/, and each <name>.png may have a <name>.json next to it ({description, feature, theme, regions, texts}; regions are rectangles in screenshot pixels). Read those JSON files with your file tools. If a screenshot has none, work out what it shows from its file name and the app's code: the test or script that captured it, and the screen it opened. Note those guesses in the brief so the user can correct them. Don't open screenshots or renders as images, and don't ask storeshots_render for previews, unless the user asks.
- Screens are named by their id (e.g. "year-view"). Use those names when you talk about them.`;
}

function notes(ctx: AgentContext): string {
  return ctx.notes?.trim() ? `\n\nThe user adds: ${ctx.notes.trim()}` : "";
}

export function agentPrompt(task: AgentTask, ctx: AgentContext = {}): string {
  const p = folder(ctx);
  if (task === "plan") {
    return `${ground(ctx)}

Task: plan the store screenshots and write a brief for the user to review. Apart from creating the project and importing screenshots if they're missing, change nothing in the project.

1. Run storeshots_get_project for the targets, theme, screens and screenshots.
2. Learn the app from this repository: the README, any store listing text (fastlane metadata, docs), the app's theme (brand colours, fonts) and the changelog for its newest features.
3. Read the description file next to each screenshot.
4. Write ${p}/brief.md with:
   - Pitch: who the app is for and why they'd install it, in one or two sentences.
   - Screens, in store order. Google Play shows at most 8 phone screenshots and the App Store at most 10; the first two or three decide whether people install. For each screen: its name (kebab-case, it becomes the screen id), the screenshot file, a headline (sentence case, at most about 30 characters, a benefit rather than a feature name, numbers beat vague words), an optional subline (at most about 60 characters), the region to zoom on if one part matters most, and the background.
   - Design system: theme colours (names and hex, taken from the app), the heading and body fonts (the app's, or the closest of the bundled fonts storeshots_get_project lists), and which text colour goes on which background.
   - Gaps: screenshots that are missing, outdated or need retaking, with what they should show.
5. Stop and ask for confirmation: tell the user the brief is ready to review and edit, and ask whether to build the screenshots from it. Don't build until they say so.${notes(ctx)}`;
  }
  if (task === "build") {
    return `${ground(ctx)}

Task: build the store screenshots from ${p}/brief.md, once the user has confirmed it. If there's no brief, write one as in the plan step, then stop for the user to review it.

1. Run storeshots_get_project.
2. Set up the design system with storeshots_set_theme: the brief's colours as named theme colours, and its fonts as $heading and $body. Use $name colours in every layer and background, so the set stays consistent and can be restyled in one place.
3. Make the screens match the brief with storeshots_edit_screens: add, rename and reorder them. Screens that still hold the template's placeholder text and aren't in the brief can be removed; ask before removing any other screen.
4. Lay out every screen the same way, unless the brief says otherwise: headline and subline above the phone, the phone below, allowed to run off the bottom edge. For each screen:
   - Put its screenshot on the phone (storeshots_update_layer with capture). This may switch the frame to one that matches the screenshot's size; set the frame the brief names afterwards, if it names one.
   - Set the headline and subline text, $heading and $body fonts, and colours from the theme.
   - Set the background with storeshots_set_background.
   - To feature a region from the screenshot's description, enlarge the phone and move it so that region fills the space below the caption. The phone can be cropped by the canvas edges, but must never sit under the caption.
   Make the same change across screens in one call where you can: storeshots_update_layer takes several layers, storeshots_set_background several screens.
5. Read each edit's findings, then run storeshots_check. Fix every error and warning (text overflow, clipped or hidden text, low contrast, text over the phone, too many screens). Notes marked i, like a phone bleeding off the edge, are fine.
6. Render with storeshots_render.
7. Report: each screen's name and headline in order, where the images were written, and anything from the brief you couldn't do (for example, screenshots that need retaking).${notes(ctx)}`;
  }
  return `${ground(ctx)}

Task: the app's screenshots were just retaken (same file names, new pictures). Bring the store screenshots up to date without redesigning them.

1. Run storeshots_check for every locale and target.
2. Run storeshots_get_project and compare each screen's screenshot with the files in ${p}/captures/. Report any screen whose screenshot is missing, and any new screenshot no screen uses.
3. Read the description files of the screenshots the screens use. If a screen's headline or subline no longer matches what its screenshot shows, or a featured region moved, fix the caption or the phone's position.
4. Fix every error and warning the check reports with the smallest change that works. Keep the layout, colours and fonts.
5. Render with storeshots_render, then report what changed and anything left for the user.${notes(ctx)}`;
}

/** A Claude Code skill that runs the whole workflow; saved as .claude/skills/storeshots/SKILL.md. */
export function skillMarkdown(): string {
  const section = (task: AgentTask) =>
    agentPrompt(task)
      .split("\n\n")
      .slice(2) // the shared ground rules are stated once, above
      .join("\n\n");
  return `---
name: storeshots
description: Make, update and export App Store and Google Play screenshots with the storeshots MCP server. Use when the user asks for store screenshots, listing images or a store screenshot brief, or to refresh, re-caption, restyle or re-render them, e.g. after retaking the app's screenshots.
---

# Store screenshots with storeshots

storeshots designs store screenshots as a folder with a storeshots.json: screens with a background, captions and a framed phone showing the app's screenshot. You edit it through the storeshots MCP server's tools, without looking at images.

If the storeshots tools (storeshots_*) aren't available, the storeshots MCP server isn't set up: tell the user to add it, following the steps at https://storeshots-mcp.vercel.app (AI → Edit with AI), and stop.

${ground({})}

Pick the workflow from what the user asks. For a new set, plan first, then ask the user to confirm the brief and build only after they do, unless they asked you to go straight through.

## Plan: write a brief

${section("plan")}

## Build: design the screens from the brief

${section("build")}

## Refresh: after the app's screenshots are retaken

${section("refresh")}
`;
}
