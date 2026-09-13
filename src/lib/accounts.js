import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, stableHash, writeJsonAtomic } from "./json-file.js";
import {
  extractAuthSnapshot,
  extractIdentityFromSnapshot,
  maskAccountValue,
  mergeIdentity,
  validateAuthSnapshot,
} from "./trae-storage.js";

function cleanIdentity(identity) {
  return {
    userId: identity?.userId ? String(identity.userId).trim() : null,
    email: identity?.email ? String(identity.email).trim().toLowerCase() : null,
    phone: identity?.phone ? String(identity.phone).trim() : null,
    nickname: identity?.nickname ? String(identity.nickname).trim() : null,
  };
}

function accountIdentityKey(identity) {
  if (identity.userId) return `user:${identity.userId}`;
  if (identity.email) return `email:${identity.email.toLowerCase()}`;
  return null;
}

function safeDisplayName(identity) {
  return (
    identity.nickname ||
    identity.email ||
    (identity.userId ? `User ${identity.userId.slice(-6)}` : "TRAE account")
  );
}

function publicAccount(record) {
  return {
    id: record.id,
    displayName: record.displayName,
    userId: record.userId,
    maskedUserId: maskAccountValue(record.userId),
    maskedEmail: maskAccountValue(record.email),
    nickname: record.nickname,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    snapshotCapturedAt: record.snapshotCapturedAt,
  };
}

export class AccountStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.accountsDir = path.join(dataDir, "accounts");
    this.indexPath = path.join(this.accountsDir, "index.json");
  }

  async readIndex() {
    const index = await readJsonFile(this.indexPath, { required: false });
    if (!index) return { schemaVersion: 1, accounts: [] };
    if (!Array.isArray(index.accounts)) {
      throw new Error("TRAE enhancer account index is invalid");
    }
    return index;
  }

  async list() {
    const index = await this.readIndex();
    const result = [];
    for (const record of index.accounts) {
      const snapshotPath = this.snapshotPath(record.id);
      try {
        await fs.access(snapshotPath);
        result.push(publicAccount(record));
      } catch {
        // Broken records stay hidden until a fresh backup repairs them.
      }
    }
    return result.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  snapshotPath(accountId) {
    return path.join(this.accountsDir, accountId, "snapshot.json");
  }

  async backupCurrent(storageRoot, { liveIdentity = null, now = Date.now() } = {}) {
    const snapshot = extractAuthSnapshot(storageRoot, { capturedAt: now });
    const storedIdentity = extractIdentityFromSnapshot(snapshot);
    const identity = cleanIdentity(mergeIdentity(liveIdentity, storedIdentity));
    const identityKey = accountIdentityKey(identity);
    if (!identityKey) {
      throw new Error(
        "Unable to identify the current TRAE account. Keep TRAE running and retry the backup.",
      );
    }

    const accountId = `acct_${stableHash(identityKey)}`;
    const snapshotPath = this.snapshotPath(accountId);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeJsonAtomic(snapshotPath, snapshot, { mode: 0o600 });

    const index = await this.readIndex();
    const existingIndex = index.accounts.findIndex(
      (record) => record.id === accountId || accountIdentityKey(record) === identityKey,
    );
    const existing = existingIndex >= 0 ? index.accounts[existingIndex] : null;
    const record = {
      schemaVersion: 1,
      id: accountId,
      userId: identity.userId,
      email: identity.email,
      phone: identity.phone,
      nickname: identity.nickname,
      displayName: safeDisplayName(identity),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      snapshotCapturedAt: snapshot.capturedAt,
    };

    if (existingIndex >= 0) index.accounts[existingIndex] = record;
    else index.accounts.push(record);
    await writeJsonAtomic(this.indexPath, index, { mode: 0o600 });

    return {
      account: publicAccount(record),
      createdSnapshot: !existing,
    };
  }

  async readSnapshot(accountId) {
    if (!/^acct_[a-f0-9]{24}$/.test(accountId)) {
      throw new Error("Invalid account id");
    }
    const snapshot = await readJsonFile(this.snapshotPath(accountId));
    validateAuthSnapshot(snapshot);
    return snapshot;
  }

  async saveSnapshot(accountId, snapshot, { now = Date.now() } = {}) {
    validateAuthSnapshot(snapshot);
    const index = await this.readIndex();
    const position = index.accounts.findIndex((record) => record.id === accountId);
    if (position < 0) throw new Error("Account backup was not found");
    const identity = cleanIdentity(extractIdentityFromSnapshot(snapshot));
    await writeJsonAtomic(this.snapshotPath(accountId), snapshot, { mode: 0o600 });
    index.accounts[position] = {
      ...index.accounts[position],
      userId: identity.userId || index.accounts[position].userId,
      email: identity.email || index.accounts[position].email,
      phone: identity.phone || index.accounts[position].phone,
      nickname: identity.nickname || index.accounts[position].nickname,
      displayName: safeDisplayName({
        ...index.accounts[position],
        ...identity,
      }),
      updatedAt: now,
      snapshotCapturedAt: snapshot.capturedAt,
    };
    await writeJsonAtomic(this.indexPath, index, { mode: 0o600 });
    return publicAccount(index.accounts[position]);
  }

  async findAccount(accountId) {
    const index = await this.readIndex();
    return index.accounts.find((record) => record.id === accountId) || null;
  }

  async resolveCurrentAccountId(storageRoot) {
    let identity;
    try {
      identity = extractIdentityFromSnapshot(extractAuthSnapshot(storageRoot));
    } catch {
      return null;
    }
    if (!identity.userId && !identity.email) return null;
    const index = await this.readIndex();
    const record = index.accounts.find((candidate) => {
      if (identity.userId && candidate.userId) {
        return String(identity.userId) === String(candidate.userId);
      }
      if (identity.email && candidate.email) {
        return String(identity.email).toLowerCase() === String(candidate.email).toLowerCase();
      }
      return false;
    });
    return record?.id || null;
  }
}
