import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccountStore } from "../src/lib/accounts.js";
import { traeStorageKeys } from "../src/lib/trae-storage.js";

async function tempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "trae-enhancer-test-"));
}

function storageFixture() {
  return {
    theme: "light",
    [traeStorageKeys.USERTAG_KEY]: "secret-usertag",
    "iCubeAuthInfo://icube-dc:1360520616887347": "secret-device",
    "iCubeAuthInfo://icube.cloudide": "secret-auth",
    "iCubeServerData://icube.cloudide": JSON.stringify({
      account: { userId: "1026288307407252", email: "tester@example.com" },
    }),
    "iCubeEntitlementInfo://icube.cloudide": JSON.stringify({
      entitlement_base_info: { user_id: "1026288307407252" },
    }),
  };
}

test("backup stores the auth snapshot separately from the public index", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const result = await store.backupCurrent(storageFixture(), { now: 500 });
    assert.equal(result.account.userId, "1026288307407252");
    assert.equal(result.account.displayName, "tester@example.com");

    const snapshotText = await fs.readFile(store.snapshotPath(result.account.id), "utf8");
    assert.match(snapshotText, /secret-auth/);
    assert.doesNotMatch(snapshotText, /"theme"/);

    const indexText = await fs.readFile(store.indexPath, "utf8");
    assert.doesNotMatch(indexText, /secret-auth|secret-device|secret-usertag/);
    assert.match(indexText, /1026288307407252/);

    const accounts = await store.list();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].maskedUserId, "************7252");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("backup updates one identity instead of creating duplicates", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const first = await store.backupCurrent(storageFixture(), { now: 100 });
    const second = await store.backupCurrent(storageFixture(), { now: 200 });
    assert.equal(first.account.id, second.account.id);
    assert.equal((await store.list()).length, 1);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

