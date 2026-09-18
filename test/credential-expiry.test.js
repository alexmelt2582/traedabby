/**
 * Guards the expiry-driven credential story end to end.
 *
 * Four files have to agree for this to work at run time: the keep-alive module
 * decides when a credential may be exchanged, the refresh layer acts on that,
 * the daemon records the resulting expiry, and the panel renders it.
 *
 * None of them is covered behaviourally here — the panel has no DOM and no test
 * loads `src/daemon.js` — so a dropped field or a stale label would otherwise
 * ship silently. These assertions read the sources directly.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const injectSource = read("src/ui/inject.js");
const daemonSource = read("src/daemon.js");
const refreshSource = read("src/lib/trae-refresh.js");

test("keep-alive exchanges the credential only when it is about to expire", () => {
  assert.match(refreshSource, /shouldRotateCredentials\(auth, \{ now \}\)/);
  assert.match(refreshSource, /refreshedToken,/);
});

test("the daemon records the real rotation outcome instead of assuming one", () => {
  assert.match(daemonSource, /tokenRefreshed: refreshed\.refreshedToken,/);
  assert.doesNotMatch(daemonSource, /tokenRefreshed: true,/);
});

test("the daemon stores both expiry fields on the keep-alive record", () => {
  assert.match(daemonSource, /accessExpiresAt: auth\.expiredAt \|\| null,/);
  assert.match(daemonSource, /refreshExpiresAt: auth\.refreshExpiredAt \|\| null,/);
});

test("the active account path carries the same expiry fields", () => {
  assert.match(daemonSource, /auth = readAuthFromSnapshot\(snapshot\) \|\| \{\};/);
});

test("the account meta row shows the expiry, not an internal term", () => {
  assert.match(injectSource, /<span class="te-meta-label">有效期至<\/span>/);
  assert.doesNotMatch(injectSource, /te-meta-label">保活</);
  assert.doesNotMatch(injectSource, /te-meta-label">凭据</);
});

test("the expiry view renders a full timestamp and covers every band", () => {
  assert.match(injectSource, /function accountCredentialView\(account\)/);
  assert.doesNotMatch(injectSource, /function accountKeepaliveView\(/);
  assert.match(injectSource, /function formatExpiry\(value\)/);
  assert.doesNotMatch(injectSource, /formatDay/);
  assert.match(injectSource, /label: `已过期 \$\{stamp\}`/);
  assert.match(injectSource, /label: `即将过期 \$\{stamp\}`/);
  assert.match(injectSource, /label: "-",/);
  assert.match(injectSource, /state: "warning"/);
  assert.match(injectSource, /\.te-keepalive-state\.warning \{/);
});

test("the panel reads the expiry the daemon wrote", () => {
  assert.match(injectSource, /keepalive\?\.accessExpiresAt/);
});

test("both transfer dialogs warn that an export is a migration", () => {
  assert.match(injectSource, /\.te-transfer-note \{/);
  const notes = injectSource.match(/createTransferNote\(/g) || [];
  assert.equal(notes.length, 3, "expected one definition and two call sites");
  assert.match(injectSource, /会被顶下线/);
  assert.match(injectSource, /搬迁/);
});

test("the about list no longer advertises unconditional keep-alive", () => {
  assert.doesNotMatch(injectSource, /为非当前账号定期刷新登录凭据和额度/);
  // The entry must keep saying a credential is only replaced near expiry.
  // Advertising a periodic refresh is what gets other devices kicked offline.
  assert.match(injectSource, /只在临近到期时才换新/);
});

test("the panel avoids the internal vocabulary for credentials", () => {
  // 「凭据 / 轮换 / 登录态 / 保活」都是实现侧的说法，面板上出现过就被问过。
  assert.doesNotMatch(injectSource, /凭据/);
  assert.doesNotMatch(injectSource, /轮换/);
  assert.doesNotMatch(injectSource, /登录态/);
});
