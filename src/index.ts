// TLS/transport workaround: rebuild the default HTTPS agent before any
// OAuth/HTTPS calls. Two concerns handled here:
//   1. TLS-intercepting security software (Avast/Nord) — load an extra CA
//      bundle when launcher env passthrough is unavailable.
//   2. keepAlive (2026-07-01): node >=24.17 flipped https.globalAgent's
//      keepAlive default to true. node-fetch (gaxios's transport) then reuses a
//      pooled TLS connection and drops the token-endpoint response mid-body ->
//      "Invalid response body ... Premature close" on every OAuth refresh.
//      Reproduced under v24.17 (fails) vs v22.19 (works); keepAlive:false fixes
//      it under both. Forcing a fresh connection per request restores pre-24.17
//      behavior. Replace the binding (node-fetch reads https.globalAgent at
//      request time) rather than mutating .options, which the Agent ignores
//      post-construction.
import fsSync from "node:fs";
import tls from "node:tls";
import https from "node:https";
import path from "node:path";
import os from "node:os";
(() => {
  const opts: https.AgentOptions = { keepAlive: false };
  const BUNDLE = path.join(os.homedir(), "windows-ca-bundle.pem");
  if (fsSync.existsSync(BUNDLE)) {
    const pem = fsSync.readFileSync(BUNDLE, "utf-8");
    const certs =
      pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    if (certs.length) opts.ca = [...tls.rootCertificates, ...certs];
  }
  https.globalAgent = new https.Agent(opts);
})();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

// Lazy-load (2026-07-09): bulletins.js/entries.js pull in googleapis —
// ~1,800 files / most of the 166MB dep graph. Loading that at startup put
// cold module load past Claude Desktop's fixed 60s initialize timeout
// whenever the AV re-scans the graph (e.g. after an app update ships a new
// built-in node.exe and resets its scan reputation). Import them on first
// tool call instead: initialize answers in <2s regardless of disk state,
// and the one-time load cost lands inside a tool call, which tolerates it.
type Impl = typeof import("./bulletins.js") & typeof import("./entries.js");
let _impl: Impl | null = null;
async function impl(): Promise<Impl> {
  if (!_impl) {
    const [bulletins, entries] = await Promise.all([
      import("./bulletins.js"),
      import("./entries.js"),
    ]);
    _impl = { ...bulletins, ...entries };
  }
  return _impl;
}

dotenv.config();

const server = new McpServer({
  name: "kaba",
  version: "0.2.4",
});

// Tool 1: create_bulletin
server.tool(
  "create_bulletin",
  "Create a new bulletin (Google Doc) for persistent journaling. Max 10 active bulletins.",
  {
    thread_id: z.string().describe("Unique identifier for this bulletin thread"),
    title: z.string().describe("Human-readable title for the bulletin"),
  },
  async ({ thread_id, title }) => {
    try {
      const result = await (await impl()).createBulletin(thread_id, title);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: list_bulletins
server.tool(
  "list_bulletins",
  "List all bulletins. By default hides archived ones.",
  {
    include_archived: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include archived bulletins in the list"),
  },
  async ({ include_archived }) => {
    try {
      const result = await (await impl()).listBulletins(include_archived);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: read_bulletin
server.tool(
  "read_bulletin",
  "Read entries from a bulletin. Call this at the start of a new session to inherit context from previous sessions. Returns most recent entries first.",
  {
    thread_id: z.string().describe("The thread_id of the bulletin to read"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Maximum number of entries to return (default 20)"),
  },
  async ({ thread_id, limit }) => {
    try {
      const result = await (await impl()).readBulletin(thread_id, limit);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: append_bulletin
server.tool(
  "append_bulletin",
  "Append a new entry to a bulletin at the end of a session, or when something worth remembering happens. Append-only — no edits or deletes from this tool.",
  {
    thread_id: z.string().describe("The thread_id of the bulletin to append to"),
    content: z.string().describe("The entry content (markdown supported)"),
    author: z.string().describe("Who is writing this entry"),
  },
  async ({ thread_id, content, author }) => {
    try {
      const result = await (await impl()).appendBulletin(thread_id, content, author);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: archive_bulletin
server.tool(
  "archive_bulletin",
  "Archive a bulletin. Does not delete — just hides from default listing.",
  {
    thread_id: z.string().describe("The thread_id of the bulletin to archive"),
  },
  async ({ thread_id }) => {
    try {
      const result = await (await impl()).archiveBulletin(thread_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KaBa MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
