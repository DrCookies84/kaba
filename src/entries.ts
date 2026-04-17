import { google } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";
import {
  findDocByThreadId,
  extractTextFromDoc,
} from "./bulletins.js";
import type { BulletinEntry, AppendEntryResult } from "./types.js";
import crypto from "crypto";

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

export function parseEntries(text: string): BulletinEntry[] {
  // Remove frontmatter — if no closing --- found, treat whole doc as body
  const fmStart = text.indexOf("---");
  const fmEnd = fmStart !== -1 ? text.indexOf("---", fmStart + 3) : -1;
  const body = (fmEnd !== -1 ? text.slice(fmEnd + 3) : text).trim();
  if (!body) return [];

  // Split on entry headers: ## [timestamp] — author
  // Accept em dash, en dash, or hyphen (Google Docs autocorrect can swap these)
  const entryPattern = /## \[([^\]]+)\][\s]*[—–-][\s]*(.+)/g;
  const entries: BulletinEntry[] = [];
  const matches: { index: number; timestamp: string; author: string }[] = [];

  let match;
  while ((match = entryPattern.exec(body)) !== null) {
    matches.push({
      index: match.index,
      timestamp: match[1],
      author: match[2].trim(),
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const headerEnd =
      body.indexOf("\n", matches[i].index) + 1;
    const contentEnd =
      i + 1 < matches.length ? matches[i + 1].index : body.length;
    const content = body.slice(headerEnd, contentEnd).trim();

    entries.push({
      timestamp: matches[i].timestamp,
      author: matches[i].author,
      content,
    });
  }

  return entries;
}

export async function readBulletin(
  threadId: string,
  limit: number = 20
): Promise<BulletinEntry[]> {
  const result = await findDocByThreadId(threadId);
  if (!result) {
    throw new Error(`No KaBa found with thread_id "${threadId}".`);
  }

  const text = extractTextFromDoc(result.doc);
  const entries = parseEntries(text);

  // Return most recent N entries, newest first
  return entries.reverse().slice(0, limit);
}

export async function appendBulletin(
  threadId: string,
  content: string,
  author: string
): Promise<AppendEntryResult> {
  const auth = await getAuthenticatedClient();
  const docs = google.docs({ version: "v1", auth });

  const result = await findDocByThreadId(threadId);
  if (!result) {
    throw new Error(`No KaBa found with thread_id "${threadId}".`);
  }

  const { docId, doc } = result;

  // Find the end of the document
  const body = doc.body;
  if (!body?.content) {
    throw new Error("Document has no content.");
  }

  const lastElement = body.content[body.content.length - 1];
  const endIndex = lastElement.endIndex! - 1; // Before the trailing newline

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const entryId = crypto.randomUUID().slice(0, 8);

  const entryText = `\n---\n\n## [${timestamp}] — ${author}\n\n${content}\n`;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: endIndex },
            text: entryText,
          },
        },
      ],
    },
  });

  return { entry_id: entryId, timestamp };
}
