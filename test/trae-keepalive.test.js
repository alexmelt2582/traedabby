import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ACCESS_TOKEN_THRESHOLD_MS,
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS,
  DEFAULT_REFRESH_TOKEN_THRESHOLD_MS,
  isKeepaliveDue,
  parseDuration,
  shouldRotateCredentials,
  toMillis,
} from "../src/lib/trae-keepalive.js";
import { refreshAuthSnapshotIfNeeded } from "../src/lib/trae-refresh.js";

const NOW = Date.parse("2026-09-18T00:00:00.000Z");

test("keepalive duration parsing accepts positive integer values", () => {
  assert.equal(parseDuration("3600000", 1000), 3_600_000);
  assert.equal(parseDuration("invalid", 1000), 1000);
  assert.equal(parseDuration("-1", 1000), 1000);
  assert.equal(parseDuration(null, 1000), 1000);
});

test("accounts without a keepalive record are immediately due", () => {
  assert.equal(isKeepaliveDue({}, { now: 1_000_000 }), true);
});

test("successful keepalive waits for the normal refresh interval", () => {
  const record = {
    keepalive: {
      status: "ok",
      updatedAt: new Date(0).toISOString(),
    },
  };
  assert.equal(
    isKeepaliveDue(record, {
      now: DEFAULT_KEEPALIVE_INTERVAL_MS - 1,
    }),
    false,
  );
  assert.equal(
    isKeepaliveDue(record, {
      now: DEFAULT_KEEPALIVE_INTERVAL_MS,
    }),
    true,
  );
});

test("failed keepalive retries after the shorter retry interval", () => {
  const record = {
    keepalive: {
      status: "error",
      updatedAt: new Date(0).toISOString(),
    },
  };
  assert.equal(
    isKeepaliveDue(record, {
      now: DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS - 1,
    }),
    false,
  );
  assert.equal(
    isKeepaliveDue(record, {
      now: DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS,
    }),
    true,
  );
});

test("timestamps are read from ISO strings and from second or millisecond epochs", () => {
  const millis = Date.parse("2026-09-30T00:00:00.000Z");
  assert.equal(toMillis("2026-09-30T00:00:00.000Z"), millis);
  assert.equal(toMillis(Math.floor(millis / 1000)), millis);
  assert.equal(toMillis(millis), millis);
  assert.equal(toMillis(null), null);
  assert.equal(toMillis(""), null);
  assert.equal(toMillis("not-a-date"), null);
  assert.equal(toMillis(0), null);
});

test("a credential with days left is used instead of rotated", () => {
  assert.equal(
    shouldRotateCredentials(
      {
        expiredAt: "2026-09-30T00:00:00.000Z",
        refreshExpiredAt: "2027-03-15T00:00:00.000Z",
      },
      { now: NOW },
    ),
    false,
  );
});

test("rotation fires once the access token is inside the threshold", () => {
  assert.equal(
    shouldRotateCredentials(
      {
        expiredAt: new Date(NOW + DEFAULT_ACCESS_TOKEN_THRESHOLD_MS - 1).toISOString(),
        refreshExpiredAt: "2027-03-15T00:00:00.000Z",
      },
      { now: NOW },
    ),
    true,
  );
});

test("an expired access token rotates", () => {
  assert.equal(
    shouldRotateCredentials(
      {
        expiredAt: new Date(NOW - 1).toISOString(),
        refreshExpiredAt: "2027-03-15T00:00:00.000Z",
      },
      { now: NOW },
    ),
    true,
  );
});

test("the refresh token is a long-stop guard a month before it lapses", () => {
  assert.equal(
    shouldRotateCredentials(
      {
        expiredAt: "2026-09-30T00:00:00.000Z",
        refreshExpiredAt: new Date(NOW + DEFAULT_REFRESH_TOKEN_THRESHOLD_MS - 1).toISOString(),
      },
      { now: NOW },
    ),
    true,
  );
});

test("a refresh expiry that merely mirrors the access expiry is ignored", () => {
  const mirrored = "2026-09-30T00:00:00.000Z";
  assert.equal(
    shouldRotateCredentials({ expiredAt: mirrored, refreshExpiredAt: mirrored }, { now: NOW }),
    false,
  );
});

test("missing expiry fields rotate conservatively", () => {
  assert.equal(shouldRotateCredentials({}, { now: NOW }), true);
  assert.equal(shouldRotateCredentials(null, { now: NOW }), true);
  assert.equal(
    shouldRotateCredentials({ expiredAt: "2026-09-30T00:00:00.000Z" }, { now: NOW }),
    false,
  );
});

test("a raw numeric expiresAt field is accepted as a fallback", () => {
  const expiresAt = Math.floor(Date.parse("2026-09-30T00:00:00.000Z") / 1000);
  assert.equal(shouldRotateCredentials({ expiresAt }, { now: NOW }), false);
});

test("a switch candidate with days left is reused instead of rotated", async () => {
  const snapshot = {
    keys: {
      "iCubeAuthInfo://icube.cloudide": JSON.stringify({
        accessToken: "token",
        refreshToken: "refresh-token",
        expiredAt: "2026-09-30T00:00:00.000Z",
        refreshExpiredAt: "2027-03-15T00:00:00.000Z",
      }),
    },
  };
  const result = await refreshAuthSnapshotIfNeeded(snapshot, { now: NOW });
  assert.equal(result.refreshedToken, false);
  assert.equal(result.snapshot, snapshot);
  assert.equal(result.auth.accessToken, "token");
});
