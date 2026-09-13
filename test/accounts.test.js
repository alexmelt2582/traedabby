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

test("saving a snapshot repairs stale public metadata", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const saved = await store.backupCurrent(storageFixture(), { now: 100 });
    const snapshot = await store.readSnapshot(saved.account.id);
    const authKey = "iCubeAuthInfo://icube.cloudide";
    snapshot.keys[authKey] = JSON.stringify({
      userId: "1026288307407252",
      account: { userId: "1026288307407252", username: "修复后的昵称" },
    });
    await store.saveSnapshot(saved.account.id, snapshot, { now: 200 });
    const [account] = await store.list();
    assert.equal(account.nickname, "修复后的昵称");
    assert.equal(account.displayName, "修复后的昵称");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("account snapshots can be exported and imported without duplicates", async () => {
  const sourceDir = await tempDir();
  const targetDir = await tempDir();
  try {
    const source = new AccountStore(sourceDir);
    const saved = await source.backupCurrent(storageFixture(), { now: 100 });
    const exported = await source.exportSnapshots([saved.account.id]);
    assert.equal(exported.length, 1);

    const target = new AccountStore(targetDir);
    const first = await target.importSnapshots(exported, { now: 200 });
    assert.equal(first.imported, 1);
    assert.equal(first.updated, 0);
    assert.equal((await target.list()).length, 1);

    const second = await target.importSnapshots(exported, { now: 300 });
    assert.equal(second.imported, 0);
    assert.equal(second.updated, 1);
    assert.equal((await target.list()).length, 1);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(targetDir, { recursive: true, force: true });
  }
});
