import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccountStore } from "../src/lib/accounts.js";
import { isKeepaliveDue } from "../src/lib/trae-keepalive.js";
import { isDeviceIdentity, readDeviceIdentity } from "../src/lib/device-identity.js";
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

/**
 * Creates one account through the real backup path, then records the keep-alive
 * state the sweep would have left behind. The auth record is plain JSON, which is
 * also what `readAuthFromSnapshot` reads back out of a stored snapshot.
 */
async function seedAccount(store, { auth, keepalive = null, userId = "1026288307407252" }) {
  const email = `${userId}@example.com`;
  const root = {
    ...storageFixture(),
    "iCubeAuthInfo://icube.cloudide": JSON.stringify(auth),
    "iCubeServerData://icube.cloudide": JSON.stringify({ account: { userId, email } }),
    "iCubeEntitlementInfo://icube.cloudide": JSON.stringify({
      entitlement_base_info: { user_id: userId },
    }),
  };
  const saved = await store.backupCurrent(root, { now: 100 });
  if (keepalive) await store.saveKeepalive(saved.account.id, keepalive);
  return saved.account.id;
}

test("backup mints a device identity and reuses it on later backups", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    // A live TRAE storage snapshot has no deviceIdentity; the add/adopt path must
    // mint one so every account carries a fixed identity.
    const first = await store.backupCurrent(storageFixture(), { now: 500 });
    const firstSnapshot = await store.readSnapshot(first.account.id);
    assert.equal(isDeviceIdentity(firstSnapshot.deviceIdentity), true);
    const firstIdentity = readDeviceIdentity(firstSnapshot);

    // A later backup of the same account keeps the same identity (no re-mint).
    const second = await store.backupCurrent(storageFixture(), { now: 900 });
    const secondSnapshot = await store.readSnapshot(second.account.id);
    assert.deepEqual(readDeviceIdentity(secondSnapshot), firstIdentity);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

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
    // The daemon logs this flag when it adopts the signed-in account on its own, and
    // the panel's fallback path can run at the same time — both must be safe.
    assert.equal(first.createdSnapshot, true);
    assert.equal(second.createdSnapshot, false);
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

test("deleting an account removes only its index record and snapshot", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const keepId = await seedAccount(store, {
      userId: "1000000000000011",
      auth: { accessToken: "keep-token", expiredAt: "2026-09-28T13:58:26.609Z" },
    });
    const removeId = await seedAccount(store, {
      userId: "1000000000000012",
      auth: { accessToken: "remove-token", expiredAt: "2026-09-28T13:58:26.609Z" },
    });

    const deleted = await store.deleteAccount(removeId);
    assert.equal(deleted.id, removeId);
    assert.deepEqual((await store.list()).map((account) => account.id), [keepId]);
    await assert.rejects(fs.access(store.snapshotPath(removeId)));
    assert.equal(await store.deleteAccount(removeId), null);
    await assert.rejects(store.deleteAccount("../outside"), /Invalid account id/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("repairIndex removes sentinel email values", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    await store.backupCurrent(storageFixture(), { now: 100 });
    const index = await store.readIndex();
    index.accounts[0].email = "unknown";
    await fs.writeFile(store.indexPath, JSON.stringify(index), "utf8");

    const repaired = await store.repairIndex();
    assert.equal(repaired.repaired, 1);
    const saved = await store.readIndex();
    assert.equal(saved.accounts[0].email, null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("account insights and phone metadata are exposed without touching snapshots", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const saved = await store.backupCurrent(storageFixture(), { now: 100 });
    const updated = await store.saveInsights(
      saved.account.id,
      {
        plan: "Free",
        quota: { model: "fast_request", fastAvailable: 0 },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      { now: 200 },
    );
    assert.equal(updated.insights.plan, "Free");
    const snapshot = await store.readSnapshot(saved.account.id);
    assert.equal(Object.hasOwn(snapshot, "insights"), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("account check-in metadata is exposed without touching snapshots", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const saved = await store.backupCurrent(storageFixture(), { now: 100 });
    const updated = await store.saveCheckin(
      saved.account.id,
      {
        date: "2026-09-13",
        checkedInToday: true,
        credits: 150,
        reward: 50,
        updatedAt: "2026-09-13T00:00:00.000Z",
      },
      { now: 200 },
    );
    assert.equal(updated.checkin.checkedInToday, true);
    assert.equal(updated.checkin.reward, 50);
    const snapshot = await store.readSnapshot(saved.account.id);
    assert.equal(Object.hasOwn(snapshot, "checkin"), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("account keepalive metadata is exposed without touching snapshots", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const saved = await store.backupCurrent(storageFixture(), { now: 100 });
    const updated = await store.saveKeepalive(
      saved.account.id,
      {
        status: "ok",
        tokenRefreshed: true,
        insightsUpdated: true,
        updatedAt: "2026-09-14T00:00:00.000Z",
      },
      { now: 200 },
    );
    assert.equal(updated.keepalive.status, "ok");
    assert.equal(updated.keepalive.tokenRefreshed, true);
    const snapshot = await store.readSnapshot(saved.account.id);
    assert.equal(Object.hasOwn(snapshot, "keepalive"), false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("the live identity is reported as matched, not-managed or unknown", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);

    // Nothing saved yet, so the live account is simply not one we manage.
    assert.deepEqual(await store.resolveActiveAccount(storageFixture()), {
      id: null,
      state: "not-managed",
    });

    const saved = await store.backupCurrent(storageFixture(), { now: 100 });
    assert.deepEqual(await store.resolveActiveAccount(storageFixture()), {
      id: saved.account.id,
      state: "matched",
    });

    // No usable identity in storage: the question cannot be answered, and this is
    // the state in which rotating a refresh token is unsafe.
    assert.deepEqual(await store.resolveActiveAccount({ theme: "dark" }), {
      id: null,
      state: "unknown",
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("an account outside the saved list is not-managed rather than unknown", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    await store.backupCurrent(storageFixture(), { now: 100 });

    // TRAE holds a different account. Rotating anything we saved cannot disturb
    // that session, so keep-alive must not be blocked by a false "unknown".
    const otherRoot = {
      ...storageFixture(),
      "iCubeServerData://icube.cloudide": JSON.stringify({
        account: { userId: "9999999999999999", email: "other@example.com" },
      }),
      "iCubeEntitlementInfo://icube.cloudide": JSON.stringify({
        entitlement_base_info: { user_id: "9999999999999999" },
      }),
    };
    assert.deepEqual(await store.resolveActiveAccount(otherRoot), {
      id: null,
      state: "not-managed",
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("a new account exposes its credential expiry as soon as it is saved", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const saved = await store.backupCurrent(
      {
        ...storageFixture(),
        "iCubeAuthInfo://icube.cloudide": JSON.stringify({
          accessToken: "token",
          expiredAt: "2026-09-28T13:58:26.609Z",
          refreshExpiredAt: "2026-10-08T13:58:26.609Z",
        }),
      },
      { now: 100 },
    );

    const [account] = await store.list();
    assert.equal(account.id, saved.account.id);
    assert.equal(account.keepalive.accessExpiresAt, "2026-09-28T13:58:26.609Z");
    assert.equal(account.keepalive.refreshExpiresAt, "2026-10-08T13:58:26.609Z");
    // Expiry is display metadata, not a completed sweep.
    assert.equal(account.keepalive.status, undefined);
    assert.equal(account.keepalive.updatedAt, undefined);
    assert.equal(
      isKeepaliveDue({ keepalive: account.keepalive }, { now: Date.now() }),
      true,
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("the credential expiry is filled from the snapshot the sweep would read", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const syncedAt = "2026-09-01T00:00:00.000Z";
    await seedAccount(store, {
      keepalive: { status: "ok", reason: "scheduled", updatedAt: syncedAt },
      auth: {
        accessToken: "token",
        expiredAt: "2026-09-28T13:58:26.609Z",
        refreshExpiredAt: "2026-10-08T13:58:26.609Z",
      },
    });

    assert.equal(await store.fillCredentialExpiryFromSnapshots(), 1);
    const [account] = await store.list();
    assert.equal(account.keepalive.accessExpiresAt, "2026-09-28T13:58:26.609Z");
    assert.equal(account.keepalive.refreshExpiresAt, "2026-10-08T13:58:26.609Z");

    // `status` and `updatedAt` still belong to the sweep. Stamping a fresh
    // timestamp here would read as a just-finished sync and postpone the real
    // one by a whole interval.
    assert.equal(account.keepalive.status, "ok");
    assert.equal(account.keepalive.updatedAt, syncedAt);
    assert.equal(
      isKeepaliveDue({ keepalive: account.keepalive }, { now: Date.now() }),
      true,
    );

    // A second open changes nothing and does not double-count.
    assert.equal(await store.fillCredentialExpiryFromSnapshots(), 0);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("the credential expiry fill leaves every state the sweep owns alone", async () => {
  const dataDir = await tempDir();
  try {
    const store = new AccountStore(dataDir);
    const known = "2026-09-20T00:00:00.000Z";
    const failure = { status: "error", error: "refresh token is invalid", updatedAt: known };
    await seedAccount(store, {
      userId: "1000000000000001",
      keepalive: failure,
      auth: { accessToken: "token", expiredAt: "2026-09-28T13:58:26.609Z" },
    });
    await seedAccount(store, {
      userId: "1000000000000002",
      keepalive: { status: "ok", accessExpiresAt: known, updatedAt: known },
      auth: { accessToken: "token", expiredAt: "2026-09-28T13:58:26.609Z" },
    });
    await seedAccount(store, {
      userId: "1000000000000003",
      auth: { accessToken: "token-without-an-expiry" },
    });
    const brokenId = await seedAccount(store, {
      userId: "1000000000000004",
      auth: { accessToken: "token", expiredAt: "2026-09-28T13:58:26.609Z" },
    });

    // A snapshot whose auth record cannot be decoded must not abort the whole fill.
    const snapshotPath = store.snapshotPath(brokenId);
    const broken = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    broken.keys[`${traeStorageKeys.AUTH_PREFIX}icube.cloudide`] = "not-a-decodable-auth-record";
    await fs.writeFile(snapshotPath, JSON.stringify(broken));

    // Nothing is missing for the legacy fill to copy here: the failure and
    // existing value are owned by the sweep, one has no expiry, and the broken
    // snapshot already got its expiry from the backup that created it.
    assert.equal(await store.fillCredentialExpiryFromSnapshots(), 0);
    const byId = new Map((await store.list()).map((account) => [account.id, account]));
    const byUser = new Map([...byId.values()].map((account) => [account.userId, account]));
    const failed = byUser.get("1000000000000001");
    assert.equal(failed.keepalive.accessExpiresAt, undefined);
    assert.deepEqual(failed.keepalive, failure);
    assert.equal(byId.size, 4);
    assert.equal(byUser.get("1000000000000002").keepalive.accessExpiresAt, known);
    assert.equal(byUser.get("1000000000000003").keepalive, null);
    assert.equal(
      byUser.get("1000000000000004").keepalive.accessExpiresAt,
      "2026-09-28T13:58:26.609Z",
    );
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
