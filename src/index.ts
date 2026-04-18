import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

import { createBulletin, listBulletins, archiveBulletin } from "./bulletins.js";
import { readBulletin, appendBulletin } from "./entries.js";

dotenv.config();

const server = new McpServer({
  name: "kaba",
  version: "0.2.2",
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
      const result = await createBulletin(thread_id, title);
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
      const result = await listBulletins(include_archived);
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
      const result = await readBulletin(thread_id, limit);
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
      const result = await appendBulletin(thread_id, content, author);
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
      const result = await archiveBulletin(thread_id);
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
