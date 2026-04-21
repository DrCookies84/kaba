import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { checkFingerprint, saveFingerprint } from "../src/fingerprint.js";

const TEST_DIR = path.join(os.tmpdir(), `kaba-fingerprint-test-${process.pid}`);
const TEST_PATH = path.join(TEST_DIR, "client-fingerprint.json");

const CLIENT_A = "111111111111-abc123.apps.googleusercontent.com";
const CLIENT_B = "222222222222-xyz789.apps.googleusercontent.com";

before(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("fingerprint", () => {
  it("reports no_saved_fingerprint on first run (missing file)", async () => {
    await fs.rm(TEST_PATH, { force: true });
    const result = await checkFingerprint(CLIENT_A, TEST_PATH);
    assert.equal(result.match, true);
    assert.equal(result.reason, "no_saved_fingerprint");
    assert.equal(result.saved, null);
  });

  it("matches after save with the same client_id", async () => {
    await saveFingerprint(CLIENT_A, TEST_PATH);
    const result = await checkFingerprint(CLIENT_A, TEST_PATH);
    assert.equal(result.match, true);
    assert.equal(result.reason, "match");
    assert.equal(result.saved, result.current);
  });

  it("detects mismatch when client_id changes", async () => {
    await saveFingerprint(CLIENT_A, TEST_PATH);
    const result = await checkFingerprint(CLIENT_B, TEST_PATH);
    assert.equal(result.match, false);
    assert.equal(result.reason, "client_id_changed");
    assert.notEqual(result.saved, result.current);
    assert.equal(result.savedClientIdPrefix, CLIENT_A.slice(0, 24));
  });

  it("stores only public info (client_id prefix + hash, never client_secret)", async () => {
    await saveFingerprint(CLIENT_A, TEST_PATH);
    const raw = await fs.readFile(TEST_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed.fingerprint);
    assert.equal(parsed.client_id_prefix, CLIENT_A.slice(0, 24));
    assert.equal("client_secret" in parsed, false);
    assert.equal("access_token" in parsed, false);
    assert.equal("refresh_token" in parsed, false);
  });
});
