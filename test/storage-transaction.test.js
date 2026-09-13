import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyAuthClear,
  applyAuthSnapshot,
  rollbackAuthSnapshot,
  verifyStorageIdentity,
} from "../src/lib/storage-transaction.js";
import { extractAuthSnapshot, traeStorageKeys } from "../src/lib/trae-storage.js";
import { readJsonFile } from "../src/lib/json-file.js";

function rootForUser(userId) {
  return {
    theme: "dark",
    [traeStorageKeys.USERTAG_KEY]: `usertag-${userId}`,
    "iCubeAuthInfo://icube-dc:1360520616887347": `device-${userId}`,
    "iCubeAuthInfo://icube.cloudide": JSON.stringify({ userId }),
    "iCubeServerData://icube.cloudide": JSON.stringify({ account: { userId } }),
    "iCubeEntitlementInfo://icube.cloudide": JSON.stringify({ userId }),
  };
}

test("applies and rolls back an account snapshot transaction", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-switch-test-"));
  try {
    const storagePath = path.join(dir, "storage.json");
    const transactionDir = path.join(dir, "transactions");
    await fs.writeFile(storagePath, JSON.stringify(rootForUser("1111111111111111")), "utf8");
    const snapshot = extractAuthSnapshot(rootForUser("2222222222222222"));

    const transaction = await applyAuthSnapshot({
      storagePath,
      snapshot,
      transactionDir,
      now: 100,
    });
    const applied = await readJsonFile(storagePath);
    assert.equal(applied.theme, "dark");
    assert.equal(
      JSON.parse(applied["iCubeAuthInfo://icube.cloudide"]).userId,
      "2222222222222222",
    );
    assert.equal((await verifyStorageIdentity(storagePath, "2222222222222222")).ok, true);
    assert.ok(await fs.stat(transaction.beforePath));

    await rollbackAuthSnapshot(storagePath, transaction);
    const restored = await readJsonFile(storagePath);
    assert.equal(
      JSON.parse(restored["iCubeAuthInfo://icube.cloudide"]).userId,
      "1111111111111111",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("fake logout clear removes only managed authentication keys", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-logout-test-"));
  try {
    const storagePath = path.join(dir, "storage.json");
    const transactionDir = path.join(dir, "transactions");
    const original = rootForUser("1111111111111111");
    original.windowState = "preserved";
    original.extensions = ["preserved-extension"];
    await fs.writeFile(storagePath, JSON.stringify(original), "utf8");

    const transaction = await applyAuthClear({
      storagePath,
      transactionDir,
      now: 200,
    });
    const cleared = await readJsonFile(storagePath);
    assert.equal(cleared.windowState, "preserved");
    assert.deepEqual(cleared.extensions, ["preserved-extension"]);
    assert.equal(Object.keys(cleared).some((key) => key.startsWith("iCube")), false);
    assert.ok(await fs.stat(transaction.beforePath));

    await rollbackAuthSnapshot(storagePath, transaction);
    assert.equal((await verifyStorageIdentity(storagePath, "1111111111111111")).ok, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
