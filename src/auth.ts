import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import os from "os";

const TOKEN_DIR = path.join(os.homedir(), ".bulletin");
const TOKEN_PATH = path.join(TOKEN_DIR, "tokens.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

// All diagnostic output goes to stderr — MCP stdio uses stdout for protocol,
// stderr is captured by Claude Desktop as the server's log stream.
function diag(msg: string): void {
  console.error(`[kaba/auth] ${msg}`);
}

function getClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env"
    );
  }
  return { clientId, clientSecret };
}

export function createOAuth2Client() {
  const { clientId, clientSecret } = getClientConfig();
  // Log the credentials shape (never values) so misconfigs are visible.
  // Project number is the prefix before the first dash in a Google client ID,
  // e.g. "766640635273-abc123.apps.googleusercontent.com".
  const projectNum = clientId.split("-")[0];
  diag(
    `OAuth client: project=${projectNum} clientId="${clientId.slice(0, 24)}..." ` +
    `(idLen=${clientId.length}, secretLen=${clientSecret.length})`
  );
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

export function getAuthUrl(oauth2Client: InstanceType<typeof google.auth.OAuth2>): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(
  oauth2Client: InstanceType<typeof google.auth.OAuth2>,
  code: string
) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  await saveTokens(tokens);
  return tokens;
}

export async function saveTokens(tokens: unknown) {
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

let cachedClient: InstanceType<typeof google.auth.OAuth2> | null = null;

export async function getAuthenticatedClient() {
  if (cachedClient) return cachedClient;

  // Startup banner — once per process, helps identify what's actually loaded.
  diag(`startup: cwd=${process.cwd()}`);
  diag(`startup: tokenPath=${TOKEN_PATH}`);
  diag(`startup: dotenv .env loaded from ${process.cwd()} (whatever index.ts called dotenv.config() with)`);

  const oauth2Client = createOAuth2Client();
  const tokens = await loadTokens();

  if (!tokens) {
    diag(`tokens.json NOT FOUND at ${TOKEN_PATH}`);
    throw new Error(
      "Not authenticated. Run 'npm run init' to set up Google OAuth."
    );
  }

  // Log what we loaded — presence/shape only, never raw values
  const refresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  const access = typeof tokens.access_token === "string" ? tokens.access_token : "";
  const expiryDate = typeof tokens.expiry_date === "number" ? tokens.expiry_date : null;
  diag(
    `tokens loaded: fields=[${Object.keys(tokens).join(",")}] ` +
    `refresh_token=${refresh ? `"${refresh.slice(0, 8)}..." (len ${refresh.length})` : "MISSING"} ` +
    `access_token=${access ? `len ${access.length}` : "MISSING"} ` +
    `expiry=${expiryDate ? new Date(expiryDate).toISOString() : "n/a"} ` +
    `expired=${expiryDate ? expiryDate < Date.now() : "unknown"}`
  );

  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", async (newTokens) => {
    const nt = (newTokens || {}) as Record<string, unknown>;
    const newRefresh = typeof nt.refresh_token === "string" ? (nt.refresh_token as string) : "";
    diag(
      `'tokens' event: keys=[${Object.keys(nt).join(",")}] ` +
      `new_access=${nt.access_token ? "yes" : "no"} ` +
      `new_refresh=${newRefresh ? `"${newRefresh.slice(0, 8)}..." (len ${newRefresh.length})` : "absent"}`
    );

    // Google omits refresh_token on refresh responses, so the library emits it
    // as undefined. A naive spread would overwrite the good refresh_token on
    // disk with undefined and break re-auth on the next process restart.
    // Only merge fields that actually have a value.
    const existing = (await loadTokens()) || {};
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(nt)) {
      if (value !== undefined && value !== null) {
        merged[key] = value;
      }
    }
    await saveTokens(merged);
    const finalRefresh = typeof merged.refresh_token === "string" ? (merged.refresh_token as string) : "";
    diag(`tokens.json saved: refresh_token=${finalRefresh ? "preserved" : "MISSING (BUG)"}`);
  });

  // Proactive refresh probe — surfaces Google's exact error at startup
  // instead of waiting for the first tool call to fail. Non-fatal: if the
  // probe fails we still return the client so the process can serve a
  // useful error to the next tool call.
  try {
    const probe = await oauth2Client.getAccessToken();
    diag(
      `probe getAccessToken() OK: token issued (len ${probe.token?.length ?? 0}, ` +
      `from refresh=${access !== probe.token ? "yes" : "no/cached"})`
    );
  } catch (err: unknown) {
    const e = err as {
      message?: string;
      response?: { data?: { error?: string; error_description?: string } };
    };
    diag(
      `probe getAccessToken() FAILED: message="${e?.message ?? String(err)}" ` +
      `google_error=${e?.response?.data?.error ?? "unknown"} ` +
      `google_desc="${e?.response?.data?.error_description ?? "n/a"}"`
    );
  }

  cachedClient = oauth2Client;
  return oauth2Client;
}
