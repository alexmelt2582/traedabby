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

async function waitForStatus(manager, sessionId, status, timeoutMs = 2000) {
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
  const transactionDir = path.join(dir, "transactions");
  await writeJsonAtomic(storagePath, rootForUser("1111111111111111"));
  return {
    dir,
    storagePath,
    transactionDir,
    accountStore: new AccountStore(path.join(dir, "data")),
    sessionTimeoutMs,
  };
}

test("fake logout saves a newly logged-in account and preserves non-auth state", async () => {
  const context = await fixture();
  try {
    let starts = 0;
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
      logger: { log() {}, error() {} },
    });

    const started = await manager.start();
    const completed = await waitForStatus(manager, started.sessionId, "complete");
    assert.equal(completed.account.userId, "2222222222222222");
    assert.equal(completed.originalAccount.userId, "1111111111111111");
    assert.equal((await context.accountStore.list()).length, 2);

    const storageRoot = JSON.parse(await fs.readFile(context.storagePath, "utf8"));
    assert.equal(storageRoot.marker, "preserved");
    const identity = extractIdentityFromSnapshot(extractAuthSnapshot(storageRoot));
    assert.equal(identity.userId, "2222222222222222");
  } finally {
    await fs.rm(context.dir, { recursive: true, force: true });
  }
});

test("cancelling fake logout restores the original authentication state", async () => {
  const context = await fixture();
  try {
    let stops = 0;
    let starts = 0;
    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {
        stops += 1;
      },
      startTrae: async () => {
        starts += 1;
        return true;
      },
      pollIntervalMs: 5,
      settleMs: 5,
      logger: { log() {}, error() {} },
    });

    const started = await manager.start();
    await waitForStatus(manager, started.sessionId, "awaiting_login");
    assert.equal(manager.cancel(started.sessionId), true);
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
    const manager = new TraeFakeLogoutManager({
      ...context,
      stopTrae: async () => {},
      startTrae: async () => true,
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
