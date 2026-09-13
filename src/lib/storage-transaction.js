import crypto from "node:crypto";
import path from "node:path";

import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import {
  extractAuthSnapshot,
  extractIdentityFromSnapshot,
  mergeAuthSnapshot,
} from "./trae-storage.js";
import { setTimeout as delay } from "node:timers/promises";

export async function applyAuthSnapshot({
  storagePath,
  snapshot,
  transactionDir,
  now = Date.now(),
}) {
  const currentRoot = await readJsonFile(storagePath);
  const transactionId = `${now}-${crypto.randomBytes(6).toString("hex")}`;
  const directory = path.join(transactionDir, transactionId);
  const beforePath = path.join(directory, "storage.before.json");
  await writeJsonAtomic(beforePath, currentRoot, { mode: 0o600 });

  const merged = mergeAuthSnapshot(currentRoot, snapshot);
  try {
    await writeJsonAtomic(storagePath, merged, { mode: 0o600 });
  } catch (error) {
    await writeJsonAtomic(storagePath, currentRoot, { mode: 0o600 }).catch(() => {});
    throw error;
  }

  return {
    transactionId,
    beforePath,
    previousRoot: currentRoot,
    mergedRoot: merged,
  };
}

export async function rollbackAuthSnapshot(storagePath, transaction) {
  if (!transaction?.previousRoot) throw new Error("Missing storage rollback snapshot");
  await writeJsonAtomic(storagePath, transaction.previousRoot, { mode: 0o600 });
}

export async function verifyStorageIdentity(storagePath, expectedUserId) {
  const root = await readJsonFile(storagePath);
  const snapshot = extractAuthSnapshot(root);
  const identity = extractIdentityFromSnapshot(snapshot);
  return {
    ok: !!expectedUserId && String(identity.userId) === String(expectedUserId),
    identity,
  };
}

export async function waitForStorageIdentity(
  storagePath,
  expectedUserId,
  { timeoutMs = 20000, intervalMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastResult = null;
  while (Date.now() < deadline) {
    try {
      lastResult = await verifyStorageIdentity(storagePath, expectedUserId);
      if (lastResult.ok) {
        await delay(1200);
        const settled = await verifyStorageIdentity(storagePath, expectedUserId);
        if (settled.ok) return settled;
        lastResult = settled;
      }
    } catch (error) {
      lastResult = { ok: false, error: error.message };
    }
    await delay(intervalMs);
  }
  return lastResult || { ok: false, identity: null };
}
