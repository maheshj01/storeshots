// Writes the storeshots skill from the agent prompts: `pnpm skill` updates
// skills/storeshots/SKILL.md here; `pnpm skill <path>` writes a copy, e.g.
// into a skills repository.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { skillMarkdown } from "./agent.ts";

const out = process.argv[2] ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]) : new URL("../../../skills/storeshots/SKILL.md", import.meta.url).pathname;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, skillMarkdown());
console.log(`wrote ${out}`);
