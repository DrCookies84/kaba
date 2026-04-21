import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

const FINGERPRINT_PATH = path.join(os.homedir(), ".bulletin", "client-fingerprint.json");

export interface FingerprintResult {
  match: boolean;
  current: string;
  saved: string | null;
  savedClientIdPrefix: string | null;
  reason: "match" | "no_saved_fingerprint" | "client_id_changed";
}

function fingerprint(clientId: string): string {
  return crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 16);
}

export async function checkFingerprint(
  clientId: string,
  fingerprintPath: string = FINGERPRINT_PATH
): Promise<FingerprintResult> {
  const current = fingerprint(clientId);
  let saved: string | null = null;
  let savedClientIdPrefix: string | null = null;

  try {
    const data = await fs.readFile(fingerprintPath, "utf-8");
    const parsed = JSON.parse(data);
    if (typeof parsed.fingerprint === "string") saved = parsed.fingerprint;
    if (typeof parsed.client_id_prefix === "string") savedClientIdPrefix = parsed.client_id_prefix;
  } catch {
    // No fingerprint file — first run post-upgrade or post-init
  }

  if (saved === null) {
    return { match: true, current, saved: null, savedClientIdPrefix: null, reason: "no_saved_fingerprint" };
  }
  if (saved === current) {
    return { match: true, current, saved, savedClientIdPrefix, reason: "match" };
  }
  return { match: false, current, saved, savedClientIdPrefix, reason: "client_id_changed" };
}

export async function saveFingerprint(
  clientId: string,
  fingerprintPath: string = FINGERPRINT_PATH
): Promise<void> {
  const payload = JSON.stringify(
    {
      fingerprint: fingerprint(clientId),
      client_id_prefix: clientId.slice(0, 24),
      saved_at: new Date().toISOString(),
    },
    null,
    2
  );
  await fs.mkdir(path.dirname(fingerprintPath), { recursive: true });
  await fs.writeFile(fingerprintPath, payload, "utf-8");
}
