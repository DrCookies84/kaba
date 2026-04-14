export interface BulletinFrontmatter {
  thread_id: string;
  title: string;
  created: string;
  owner: string;
  schema_version: number;
  archived: boolean;
}

export interface BulletinSummary {
  thread_id: string;
  title: string;
  doc_url: string;
  doc_id: string;
  created: string;
  archived: boolean;
}

export interface BulletinEntry {
  timestamp: string;
  author: string;
  content: string;
}

export interface CreateBulletinResult {
  thread_id: string;
  doc_id: string;
  doc_url: string;
}

export interface AppendEntryResult {
  entry_id: string;
  timestamp: string;
}

export interface ArchiveResult {
  thread_id: string;
  archived: boolean;
}
