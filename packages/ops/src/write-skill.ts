// Writes skills/storeshots/SKILL.md from the agent prompts: `pnpm skill`.
import { writeFileSync } from "node:fs";
import { skillMarkdown } from "./agent.ts";

writeFileSync(new URL("../../../skills/storeshots/SKILL.md", import.meta.url), skillMarkdown());
