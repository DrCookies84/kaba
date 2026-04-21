import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { logger } from "./logger.js";
import { checkFingerprint, saveFingerprint } from "./fingerprint.js";

const TOKEN_DIR = path.join(os.homedir(), ".bulletin");
const TOKEN_PATH = path.join(TOKEN_DIR, "tokens.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

interface OAuthErrorShape {
  message: string;
  oauthError: string | null;
  description: string | null;
  status: number | null;
}

function getClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env");
  }
  return { clientId, clientSecret };
}

export function createOAuth2Client(): OAuth2Client {
  const { clientId, clientSecret } = getClientConfig();
  const projectNum = clientId.split("-")[0];
  logger.info("oauth_client_created", {
    project: projectNum,
    client_id_prefix: clientId.slice(0, 24),
    id_len: clientId.length,
    secret_len: clientSecret.length,
  });
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

export function getAuthUrl(oauth2Client: OAuth2Client): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(oauth2Client: OAuth2Client, code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  await saveTokens(tokens);
  const { clientId } = getClientConfig();
  await saveFingerprint(clientId);
  logger.info("oauth_code_exchanged", tokenSnapshot(tokens as Record<string, unknown>));
  return tokens;
}

export async function saveTokens(tokens: unknown): Promise<void> {
  await fs.mkdir(TOKEN_DIR, { recursive: true });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");
}

export async function loadTokens(): Promise<Record<string, unknown> | null> {
  try {
    const data = await fs.readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Merge a token update from Google into the existing on-disk tokens.
 *
 * v0.2.1 guarantee: skip undefined/null so Google's refresh response (which
 * omits refresh_token) doesn't wipe the good one. Pure — testable in isolation.
 */
export function mergeTokenUpdate(
  existing: Record<string, unknown>,
  update: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged;
}

/**
 * Run the refresh-event handler logic. Extracted for testability — the callers
 * in auth.ts wire this to the live OAuth2Client's 'tokens' event, but tests
 * invoke it directly with fake load/save/setCredentials functions.
 */
export async function handleTokensEvent(
  newTokens: Record<string, unknown> | null | undefined,
  loadFn: () => Promise<Record<string, unknown> | null>,
  saveFn: (tokens: Record<string, unknown>) => Promise<void>,
  setCredentialsFn: (tokens: Record<string, unknown>) => void
): Promise<{ merged: Record<string, unknown>; resynced: boolean }> {
  const nt = (newTokens || {}) as Record<string, unknown>;
  const existing = (await loadFn()) || {};
  const merged = mergeTokenUpdate(existing, nt);
  await saveFn(merged);
  setCredentialsFn(merged);
  return { merged, resynced: true };
}

export function parseOAuthError(err: unknown): OAuthErrorShape {
  const e = err as {
    message?: string;
    response?: { data?: { error?: string; error_description?: string }; status?: number };
  };
  return {
    message: e?.message ?? String(err),
    oauthError: e?.response?.data?.error ?? null,
    description: e?.response?.data?.error_description ?? null,
    status: e?.response?.status ?? null,
  };
}

function isClientCredentialError(parsed: OAuthErrorShape): boolean {
  return parsed.oauthError === "invalid_client" || parsed.oauthError === "unauthorized_client";
}

function tokenSnapshot(tokens: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!tokens) return { present: false };
  const refresh = typeof tokens.refresh_token === "string" ? (tokens.refresh_token as string) : "";
  const access = typeof tokens.access_token === "string" ? (tokens.access_token as string) : "";
  const expiryDate = typeof tokens.expiry_date === "number" ? (tokens.expiry_date as number) : null;
  return {
    fields: Object.keys(tokens),
    refresh_token: refresh ? { prefix: refresh.slice(0, 8), len: refresh.length } : "MISSING",
    access_token: access ? { len: access.length } : "MISSING",
    expiry_iso: expiryDate ? new Date(expiryDate).toISOString() : null,
    is_expired: expiryDate ? expiryDate < Date.now() : null,
    ms_until_expiry: expiryDate ? expiryDate - Date.now() : null,
  };
}

function clientCredentialsSnapshot(client: OAuth2Client): Record<string, unknown> {
  const c = client as unknown as Record<string, unknown>;
  const creds = (c.credentials ?? {}) as Record<string, unknown>;
  return {
    client_id_prefix: typeof c._clientId === "string" ? (c._clientId as string).slice(0, 24) : "unknown",
    client_secret_len: typeof c._clientSecret === "string" ? (c._clientSecret as string).length : null,
    in_memory_tokens: tokenSnapshot(creds),
  };
}

let cachedClient: OAuth2Client | null = null;

/**
 * Re-sync in-memory credentials from disk. Used after `on('tokens')` fires and
 * after auto-recovery rebuilds the client. Guards against the v0.2.3 idle bug:
 * if googleapis' internal credentials drift from what's on disk during idle,
 * we restore from the disk snapshot before handing the client back.
 */
async function syncClientFromDisk(client: OAuth2Client): Promise<Record<string, unknown> | null> {
  const onDisk = await loadTokens();
  if (!onDisk) return null;
  client.setCredentials(onDisk);
  return onDisk;
}

export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  if (cachedClient) return cachedClient;

  logger.info("startup", {
    cwd: process.cwd(),
    token_path: TOKEN_PATH,
    node_version: process.version,
    platform: process.platform,
  });

  const { clientId } = getClientConfig();
  const fpCheck = await checkFingerprint(clientId);
  if (!fpCheck.match) {
    logger.error("fingerprint_mismatch", fpCheck);
  } else {
    logger.info("fingerprint_check", fpCheck);
  }

  const oauth2Client = createOAuth2Client();
  const tokens = await loadTokens();

  if (!tokens) {
    logger.error("tokens_not_found", { path: TOKEN_PATH });
    throw new Error("Not authenticated. Run 'npm run init' to set up Google OAuth.");
  }

  logger.info("tokens_loaded", tokenSnapshot(tokens));

  oauth2Client.setCredentials(tokens);
  logger.info("client_configured", clientCredentialsSnapshot(oauth2Client));

  // Persist fingerprint once per process if missing — cheap idempotent write.
  if (fpCheck.reason === "no_saved_fingerprint") {
    await saveFingerprint(clientId);
  }

  // Token refresh hook. v0.2.1 fix: skip undefined/null on merge so Google's
  // refresh response (which omits refresh_token) doesn't wipe the good one on
  // disk. v0.2.3 addition: after persisting to disk, also re-call setCredentials
  // on the client so its in-memory state matches disk. This closes the window
  // where googleapis' internal credentials could drift from disk during idle.
  oauth2Client.on("tokens", async (newTokens) => {
    const nt = (newTokens || {}) as Record<string, unknown>;
    logger.info("tokens_event_received", {
      keys: Object.keys(nt),
      has_access: !!nt.access_token,
      has_refresh: !!nt.refresh_token,
      has_expiry: !!nt.expiry_date,
    });

    try {
      const { merged } = await handleTokensEvent(
        nt,
        loadTokens,
        saveTokens,
        (tokens) => oauth2Client.setCredentials(tokens)
      );
      logger.info("tokens_persisted", {
        merged_snapshot: tokenSnapshot(merged),
        in_memory_resynced: true,
      });
    } catch (err) {
      logger.error("tokens_persist_failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Proactive probe — surface exact Google error at startup rather than on first tool call.
  try {
    const probe = await oauth2Client.getAccessToken();
    logger.info("probe_ok", {
      token_len: probe.token?.length ?? 0,
      post_probe_state: clientCredentialsSnapshot(oauth2Client),
    });
  } catch (err) {
    const parsed = parseOAuthError(err);
    logger.error("probe_failed", parsed);
    if (isClientCredentialError(parsed)) {
      logger.error("probe_diagnosis", {
        interpretation: `Google rejected client credentials (${parsed.oauthError}). This is a client-level failure, not a token-level one — check client_id/client_secret in runtime env vs. what's registered in Google Cloud Console.`,
      });
    }
  }

  cachedClient = oauth2Client;
  return oauth2Client;
}

/**
 * Auto-recovery wrapper — retry once with a freshly-built client on any client-
 * credential OAuth error. Extracted from withAuth for testability.
 *
 * The v0.2.3 idle bug: after idle periods (1–5h observed), the next API call
 * fails with invalid_client even though on-disk tokens are correct and a server
 * restart recovers immediately. Likely cause: googleapis' in-memory OAuth2Client
 * credentials drift from disk during idle. The recovery strategy mirrors what a
 * manual restart does — clear the cached client, rebuild from disk, retry once.
 *
 * Logs loudly when it fires so we can see whether the underlying bug is still
 * happening even when the user doesn't notice a failure.
 */
export async function withAuthRecovery<T>(
  authProvider: () => Promise<OAuth2Client>,
  clearCache: () => void,
  resyncFromDisk: (client: OAuth2Client) => Promise<Record<string, unknown> | null>,
  fn: (auth: OAuth2Client) => Promise<T>
): Promise<T> {
  const auth = await authProvider();
  try {
    return await fn(auth);
  } catch (err) {
    const parsed = parseOAuthError(err);
    if (!isClientCredentialError(parsed)) throw err;

    logger.warn("auto_recovery_triggered", {
      reason: parsed.oauthError,
      description: parsed.description,
      http_status: parsed.status,
      pre_recovery_state: clientCredentialsSnapshot(auth),
      note: "Rebuilding OAuth2Client from disk and retrying once.",
    });

    clearCache();
    const freshAuth = await authProvider();
    const resynced = await resyncFromDisk(freshAuth);
    logger.info("auto_recovery_resynced", {
      disk_snapshot: tokenSnapshot(resynced),
      client_state: clientCredentialsSnapshot(freshAuth),
    });

    try {
      const result = await fn(freshAuth);
      logger.info("auto_recovery_succeeded", {});
      return result;
    } catch (retryErr) {
      const retryParsed = parseOAuthError(retryErr);
      logger.error("auto_recovery_failed", retryParsed);
      if (isClientCredentialError(retryParsed)) {
        throw new Error(
          `Google rejected KaBa credentials (${retryParsed.oauthError}) even after client rebuild. ` +
            `This indicates a genuine credentials problem, not the idle-state bug. ` +
            `Check: (1) Google Cloud Console — is the OAuth client still active? ` +
            `(2) Was the client_secret rotated since last init? ` +
            `(3) If "Testing" mode in OAuth consent screen, refresh tokens expire every 7 days. ` +
            `Recovery: delete ~/.bulletin/tokens.json and run 'npm run init'.`
        );
      }
      throw retryErr;
    }
  }
}

export async function withAuth<T>(fn: (auth: OAuth2Client) => Promise<T>): Promise<T> {
  return withAuthRecovery(
    getAuthenticatedClient,
    () => {
      cachedClient = null;
    },
    syncClientFromDisk,
    fn
  );
}

// Test-only exports — re-exported under a namespace to avoid expanding the public API
export const _internal = {
  parseOAuthError,
  isClientCredentialError,
  tokenSnapshot,
  clientCredentialsSnapshot,
  resetCache: () => {
    cachedClient = null;
  },
};
