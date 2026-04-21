import fs from "fs";
import path from "path";
import os from "os";

const LOG_DIR = path.join(os.homedir(), ".bulletin");
const LOG_PATH = path.join(LOG_DIR, "auth-debug.log");
const LOG_PREVIOUS = path.join(LOG_DIR, "auth-debug.log.1");
const MAX_BYTES = 1_000_000;

function rotateIfNeeded(): void {
  try {
    const st = fs.statSync(LOG_PATH);
    if (st.size >= MAX_BYTES) {
      try {
        fs.unlinkSync(LOG_PREVIOUS);
      } catch {
        // No previous file — fine
      }
      fs.renameSync(LOG_PATH, LOG_PREVIOUS);
    }
  } catch {
    // Log file doesn't exist yet — nothing to rotate
  }
}

function write(level: string, event: string, data?: unknown): void {
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      pid: process.pid,
      level,
      event,
      ...(data !== undefined ? { data } : {}),
    }) + "\n";

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_PATH, line, "utf-8");
  } catch {
    // Disk log unavailable — don't crash the server over logging
  }

  // Stderr mirror. Claude Desktop's MCP host captures stderr unreliably (that's
  // why v0.2.2's stderr-only logging was invisible), but terminal users benefit.
  try {
    process.stderr.write(`[kaba/auth] ${level} ${event}${data !== undefined ? ` ${JSON.stringify(data)}` : ""}\n`);
  } catch {
    // Stderr closed — ignore
  }
}

export const logger = {
  info(event: string, data?: unknown): void {
    write("info", event, data);
  },
  warn(event: string, data?: unknown): void {
    write("warn", event, data);
  },
  error(event: string, data?: unknown): void {
    write("error", event, data);
  },
};

export const LOG_PATHS = { current: LOG_PATH, previous: LOG_PREVIOUS };
