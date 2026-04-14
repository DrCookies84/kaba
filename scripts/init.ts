import dotenv from "dotenv";
import http from "http";
import { URL } from "url";
import { createOAuth2Client, getAuthUrl, exchangeCode, loadTokens } from "../src/auth.js";

dotenv.config();

async function init() {
  console.log("\n=== Bulletin MCP — First-Time Setup ===\n");

  // Check if already authenticated
  const existing = await loadTokens();
  if (existing) {
    console.log("Existing tokens found at ~/.bulletin/tokens.json");
    console.log("You're already authenticated. Delete tokens.json to re-auth.\n");
    process.exit(0);
  }

  // Verify env vars
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
    console.error("Copy .env.example to .env and fill in your Google OAuth credentials.");
    console.error("\nTo get credentials:");
    console.error("1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("2. Create an OAuth 2.0 Client ID (Desktop or Web app)");
    console.error("3. Add http://localhost:3000/oauth2callback as a redirect URI");
    console.error("4. Copy Client ID and Client Secret to .env\n");
    process.exit(1);
  }

  const oauth2Client = createOAuth2Client();
  const authUrl = getAuthUrl(oauth2Client);

  console.log("Opening browser for Google OAuth...\n");
  console.log("If the browser doesn't open, visit this URL:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization...\n");

  // Open browser
  const { exec } = await import("child_process");
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start "" "${authUrl}"`);
  } else if (platform === "darwin") {
    exec(`open "${authUrl}"`);
  } else {
    exec(`xdg-open "${authUrl}"`);
  }

  // Start local server to catch the callback
  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost:3000");
        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400);
          res.end(`Authorization error: ${error}`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("No authorization code received.");
          server.close();
          reject(new Error("No code received"));
          return;
        }

        await exchangeCode(oauth2Client, code);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Bulletin MCP authorized!</h1><p>You can close this tab.</p></body></html>"
        );

        console.log("Authorization successful! Tokens saved to ~/.bulletin/tokens.json");
        console.log("\nSetup complete. You can now use Bulletin MCP.\n");

        server.close();
        resolve();
      } catch (err) {
        res.writeHead(500);
        res.end("Internal error during authorization.");
        server.close();
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log("Listening on http://localhost:3000 for OAuth callback...");
    });
  });
}

init().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
