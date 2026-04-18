import { google } from "googleapis";
import fs from "fs/promises";
import path from "path";
import os from "os";

const TOKEN_DIR = path.join(os.homedir(), ".bulletin");
const TOKEN_PATH = path.join(TOKEN_DIR, "tokens.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

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

  const oauth2Client = createOAuth2Client();
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error(
      "Not authenticated. Run 'npm run init' to set up Google OAuth."
    );
  }
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", async (newTokens) => {
    // Google omits refresh_token on refresh responses, so the library emits it
    // as undefined. A naive spread would overwrite the good refresh_token on
    // disk with undefined and break re-auth on the next process restart.
    // Only merge fields that actually have a value.
    const existing = (await loadTokens()) || {};
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(newTokens as Record<string, unknown>)) {
      if (value !== undefined && value !== null) {
        merged[key] = value;
      }
    }
    await saveTokens(merged);
  });

  cachedClient = oauth2Client;
  return oauth2Client;
}
