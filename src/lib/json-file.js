import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Atomic writes go through a temp file plus a rename. On Windows two concurrent
 * renames onto the same destination can fail intermittently with EPERM/EACCES/EBUSY,
 * so writes to one path are serialized and the rename itself is retried.
 */
const writeChains = new Map();
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_DELAYS_MS = [5, 10, 20, 40, 80];

function queueKey(filePath) {
  return path.resolve(filePath);
}

async function serializeWrite(filePath, task) {
  const key = queueKey(filePath);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.then(
    () => {},
    () => {},
  );
  writeChains.set(key, tail);
  try {
    return await current;
  } finally {
    if (writeChains.get(key) === tail) writeChains.delete(key);
  }
}

async function renameWithRetry(tempPath, filePath) {
  let lastError;
  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error?.code)) throw error;
      lastError = error;
      const wait = RENAME_RETRY_DELAYS_MS[attempt];
      if (wait === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

async function writeAtomic(filePath, content, mode) {
  await serializeWrite(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    let handle;
    try {
      handle = await fs.open(tempPath, "wx", mode);
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await renameWithRetry(tempPath, filePath);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  });
}

export async function readJsonFile(filePath, { required = true } = {}) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    throw new Error(`Failed to read JSON file ${filePath}: ${error.message}`);
  }
}

export async function writeJsonAtomic(filePath, value, { mode = 0o600 } = {}) {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export async function readTextFile(filePath, { required = true } = {}) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    throw new Error(`Failed to read text file ${filePath}: ${error.message}`);
  }
}

export async function writeTextAtomic(filePath, text, { mode = 0o600 } = {}) {
  await writeAtomic(filePath, text, mode);
}

export function stableHash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}
