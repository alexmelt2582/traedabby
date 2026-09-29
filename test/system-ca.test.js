import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { enableSystemCACertificates, formatCAStatus } from "../src/lib/system-ca.js";

test("enabling the system roots is idempotent and never throws", () => {
  const first = enableSystemCACertificates();
  const second = enableSystemCACertificates();
  // The same object comes back, so repeated calls on the request path are free.
  assert.equal(first, second);
  assert.equal(typeof first.enabled, "boolean");
  assert.equal(typeof first.bundled, "number");
  assert.equal(typeof first.added, "number");
});

test("the status line always says something a user can read", () => {
  assert.match(formatCAStatus({ enabled: true, bundled: 100, added: 5 }), /系统证书/);
  assert.match(formatCAStatus({ enabled: true, bundled: 100, added: 0 }), /系统证书/);
  assert.match(formatCAStatus({ enabled: false, reason: "unsupported" }), /未启用/);
  assert.match(formatCAStatus(null), /未启用/);
});

test("widening the trusted roots never turns into skipping verification", async () => {
  const source = await readFile(new URL("../src/lib/system-ca.js", import.meta.url), "utf8");
  // Comments are stripped first: this module's own documentation names the two
  // forbidden constructs in order to warn against them.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // `rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0` would accept
  // any certificate; adding the system roots only widens where a complete chain
  // may terminate, which is exactly what Chromium already does on this machine.
  assert.equal(code.includes("rejectUnauthorized"), false);
  assert.equal(/NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]/.test(code), false);
  assert.equal(code.includes("setDefaultCACertificates"), true);
});