import { useState } from "react";
import { Check, Copy, FolderPlus, Plug, X } from "lucide-react";
import { useEditor } from "../state/store.ts";
import { linkFolder } from "../engine/folderSync.ts";
import { canUseFolders, download, platformOf, projectPath } from "../state/io.ts";
import { AGENT_TASKS, agentPrompt, skillMarkdown, type AgentTask } from "@storeshots/ops";
import { connectBridge, disconnectBridge, useBridge } from "../engine/bridge.ts";
import { toast } from "./toast.ts";

/**
 * How to let Claude or another AI agent work on the screenshots. The agent
 * runs the storeshots MCP server on the user's machine. Either this tab
 * connects to it directly (the live link) or the project lives in a folder
 * both sides sync with; either way the agent's changes appear here.
 */

/**
 * The MCP server, a single bundled file with its fonts, attached to a GitHub
 * release (it isn't on npm). npx downloads it once and caches it; it runs on
 * Node 20 or later, with no clone or build.
 */
export const MCP_VERSION = "0.1.0";
export const PACKAGE = `https://github.com/maheshj01/storeshots/releases/download/mcp-v${MCP_VERSION}/storeshots-mcp-server-${MCP_VERSION}.tgz`;

/** The storeshots skill, from the skills repository, for every project (-g). */
export const SKILL_INSTALL = "npx skills add maheshj01/skills --skill storeshots -g";

/** Adds the MCP server to Claude Code for every project, so any app's repo can use it. */
export const MCP_INSTALL = `claude mcp add --scope user storeshots -- npx -y ${PACKAGE}`;

type Client = "claude-code" | "claude-desktop" | "cursor" | "other";

const CLIENTS: Array<{ id: Client; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
  { id: "other", label: "Other MCP clients" },
];

/**
 * Setup for each client, once for every project. Started in an app's folder,
 * the server works on its store-assets/ios or store-assets/android project;
 * elsewhere, on the project open in the editor.
 */
export function setupSnippet(client: Client): { note: string; code: string; lang: string } {
  const args = ["-y", PACKAGE];
  const json = JSON.stringify({ mcpServers: { storeshots: { command: "npx", args } } }, null, 2);
  switch (client) {
    case "claude-code":
      return { note: "In a terminal (once; it works in every project):", code: MCP_INSTALL, lang: "bash" };
    case "claude-desktop":
      return {
        note: "Settings → Developer → Edit Config, add this to claude_desktop_config.json, then restart Claude. It works on the project open in this tab:",
        code: json,
        lang: "json",
      };
    case "cursor":
      return { note: "Add this to .cursor/mcp.json (in your project, or ~/.cursor for all projects):", code: json, lang: "json" };
    default:
      return { note: "Any MCP client that runs local (stdio) servers can start it with:", code: `npx ${args.join(" ")}`, lang: "bash" };
  }
}

export const EXAMPLE_PROMPTS = [
  "Check the screenshots and fix anything the stores would reject or that's hard to read.",
  "Rewrite every caption to be under 30 characters, keeping the meaning.",
  "Move the phones up so they don't run off the bottom, on every screen.",
  "Use the Simulator's iPhone 17 Pro bezel for all phones.",
  "Change the brand colour to #2F6FEB and fix any text that becomes hard to read.",
];

export function CopyBlock({ code, tall }: { code: string; tall?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`code${tall ? " tall" : ""}`}>
      <pre>{code}</pre>
      <button
        type="button"
        className="btn ghost icon"
        aria-label="Copy"
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </button>
    </div>
  );
}

/**
 * The ready-made workflows (plan a brief, build from it, refresh after new
 * screenshots) as prompts to paste into any agent, filled in with this
 * project's folder; plus the same workflows as a Claude Code skill.
 */
function ReadyPrompts({ project }: { project: string | undefined }) {
  const [task, setTask] = useState<AgentTask>("plan");
  const info = AGENT_TASKS.find((t) => t.id === task)!;
  return (
    <>
      <div className="seg" role="tablist" aria-label="Workflow">
        {AGENT_TASKS.map((t, i) => (
          <button key={t.id} type="button" role="tab" aria-pressed={task === t.id} onClick={() => setTask(t.id)}>
            {i + 1}. {t.id[0]!.toUpperCase() + t.id.slice(1)}
          </button>
        ))}
      </div>
      <p className="hint">{info.description}</p>
      <CopyBlock code={agentPrompt(task, { project })} tall />
      <p className="hint">
        In Claude Code the same prompts are built in: type <code>/mcp__storeshots__{task}</code>. Easier still, add the storeshots
        skill once, then just ask Claude to make your store screenshots:
      </p>
      <CopyBlock code={SKILL_INSTALL} />
      <p className="hint">
        Or{" "}
        <button type="button" className="link" onClick={() => download(new Blob([skillMarkdown()], { type: "text/markdown" }), "SKILL.md")}>
          download SKILL.md
        </button>{" "}
        and save it as <code>.claude/skills/storeshots/SKILL.md</code> in your app's repo.
      </p>
    </>
  );
}

export function AiSetup() {
  const [client, setClient] = useState<Client>("claude-code");
  const snippet = setupSnippet(client);
  return (
    <>
      <div className="seg" role="tablist" aria-label="AI tool">
        {CLIENTS.map((c) => (
          <button key={c.id} type="button" role="tab" aria-pressed={client === c.id} onClick={() => setClient(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="hint">{snippet.note}</p>
      <CopyBlock code={snippet.code} />
    </>
  );
}

function LiveStatus() {
  const status = useBridge((s) => s.status);
  const server = useBridge((s) => s.server);
  const open = useEditor((s) => s.doc !== null);
  if (status === "connected") {
    return (
      <div className="live ok">
        <span className="dot" /> Connected to {server}. {open ? "Your agent is working on this project." : "Open a project for your agent to work on."}
        <button type="button" className="btn ghost" onClick={disconnectBridge}>
          Disconnect
        </button>
      </div>
    );
  }
  if (status === "replaced") {
    return (
      <div className="live">
        <span className="dot waiting" /> Another storeshots tab is connected to your AI agent, so it works on that tab's project.
        <button type="button" className="btn" onClick={connectBridge}>
          <Plug aria-hidden /> Use this tab instead
        </button>
      </div>
    );
  }
  if (status === "waiting") {
    return (
      <div className="live">
        <span className="dot waiting" /> Waiting for the MCP server… It starts when your AI tool does; in Claude Code, start a session after adding it.
        <button type="button" className="btn ghost" onClick={disconnectBridge}>
          Stop
        </button>
      </div>
    );
  }
  return (
    <div className="row">
      <button type="button" className="btn primary" onClick={connectBridge}>
        <Plug aria-hidden /> Connect this tab
      </button>
      <span className="hint">Your browser may ask to allow access to apps on this device.</span>
    </div>
  );
}

export function AiDialog({ onClose }: { onClose: () => void }) {
  const folder = useEditor((s) => s.folder);
  const open = useEditor((s) => s.doc !== null);
  const doc = useEditor((s) => s.doc);
  const [files, setFiles] = useState(false);
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="ai-title" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: "min(640px, 100%)" }}>
        <header>
          <h2 id="ai-title">Edit with AI</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </button>
        </header>
        <div className="body">
          <p className="lede-sm">
            Claude and other AI agents can check and edit these screenshots through the storeshots MCP server. The agent reads each
            screen as text (where every layer sits, how captions wrap, what's wrong), so it works fast without looking at images, and
            you watch its changes appear here. Everything stays on your computer.
          </p>

          <ol className="steps">
            <li>
              <b>Add the MCP server to your AI tool</b>
              <AiSetup />
              <p className="hint">Needs Node.js 20 or later. You only do this once.</p>
            </li>
            <li>
              <b>Hand over the work</b>
              <ReadyPrompts project={folder ? projectPath(folder) : open ? "live" : undefined} />
              <details className="alt">
                <summary>Or ask for something specific</summary>
                <ul className="prompts">
                  {EXAMPLE_PROMPTS.map((p) => (
                    <li key={p}>“{p}”</li>
                  ))}
                </ul>
              </details>
            </li>
            <li>
              <b>Watch it here</b> <span className="once">optional</span>
              <p className="hint">
                The agent saves to the project folder and renders the images itself, so this page doesn't need to be open. To see its
                changes as it makes them: open the project's folder here, or link this one to a folder (below). Or connect this tab, and
                the agent works on the project open here:
              </p>
              <LiveStatus />
            </li>
          </ol>

          <details className="alt" open={files} onToggle={(e) => setFiles((e.target as HTMLDetailsElement).open)}>
            <summary>Keep this project as files in your app's repo</summary>
            <p className="hint">
              Link the project to your app's folder: it's saved in <code>store-assets/{(doc && platformOf(doc)) ?? "…"}</code> inside it, and the editor and the folder
              stay in sync both ways. An agent started in your app's folder then works on it directly, with this page open or not, and
              git tracks every change.
            </p>
            {folder ? (
              <p className="hint">
                This project syncs with <code>{projectPath(folder)}</code>.
              </p>
            ) : !open ? (
              <p className="hint">Open a project from a folder, or link one from the editor's top bar.</p>
            ) : canUseFolders ? (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  try {
                    const name = await linkFolder();
                    if (name) toast(`Linked to ${name}. Changes sync both ways.`);
                  } catch (e) {
                    if ((e as DOMException).name !== "AbortError") toast((e as Error).message, true);
                  }
                }}
              >
                <FolderPlus aria-hidden /> Link a folder
              </button>
            ) : (
              <p className="hint">Folder sync needs Chrome or Edge. Elsewhere, use Project .zip and unzip it into your repo.</p>
            )}
          </details>
        </div>
      </div>
    </div>
  );
}
