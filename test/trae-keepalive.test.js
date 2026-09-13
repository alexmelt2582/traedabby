import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS,
  isKeepaliveDue,
  parseDuration,
} from "../src/lib/trae-keepalive.js";

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
