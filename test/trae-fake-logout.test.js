import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccountStore } from "../src/lib/accounts.js";
import { writeJsonAtomic } from "../src/lib/json-file.js";
import { TraeFakeLogoutManager } from "../src/lib/trae-fake-logout.js";
import {
  extractIdentityFromSnapshot,
  extractAuthSnapshot,
  traeStorageKeys,
} from "../src/lib/trae-storage.js";

function rootForUser(userId, marker = "preserved") {
  return {
    marker,
    [traeStorageKeys.USERTAG_KEY]: JSON.stringify({ [userId]: "row" }),
    "iCubeAuthInfo://icube-dc:1360520616887347": JSON.stringify({
      privateKeyPEM: `private-${userId}`,
      publicKeyPEM: `public-${userId}`,
    }),
    "iCubeAuthInfo://icube.cloudide": JSON.stringify({
      userId,
      account: {
        userId,
        username: `User ${userId.slice(-4)}`,
        scope: "marscode",
        loginScope: "trae",
      },
    }),
    "iCubeServerData://icube.cloudide": JSON.stringify({
      account: { userId },
      entitlementInfo: { entitlement_base_info: { userId } },
    }),
  };
}

async function waitForStatus(manager, sessionId, status, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = manager.status(sessionId);
    if (result.status === status) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fake logout status ${status}`);
}

async function fixture({ sessionTimeoutMs = 2000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-fake-logout-test-"));
  const storagePath = path.join(dir, "storage.json");
  await writeJsonAtomic(storagePath, rootForUser("1111111111111111"));
  return {
    dir,
    storagePath,
    sessionPath: path.join(dir, "fake-logout", "session.json"),
    accountStore: new AccountStore(path.join(dir, "data")),
    sessionTimeoutMs,
  };
}

test("fake logout saves a newly logged-in account and preserves non-auth state", async () => {
  const context = await fixture();
  try {
    let starts = 0;
    let syncedAccountId = null;
    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {},
      startTrae: async () => {
        starts += 1;
        if (starts === 1) {
          await writeJsonAtomic(context.storagePath, rootForUser("2222222222222222"));
        }
        return true;
      },
      pollIntervalMs: 5,
      settleMs: 5,
      onAccountSaved: async (account) => {
        syncedAccountId = account.id;
      },
      logger: { log() {}, error() {} },
    });

    const started = await manager.start();
    const completed = await waitForStatus(manager, started.sessionId, "complete");
    assert.equal(completed.account.userId, "2222222222222222");
    assert.equal(completed.originalAccount.userId, "1111111111111111");
    assert.equal((await context.accountStore.list()).length, 2);
    assert.ok(syncedAccountId, "the new account was not synchronized after saving");

    const storageRoot = JSON.parse(await fs.readFile(context.storagePath, "utf8"));
    assert.equal(storageRoot.marker, "preserved");
    const identity = extractIdentityFromSnapshot(extractAuthSnapshot(storageRoot));
    assert.equal(identity.userId, "2222222222222222");
  } finally {
    await fs.rm(context.dir, { recursive: true, force: true });
  }
});

test("cancelling fake logout restores the original authentication state", async () => {
  const context = await fixture({ sessionTimeoutMs: 5000 });
  try {
    let stops = 0;
    let starts = 0;
    let running = false;
    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {
        stops += 1;
        running = false;
      },
      startTrae: async () => {
        starts += 1;
        running = true;
        return true;
      },
      isTraeRunning: async () => running,
      pollIntervalMs: 5,
      settleMs: 5,
      logger: { log() {}, error() {} },
    });

    const started = await manager.start();
    await waitForStatus(manager, started.sessionId, "awaiting_login");
    assert.equal(await manager.cancel(started.sessionId), true);
    const cancelled = await waitForStatus(manager, started.sessionId, "cancelled");
    assert.match(cancelled.message, /原账号已恢复/);
    assert.equal(stops, 2);
    assert.equal(starts, 2);

    const storageRoot = JSON.parse(await fs.readFile(context.storagePath, "utf8"));
    assert.equal(storageRoot.marker, "preserved");
    const identity = extractIdentityFromSnapshot(extractAuthSnapshot(storageRoot));
    assert.equal(identity.userId, "1111111111111111");
  } finally {
    await fs.rm(context.dir, { recursive: true, force: true });
  }
});

test("fake logout timeout restores the original account instead of leaving it logged out", async () => {
  const context = await fixture({ sessionTimeoutMs: 60 });
  try {
    let running = false;
    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {
        running = false;
      },
      startTrae: async () => {
        running = true;
        return true;
      },
      isTraeRunning: async () => running,
      pollIntervalMs: 10,
      settleMs: 5,
      logger: { log() {}, error() {} },
    });

    const started = await manager.start();
    const result = await waitForStatus(manager, started.sessionId, "cancelled");
    assert.match(result.message, /登录失败/);
    const storageRoot = JSON.parse(await fs.readFile(context.storagePath, "utf8"));
    const identity = extractIdentityFromSnapshot(extractAuthSnapshot(storageRoot));
    assert.equal(identity.userId, "1111111111111111");
  } finally {
    await fs.rm(context.dir, { recursive: true, force: true });
  }
});

test("recovery saves a new account that logged in while the daemon was down", async () => {
  const context = await fixture();
  try {
    await context.accountStore.backupCurrent(rootForUser("1111111111111111"));
    const originalSnapshot = extractAuthSnapshot(rootForUser("1111111111111111"));
    const now = Date.now();
    await writeJsonAtomic(context.sessionPath, {
      schemaVersion: 1,
      sessionId: "recover-new-account",
      status: "awaiting_login",
      message: "waiting",
      error: null,
      account: null,
      originalAccount: {
        id: "acct_original",
        displayName: "Original",
        userId: "1111111111111111",
      },
      originalSnapshot,
      originalUserId: "1111111111111111",
      createdAt: now - 1000,
      updatedAt: now - 1000,
      expiresAt: now + 10_000,
    });
    await writeJsonAtomic(context.storagePath, rootForUser("2222222222222222"));

    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {},
      startTrae: async () => true,
      isTraeRunning: async () => true,
      pollIntervalMs: 5,
      settleMs: 5,
      logger: { log() {}, error() {} },
    });

    const recovered = await manager.recover();
    const completed = await waitForStatus(manager, recovered.sessionId, "complete");
    assert.equal(completed.account.userId, "2222222222222222");
    assert.equal((await context.accountStore.list()).length, 2);
    await assert.rejects(() => fs.access(context.sessionPath));
  } finally {
    await fs.rm(context.dir, { recursive: true, force: true });
  }
});

test("recovery restores the original account after an expired interruption", async () => {
  const context = await fixture();
  try {
    const originalSnapshot = extractAuthSnapshot(rootForUser("1111111111111111"));
    const clearedRoot = rootForUser("1111111111111111");
    for (const key of Object.keys(clearedRoot)) {
      if (key.startsWith("iCube")) delete clearedRoot[key];
    }
    await writeJsonAtomic(context.storagePath, clearedRoot);
    const now = Date.now();
    await writeJsonAtomic(context.sessionPath, {
      schemaVersion: 1,
      sessionId: "recover-expired",
      status: "awaiting_login",
      message: "waiting",
      error: null,
      account: null,
      originalAccount: {
        id: "acct_original",
        displayName: "Original",
        userId: "1111111111111111",
      },
      originalSnapshot,
      originalUserId: "1111111111111111",
      createdAt: now - 2000,
      updatedAt: now - 2000,
      expiresAt: now - 1,
    });

    let running = false;
    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {
        running = false;
      },
      startTrae: async () => {
        running = true;
        return true;
      },
      isTraeRunning: async () => running,
      pollIntervalMs: 5,
      settleMs: 5,
      logger: { log() {}, error() {} },
    });

    const recovered = await manager.recover();
    const cancelled = await waitForStatus(manager, recovered.sessionId, "cancelled");
    assert.match(cancelled.message, /原账号已恢复/);
    const storageRoot = JSON.parse(await fs.readFile(context.storagePath, "utf8"));
    const identity = extractIdentityFromSnapshot(extractAuthSnapshot(storageRoot));
    assert.equal(identity.userId, "1111111111111111");
    await assert.rejects(() => fs.access(context.sessionPath));
  } finally {
    await fs.rm(context.dir, { recursive: true, force: true });
  }
});
