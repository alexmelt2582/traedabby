/**
 * Guards the one change that makes an intranet machine work.
 *
 * Node ignores the Windows certificate store, so behind a proxy that decrypts
 * TLS every request failed with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` while TRAE
 * itself kept working — Chromium reads that store, Node does not. These tests
 * pin the merge, and pin down the shortcut that must never replace it.
 *
 * The end-to-end proof — a local self-signed server that fails with
 * `DEPTH_ZERO_SELF_SIGNED_CERT` before the call and answers HTTP 200 after it —
 * is recorded in the module's own comment instead of being repeated here: it
 * needs a live socket and a fixture certificate, while the assertions below are
 * the part that can regress silently.
 *
 * `tls.getCACertificates("default")` is deliberately not used to verify the
 * merge. Measured on Node 22.22.2: the store holds 116 roots, node ships 144,
 * the union is 203 after de-duplication, and reading the default set back after
 * `setDefaultCACertificates` reports 179 — a different number again, so that
 * read-back cannot prove anything either way.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { enableSystemCACertificates, formatCAStatus } from "../src/lib/system-ca.js";

const SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "system-ca.js",
);

test("enabling reads node's own roots and the Windows store", () => {
  const status = enableSystemCACertificates();
  assert.equal(status.enabled, true, status.reason ?? "");
  assert.ok(status.bundled > 0, "node always ships a root list");
  assert.ok(status.added > 0, "a Windows store always holds roots node does not ship");
});

test("the call is idempotent so several entry points cannot pile up roots", () => {
  const first = enableSystemCACertificates();
  const second = enableSystemCACertificates();
  assert.equal(first, second, "the cached result must be the same object");
});

test("trust is widened, never disabled", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  // Widening the root set is the fix. Accepting any certificate is not a fix,
  // and it is the shortcut this test exists to prevent: it would make an
  // intranet machine work today and expose every request on any network.
  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
  // The module's own comment names this variable to explain why it is not used,
  // so match the assignment rather than any mention of it.
  assert.doesNotMatch(source, /process\.env\.NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.match(source, /setDefaultCACertificates/, "the roots are never actually installed");
});

test("the status reads as a line a support call can quote", () => {
  assert.match(formatCAStatus(enableSystemCACertificates()), /系统证书/);
  assert.match(formatCAStatus({ enabled: false, reason: "boom", bundled: 0, added: 0 }), /boom/);
});
