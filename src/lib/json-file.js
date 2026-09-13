import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;

  let handle;
  try {
    handle = await fs.open(tempPath, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await fs.open(tempPath, "wx", mode);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

export function stableHash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

