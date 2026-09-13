import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "../src/lib/json-file.js";

async function tempDir(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function transientError(code) {
  const error = new Error(`${code}: operation not permitted, rename`);
  error.code = code;
  return error;
}

test("concurrent atomic writes to one path all succeed and leave the last value", async () => {
  const dir = await tempDir("json-file-concurrent-");
  try {
    const target = path.join(dir, "session.json");
    const writes = Array.from({ length: 40 }, (_, index) =>
      writeJsonAtomic(target, { index }),
    );
    await Promise.all(writes);

    assert.deepEqual(await readJsonFile(target), { index: 39 });
    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("concurrent text and json writes to one path are applied in call order", async () => {
  const dir = await tempDir("json-file-mixed-");
  try {
    const target = path.join(dir, "api-token");
    await Promise.all([
      writeTextAtomic(target, "token-value\n"),
      writeJsonAtomic(target, { value: "json" }),
      writeTextAtomic(target, "last-value\n"),
    ]);

    assert.equal(await fs.readFile(target, "utf8"), "last-value\n");
    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("atomic writes retry transient rename failures", async (t) => {
  const dir = await tempDir("json-file-retry-");
  try {
    const target = path.join(dir, "state.json");
    const realRename = fs.rename;
    let failures = 0;
    t.mock.method(fs, "rename", async (from, to) => {
      if (failures < 3) {
        failures += 1;
        throw transientError(["EPERM", "EACCES", "EBUSY"][failures - 1]);
      }
      return await realRename(from, to);
    });

    await writeJsonAtomic(target, { ok: true });
    assert.equal(failures, 3);
    assert.deepEqual(await readJsonFile(target), { ok: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("atomic writes surface non-transient rename failures", async (t) => {
  const dir = await tempDir("json-file-fatal-");
  try {
    const target = path.join(dir, "state.json");
    const error = new Error("ENOSPC: no space left on device, rename");
    error.code = "ENOSPC";
    t.mock.method(fs, "rename", async () => {
      throw error;
    });

    await assert.rejects(() => writeJsonAtomic(target, { ok: true }), { code: "ENOSPC" });
    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
