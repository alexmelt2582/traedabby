/**
 * Guards the account-delete path across the storage, daemon, and panel layers.
 *
 * Deletion is local-only, but it is still destructive: the index must be the
 * first source of truth, the active account must be protected, and the panel
 * must require explicit confirmation before calling the endpoint.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("account deletion is wired through the daemon and protected by the active identity", () => {
  const source = read("src/daemon.js");
  assert.match(source, /\/api\/accounts\/delete/);
  assert.match(source, /deleteAccount\(accountId\)/);
  assert.match(source, /当前正在使用的账号不能删除/);
});

test("the panel exposes delete only through an explicit confirmation flow", () => {
  const source = read("src/ui/inject.js");
  assert.match(source, /te-acc-delete/);
  assert.match(source, /输入“删除”确认/);
  assert.match(source, /value\.trim\(\) !== "删除"/);
  assert.match(source, /\/api\/accounts\/delete/);
  assert.match(source, /account\.id === currentAccountId/);
});
