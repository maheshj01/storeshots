import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentPrompt, skillMarkdown } from "./agent.ts";

const SKILL = new URL("../../../skills/storeshots/SKILL.md", import.meta.url);

describe("agent prompts", () => {
  it("name the project folder they're given", () => {
    const text = agentPrompt("build", { project: "store-assets/ios" });
    expect(text).toContain("store-assets/ios/brief.md");
    expect(text).toContain("store-assets/ios/captures/<locale>/");
    expect(agentPrompt("plan", { project: "live" })).toContain('project_dir "live"');
  });

  it("add the user's notes", () => {
    expect(agentPrompt("refresh", { notes: "keep the purple" })).toMatch(/The user adds: keep the purple$/);
  });

  it("match the skill in skills/storeshots (run `pnpm skill` after changing them)", () => {
    expect(readFileSync(SKILL, "utf8")).toBe(skillMarkdown());
  });
});
