import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("the accounts API exposes the three-state TRAE authentication result", () => {
  const source = read("src/daemon.js");
  assert.match(source, /resolveActiveAccount\(storageRoot\)/);
  assert.match(source, /currentAccountState = active\.state/);
  assert.match(source, /currentAccountState,/);
});

test("saving a new login synchronizes check-in and credits before completion", () => {
  const source = read("src/daemon.js");
  assert.match(source, /async function synchronizeSavedAccount/);
  assert.match(source, /runAccountCheckin\(\[account\.id\]/);
  assert.match(source, /refreshAccountsInsights\(\[account\.id\]\)/);
  assert.match(source, /onAccountSaved:/);
});
