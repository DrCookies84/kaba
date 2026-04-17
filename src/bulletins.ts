import { google, docs_v1 } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";
import type {
  BulletinFrontmatter,
  BulletinSummary,
  CreateBulletinResult,
  ArchiveResult,
} from "./types.js";

const FOLDER_NAME = "Bulletin";
const MAX_ACTIVE_BULLETINS = 10;

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>
): Promise<string> {
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  return folder.data.id!;
}

function buildFrontmatter(
  threadId: string,
  title: string,
  owner: string
): string {
  const now = new Date().toISOString();
  return [
    "---",
    `thread_id: ${threadId}`,
    `title: ${title}`,
    `created: ${now}`,
    `owner: ${owner}`,
    `schema_version: 1`,
    `archived: false`,
    "---",
    "",
  ].join("\n");
}

export function parseFrontmatter(text: string): BulletinFrontmatter | null {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split("\n");
  const data: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    data[key] = value;
  }

  return {
    thread_id: data.thread_id || "",
    title: data.title || "",
    created: data.created || "",
    owner: data.owner || "",
    schema_version: parseInt(data.schema_version || "1", 10),
    archived: data.archived === "true",
  };
}

function extractTextFromDoc(doc: docs_v1.Schema$Document): string {
  let text = "";
  const content = doc.body?.content;
  if (!content) return text;

  for (const element of content) {
    if (element.paragraph) {
      for (const elem of element.paragraph.elements || []) {
        if (elem.textRun?.content) {
          text += elem.textRun.content;
        }
      }
    }
  }
  return text;
}

export async function createBulletin(
  threadId: string,
  title: string
): Promise<CreateBulletinResult> {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  // Check active bulletin count
  const existing = await listBulletins(false);
  if (existing.length >= MAX_ACTIVE_BULLETINS) {
    throw new Error(
      `Maximum ${MAX_ACTIVE_BULLETINS} active KaBas reached. Archive one before creating a new one.`
    );
  }

  // Check for duplicate thread_id
  const allBulletins = await listBulletins(true);
  if (allBulletins.some((b) => b.thread_id === threadId)) {
    throw new Error(`A KaBa with thread_id "${threadId}" already exists.`);
  }

  const folderId = await getOrCreateFolder(drive);

  // Create the Google Doc
  const doc = await docs.documents.create({
    requestBody: { title: `Bulletin: ${title}` },
  });
  const docId = doc.data.documentId!;

  // Move doc into Bulletin folder
  await drive.files.update({
    fileId: docId,
    addParents: folderId,
    fields: "id, parents",
  });

  // Get owner email from drive about
  const about = await drive.about.get({ fields: "user" });
  const owner = about.data.user?.emailAddress || "unknown";

  // Write frontmatter
  const frontmatter = buildFrontmatter(threadId, title, owner);
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: frontmatter,
          },
        },
      ],
    },
  });

  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

  return { thread_id: threadId, doc_id: docId, doc_url: docUrl };
}

export async function listBulletins(
  includeArchived: boolean = false
): Promise<BulletinSummary[]> {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  // Find Bulletin folder
  const folderRes = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (!folderRes.data.files || folderRes.data.files.length === 0) {
    return [];
  }
  const folderId = folderRes.data.files[0].id!;

  // List docs in folder
  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (!filesRes.data.files) return [];

  const bulletins: BulletinSummary[] = [];

  for (const file of filesRes.data.files) {
    const doc = await docs.documents.get({ documentId: file.id! });
    const text = extractTextFromDoc(doc.data);
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    if (!includeArchived && fm.archived) continue;

    bulletins.push({
      thread_id: fm.thread_id,
      title: fm.title,
      doc_url: `https://docs.google.com/document/d/${file.id}/edit`,
      doc_id: file.id!,
      created: fm.created,
      archived: fm.archived,
    });
  }

  return bulletins;
}

export async function findDocByThreadId(
  threadId: string
): Promise<{ docId: string; doc: docs_v1.Schema$Document } | null> {
  const auth = await getAuthenticatedClient();
  const drive = google.drive({ version: "v3", auth });
  const docs = google.docs({ version: "v1", auth });

  const folderRes = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (!folderRes.data.files || folderRes.data.files.length === 0) return null;
  const folderId = folderRes.data.files[0].id!;

  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (!filesRes.data.files) return null;

  for (const file of filesRes.data.files) {
    const doc = await docs.documents.get({ documentId: file.id! });
    const text = extractTextFromDoc(doc.data);
    const fm = parseFrontmatter(text);
    if (fm && fm.thread_id === threadId) {
      return { docId: file.id!, doc: doc.data };
    }
  }

  return null;
}

export { extractTextFromDoc };

export async function archiveBulletin(
  threadId: string
): Promise<ArchiveResult> {
  const auth = await getAuthenticatedClient();
  const docs = google.docs({ version: "v1", auth });

  const result = await findDocByThreadId(threadId);
  if (!result) {
    throw new Error(`No KaBa found with thread_id "${threadId}".`);
  }

  const { docId, doc } = result;
  const text = extractTextFromDoc(doc);

  // Find and replace "archived: false" with "archived: true" in frontmatter
  const archivedMatch = text.match(/archived: false/);
  if (!archivedMatch) {
    throw new Error("KaBa is already archived or frontmatter is malformed.");
  }

  // Find the position in the document
  const offset = text.indexOf("archived: false");
  if (offset === -1) {
    throw new Error("Could not locate archived field in document.");
  }

  // +1 for the document body start index
  const startIndex = offset + 1;
  const endIndex = startIndex + "archived: false".length;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          deleteContentRange: {
            range: { startIndex, endIndex },
          },
        },
        {
          insertText: {
            location: { index: startIndex },
            text: "archived: true",
          },
        },
      ],
    },
  });

  return { thread_id: threadId, archived: true };
}
