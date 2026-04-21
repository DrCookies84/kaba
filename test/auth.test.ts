import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  mergeTokenUpdate,
  handleTokensEvent,
  parseOAuthError,
  withAuthRecovery,
} from "../src/auth.js";

describe("mergeTokenUpdate (v0.2.1 regression)", () => {
  it("preserves existing refresh_token when the update omits it", () => {
    const existing = { refresh_token: "GOOD_RT", access_token: "OLD_AT" };
    const update = { access_token: "NEW_AT", expiry_date: 1234567890 };
    const merged = mergeTokenUpdate(existing, update);
    assert.equal(merged.refresh_token, "GOOD_RT");
    assert.equal(merged.access_token, "NEW_AT");
    assert.equal(merged.expiry_date, 1234567890);
  });

  it("skips undefined/null fields in the update (Google omits refresh_token on refresh)", () => {
    const existing = { refresh_token: "GOOD_RT", access_token: "OLD_AT" };
    const update: Record<string, unknown> = {
      access_token: "NEW_AT",
      refresh_token: undefined,
      id_token: null,
    };
    const merged = mergeTokenUpdate(existing, update);
    assert.equal(merged.refresh_token, "GOOD_RT");
    assert.equal(merged.access_token, "NEW_AT");
    assert.equal("id_token" in merged, false);
  });

  it("adds new fields from the update", () => {
    const existing = { access_token: "OLD" };
    const update = { access_token: "NEW", scope: "drive.file", token_type: "Bearer" };
    const merged = mergeTokenUpdate(existing, update);
    assert.equal(merged.scope, "drive.file");
    assert.equal(merged.token_type, "Bearer");
  });
});

describe("handleTokensEvent (v0.2.3 re-sync)", () => {
  it("persists the merged tokens to disk and re-syncs the client", async () => {
    const existing = { refresh_token: "GOOD_RT", access_token: "OLD_AT", expiry_date: 1 };
    let savedTokens: Record<string, unknown> | null = null;
    let setCredsCalledWith: Record<string, unknown> | null = null;

    const result = await handleTokensEvent(
      { access_token: "NEW_AT", expiry_date: 2 },
      async () => existing,
      async (t) => {
        savedTokens = t as Record<string, unknown>;
      },
      (t) => {
        setCredsCalledWith = t;
      }
    );

    assert.deepEqual(savedTokens, {
      refresh_token: "GOOD_RT",
      access_token: "NEW_AT",
      expiry_date: 2,
    });
    // Re-sync: the client's setCredentials must receive the same merged state
    // that went to disk. This guards against in-memory/disk drift.
    assert.deepEqual(setCredsCalledWith, savedTokens);
    assert.equal(result.resynced, true);
  });

  it("treats empty/null newTokens as a no-op merge", async () => {
    const existing = { refresh_token: "GOOD_RT", access_token: "OLD_AT" };
    let savedTokens: Record<string, unknown> | null = null;

    await handleTokensEvent(
      null,
      async () => existing,
      async (t) => {
        savedTokens = t as Record<string, unknown>;
      },
      () => {}
    );

    assert.deepEqual(savedTokens, existing);
  });
});

describe("parseOAuthError", () => {
  it("extracts error + description from a googleapis error shape", () => {
    const err = {
      message: "request failed",
      response: {
        status: 401,
        data: { error: "invalid_client", error_description: "The OAuth client was not found." },
      },
    };
    const parsed = parseOAuthError(err);
    assert.equal(parsed.oauthError, "invalid_client");
    assert.equal(parsed.description, "The OAuth client was not found.");
    assert.equal(parsed.status, 401);
  });

  it("returns nulls for non-OAuth errors", () => {
    const parsed = parseOAuthError(new Error("network down"));
    assert.equal(parsed.oauthError, null);
    assert.equal(parsed.description, null);
    assert.equal(parsed.message, "network down");
  });
});

// Minimal fake that mimics the setCredentials surface withAuthRecovery uses.
class FakeOAuth2Client {
  public credentials: Record<string, unknown> = {};
  public _clientId = "fake-client-id-1234567890.apps.googleusercontent.com";
  public _clientSecret = "fake-secret";
  setCredentials(tokens: Record<string, unknown>) {
    this.credentials = { ...tokens };
  }
}

describe("withAuthRecovery (v0.2.3 idle bug mitigation)", () => {
  it("succeeds on the first try without invoking recovery", async () => {
    const auth = new FakeOAuth2Client();
    let cacheCleared = 0;
    let resyncCalls = 0;

    const result = await withAuthRecovery(
      async () => auth as never,
      () => {
        cacheCleared++;
      },
      async () => {
        resyncCalls++;
        return null;
      },
      async () => "ok"
    );

    assert.equal(result, "ok");
    assert.equal(cacheCleared, 0);
    assert.equal(resyncCalls, 0);
  });

  it("rebuilds the client and retries once on invalid_client, then succeeds", async () => {
    let providerCalls = 0;
    const client1 = new FakeOAuth2Client();
    const client2 = new FakeOAuth2Client();
    let cacheCleared = 0;
    let resyncCalls = 0;

    const invalidClientErr = {
      message: "unauthorized",
      response: { status: 401, data: { error: "invalid_client", error_description: "..." } },
    };

    let callCount = 0;
    const result = await withAuthRecovery(
      async () => {
        providerCalls++;
        return (providerCalls === 1 ? client1 : client2) as never;
      },
      () => {
        cacheCleared++;
      },
      async () => {
        resyncCalls++;
        return { refresh_token: "RT", access_token: "AT" };
      },
      async (auth) => {
        callCount++;
        if (callCount === 1) throw invalidClientErr;
        // Second call must receive the rebuilt client
        assert.equal(auth, client2 as never);
        return "recovered";
      }
    );

    assert.equal(result, "recovered");
    assert.equal(providerCalls, 2);
    assert.equal(cacheCleared, 1);
    assert.equal(resyncCalls, 1);
    assert.equal(callCount, 2);
  });

  it("also recovers on unauthorized_client (the v0.2.2 era symptom)", async () => {
    let callCount = 0;
    const err = {
      response: { status: 401, data: { error: "unauthorized_client" } },
    };

    const result = await withAuthRecovery(
      async () => new FakeOAuth2Client() as never,
      () => {},
      async () => null,
      async () => {
        callCount++;
        if (callCount === 1) throw err;
        return "ok";
      }
    );

    assert.equal(result, "ok");
    assert.equal(callCount, 2);
  });

  it("does not recover on non-client-credential errors (re-throws)", async () => {
    const networkErr = new Error("ECONNREFUSED");
    let callCount = 0;

    await assert.rejects(
      () =>
        withAuthRecovery(
          async () => new FakeOAuth2Client() as never,
          () => {},
          async () => null,
          async () => {
            callCount++;
            throw networkErr;
          }
        ),
      /ECONNREFUSED/
    );

    assert.equal(callCount, 1, "should not retry on a non-OAuth error");
  });

  it("does not recover on invalid_grant (refresh token dead — genuine auth failure)", async () => {
    const invalidGrantErr = {
      response: { status: 400, data: { error: "invalid_grant" } },
    };
    let callCount = 0;

    await assert.rejects(
      () =>
        withAuthRecovery(
          async () => new FakeOAuth2Client() as never,
          () => {},
          async () => null,
          async () => {
            callCount++;
            throw invalidGrantErr;
          }
        )
    );

    assert.equal(callCount, 1, "invalid_grant means the refresh token is dead — retry won't help");
  });

  it("throws an actionable error if recovery also fails with invalid_client", async () => {
    const err = { response: { status: 401, data: { error: "invalid_client" } } };
    let callCount = 0;

    await assert.rejects(
      () =>
        withAuthRecovery(
          async () => new FakeOAuth2Client() as never,
          () => {},
          async () => null,
          async () => {
            callCount++;
            throw err;
          }
        ),
      /genuine credentials problem.*delete ~\/\.bulletin\/tokens\.json/s
    );

    assert.equal(callCount, 2, "recovery should retry exactly once");
  });
});
