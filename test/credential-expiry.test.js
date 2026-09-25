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
  const renew = daemonSource.match(/async function renewOneAccount\(account\) \{[\s\S]*?\n\}/);
  assert.ok(renew, "renewOneAccount was not found");
  // The manual renew is the one place that exchanges on purpose, so `true` there
  // is a record of what it just did. Everywhere else reports the sweep's outcome.
  assert.match(renew[0], /tokenRefreshed: true,/);
  assert.doesNotMatch(daemonSource.replace(renew[0], ""), /tokenRefreshed: true,/);
});

test("a manual renewal reports an unchanged expiry rather than claiming a renewal", () => {
  const renew = daemonSource.match(/async function renewOneAccount\(account\) \{[\s\S]*?\n\}/)[0];
  assert.match(renew, /const previousExpiresAt = before\.expiredAt \|\| null;/);
  assert.match(
    renew,
    /const renewed = !!accessExpiresAt && accessExpiresAt !== previousExpiresAt;/,
  );
  // It exchanges unconditionally: the expiry gate belongs to the background sweep,
  // and a user asking for a renewal is the explicit decision to rotate now.
  assert.match(renew, /await refreshAuthSnapshot\(snapshot\)/);
  assert.doesNotMatch(renew, /refreshAuthSnapshotIfNeeded/);
  // The user only ever sees the date that decides whether the account still works.
  assert.match(renew, /accessExpiresAt,/);
});

test("a manual renewal refuses when the live session cannot be accounted for", () => {
  const route = daemonSource.match(/pathname === "\/api\/accounts\/renew"[\s\S]*?\n  \}/);
  assert.ok(route, "the renew route was not found");
  // Rotating while the live identity cannot be read could invalidate a session we
  // cannot see, so the action is refused rather than guessed at.
  assert.match(route[0], /active\.state === "unknown"/);
  // The same Cockpit Tools guard the sweep follows, because this path always rotates.
  assert.match(route[0], /const cockpit = await resolveCockpitPolicy\(\);/);
  // The account TRAE is using right now is maintained by TRAE itself.
  assert.match(route[0], /active\.id === accountId/);
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

test("the help page no longer advertises unconditional keep-alive", () => {
  assert.doesNotMatch(injectSource, /为非当前账号定期刷新登录凭据和额度/);
  // The copy must stay ordinary-user readable and still avoid promising a
  // periodic refresh that would get other devices kicked offline.
  assert.match(injectSource, /只在登录信息临近到期时才更新/);
  assert.doesNotMatch(injectSource, /通过 CDP 与本机 Trae 交互/);
});

test("the panel avoids the internal vocabulary for credentials", () => {
  // 「凭据 / 轮换 / 登录态 / 保活」都是实现侧的说法，面板上出现过就被问过。
  assert.doesNotMatch(injectSource, /凭据/);
  assert.doesNotMatch(injectSource, /轮换/);
  assert.doesNotMatch(injectSource, /登录态/);
});
