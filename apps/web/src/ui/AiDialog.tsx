import { useState } from "react";
import { Check, Copy, FolderPlus, X } from "lucide-react";
import { useEditor } from "../state/store.ts";
import { canUseFolders } from "../state/io.ts";
import { linkFolder } from "../engine/folderSync.ts";
import { toast } from "./toast.ts";

/**
 * How to let Claude or another AI agent work on the screenshots. The agent
 * runs the storeshots MCP server on the user's machine, pointed at the
 * project's folder; the editor keeps that folder in sync, so the agent's
 * changes appear here as it makes them.
 */

export const PACKAGE = "storeshots-mcp-server";

type Client = "claude-code" | "claude-desktop" | "cursor" | "other";

const CLIENTS: Array<{ id: Client; label: string }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
  { id: "other", label: "Other MCP clients" },
];

export function setupSnippet(client: Client, folder: string): { note: string; code: string; lang: string } {
  const rel = `./${folder}`;
  const abs = `/path/to/${folder}`;
  const json = (path: string) =>
    JSON.stringify({ mcpServers: { storeshots: { command: "npx", args: ["-y", PACKAGE, "--project", path] } } }, null, 2);
  switch (client) {
    case "claude-code":
      return {
        note: `In a terminal, in the folder that contains ${folder}:`,
        code: `claude mcp add storeshots -- npx -y ${PACKAGE} --project ${rel}`,
        lang: "bash",
      };
    case "claude-desktop":
      return {
        note: `Settings → Developer → Edit Config, then add this to claude_desktop_config.json (use the full path to ${folder}) and restart Claude:`,
        code: json(abs),
        lang: "json",
      };
    case "cursor":
      return { note: `Add this to .cursor/mcp.json in your app's repo:`, code: json(rel), lang: "json" };
    default:
      return {
        note: "Any MCP client that runs local (stdio) servers can start it with:",
        code: `npx -y ${PACKAGE} --project ${abs}`,
        lang: "bash",
      };
  }
}

export const EXAMPLE_PROMPTS = [
  "Check the screenshots and fix anything the stores would reject or that's hard to read.",
  "Rewrite every caption to be under 30 characters, keeping the meaning.",
  "Move the phones up so they don't run off the bottom, on every screen.",
  "Use the Simulator's iPhone 17 Pro bezel for all phones.",
  "Change the brand colour to #2F6FEB and fix any text that becomes hard to read.",
];

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code">
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

export function AiSetup({ folderName }: { folderName: string }) {
  const [client, setClient] = useState<Client>("claude-code");
  const snippet = setupSnippet(client, folderName);
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

export function AiDialog({ onClose }: { onClose: () => void }) {
  const folder = useEditor((s) => s.folder);
  const open = useEditor((s) => s.doc !== null);
  const folderName = folder?.name ?? "store-assets";
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
            its changes appear here as it makes them.
          </p>

          <ol className="steps">
            <li>
              <b>Keep the project in a folder</b>
              {folder ? (
                <p className="hint">
                  This project syncs with <code>{folder.name}</code>. Changes go both ways automatically.
                </p>
              ) : !open ? (
                <p className="hint">Open a project from a folder, or link one from the editor's top bar.</p>
              ) : canUseFolders ? (
                <>
                  <p className="hint">Pick a folder, ideally inside your app's repo. The project is saved there and kept in sync.</p>
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
                </>
              ) : (
                <p className="hint">
                  Syncing with a folder needs Chrome or Edge. In this browser, use Project .zip, unzip it into your repo, and point the
                  agent at that folder.
                </p>
              )}
            </li>
            <li>
              <b>Add the MCP server to your AI tool</b>
              <AiSetup folderName={folderName} />
              <p className="hint">Needs Node.js 20 or later. Nothing is uploaded: the server runs on your computer and only touches that folder.</p>
            </li>
            <li>
              <b>Ask for what you want</b>
              <ul className="prompts">
                {EXAMPLE_PROMPTS.map((p) => (
                  <li key={p}>“{p}”</li>
                ))}
              </ul>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
