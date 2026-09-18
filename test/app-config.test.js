import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHECKIN_DEFAULTS,
  CHECKIN_INTERVALS,
  CONFIG_FILE_NAME,
  configPath,
  loadAppConfig,
  normalizeCheckin,
  normalizeCheckinInterval,
  normalizeConfig,
  normalizeTraeExe,
  normalizeTraeUpdate,
  saveAppConfig,
} from "../src/lib/app-config.js";

const DEFAULT_TRAE_UPDATE = { suppress: true, previousMode: null };
const DEFAULTS = {
  traeExe: null,
  traeUpdate: DEFAULT_TRAE_UPDATE,
  checkin: CHECKIN_DEFAULTS,
};

test("a missing or empty trae path normalizes to null", () => {
  assert.equal(normalizeTraeExe(null), null);
  assert.equal(normalizeTraeExe(undefined), null);
  assert.equal(normalizeTraeExe(""), null);
  assert.equal(normalizeTraeExe("   "), null);
});

test("a usable trae path is normalized", () => {
  assert.equal(
    normalizeTraeExe("  D:\\Me\\副业\\TRAE SOLO CN.exe  "),
    path.normalize("D:\\Me\\副业\\TRAE SOLO CN.exe"),
  );
});

test("a relative or non executable path is rejected instead of being stored", () => {
  assert.throws(() => normalizeTraeExe("TRAE SOLO CN.exe"), /must be an absolute path/);
  assert.throws(() => normalizeTraeExe(".\\TRAE SOLO CN.exe"), /must be an absolute path/);
  assert.throws(() => normalizeTraeExe("C:\\apps\\readme.txt"), /must point to an \.exe/);
  assert.throws(() => normalizeTraeExe(42), /must be a string or null/);
  assert.throws(() => normalizeTraeExe("C:\\a\0b.exe"), /null byte/);
});

test("an absent configuration normalizes to defaults", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULTS);
  assert.deepEqual(normalizeConfig(undefined), DEFAULTS);
  assert.deepEqual(normalizeConfig({}), DEFAULTS);
});

test("the trae auto-update preference defaults to suppressed", () => {
  assert.deepEqual(normalizeTraeUpdate(null), DEFAULT_TRAE_UPDATE);
  assert.deepEqual(normalizeTraeUpdate({}), DEFAULT_TRAE_UPDATE);
  assert.deepEqual(normalizeTraeUpdate({ suppress: false }), {
    suppress: false,
    previousMode: null,
  });
  assert.deepEqual(normalizeTraeUpdate({ suppress: "off", previousMode: "start" }), {
    suppress: false,
    previousMode: "start",
  });
  assert.throws(() => normalizeTraeUpdate({ suppress: "maybe" }), /must be a boolean/);
  assert.throws(() => normalizeTraeUpdate([]), /must be a JSON object/);
  assert.throws(() => normalizeTraeUpdate({ previousMode: "sometimes" }), /must be one of/);
});

test("automatic check-in defaults to on, every 30 minutes, with the client-load run", () => {
  assert.deepEqual(normalizeCheckin(null), CHECKIN_DEFAULTS);
  assert.deepEqual(normalizeCheckin(undefined), CHECKIN_DEFAULTS);
  assert.deepEqual(normalizeCheckin({}), CHECKIN_DEFAULTS);
  assert.deepEqual(CHECKIN_INTERVALS, [15, 30, 60, 120]);
});

test("every offered check-in interval is accepted and nothing else is", () => {
  for (const minutes of CHECKIN_INTERVALS) {
    assert.equal(normalizeCheckinInterval(minutes), minutes);
    // A string is accepted too: the value arrives back through JSON.
    assert.equal(normalizeCheckinInterval(String(minutes)), minutes);
  }
  for (const value of [0, 7, 999, -30, 30.5, "abc", "", null, undefined, true, [], {}]) {
    assert.equal(normalizeCheckinInterval(value), CHECKIN_DEFAULTS.intervalMinutes);
  }
});

test("a bad check-in entry falls back instead of failing the whole file", () => {
  assert.deepEqual(normalizeCheckin({ auto: "maybe", intervalMinutes: 7, onClientLoad: 42 }), CHECKIN_DEFAULTS);
  assert.deepEqual(normalizeCheckin({ auto: false, intervalMinutes: "60", onClientLoad: "off" }), {
    auto: false,
    intervalMinutes: 60,
    onClientLoad: false,
  });
  // The container itself stays strict: a string here means the file is structurally wrong.
  assert.throws(() => normalizeCheckin([]), /must be a JSON object/);
  assert.throws(() => normalizeCheckin("on"), /must be a JSON object/);
});

test("a configuration written before the check-in block existed gains the defaults", () => {
  const migrated = normalizeConfig({ traeExe: null });
  assert.deepEqual(migrated.checkin, CHECKIN_DEFAULTS);
  assert.equal(Object.hasOwn(migrated, "proxy"), false);
});

test("a malformed configuration file is rejected instead of ignored", () => {
  assert.throws(() => normalizeConfig([]), /must contain a JSON object/);
  assert.throws(() => normalizeConfig("nope"), /must contain a JSON object/);
  assert.throws(() => normalizeConfig({ traeExe: "relative.exe" }), /absolute path/);
  // Legacy proxy fields are ignored rather than rejected on the no-proxy branch.
  assert.deepEqual(normalizeConfig({ proxy: [], useEnvProxy: "maybe" }), DEFAULTS);
});

test("loading a missing configuration file yields defaults", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-config-"));
  try {
    assert.deepEqual(await loadAppConfig(dir), DEFAULTS);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("saving then loading keeps the selected trae path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-config-"));
  const exe = path.normalize("D:\\Me\\副业\\TRAE SOLO CN.exe");
  try {
    await saveAppConfig(dir, { traeExe: exe });
    assert.deepEqual(await loadAppConfig(dir), { ...DEFAULTS, traeExe: exe });

    const written = JSON.parse(await fs.readFile(configPath(dir), "utf8"));
    assert.deepEqual(written, { ...DEFAULTS, traeExe: exe });

    const stats = await fs.stat(path.join(dir, CONFIG_FILE_NAME));
    assert.equal(stats.isFile(), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("saving a patch keeps the previous values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-config-"));
  const exe = path.normalize("C:\\apps\\TRAE SOLO CN.exe");
  try {
    await saveAppConfig(dir, { traeExe: exe });
    await saveAppConfig(dir, { checkin: { auto: false } });
    assert.deepEqual(await loadAppConfig(dir), {
      ...DEFAULTS,
      traeExe: exe,
      checkin: { ...CHECKIN_DEFAULTS, auto: false },
    });

    const cleared = await saveAppConfig(dir, { traeExe: null });
    assert.deepEqual(cleared, {
      ...DEFAULTS,
      traeExe: null,
      checkin: { ...CHECKIN_DEFAULTS, auto: false },
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("saving an invalid path does not overwrite a good configuration", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-config-"));
  const exe = path.normalize("C:\\apps\\TRAE SOLO CN.exe");
  try {
    await saveAppConfig(dir, { traeExe: exe });
    await assert.rejects(
      () => saveAppConfig(dir, { traeExe: "relative.exe" }),
      /must be an absolute path/,
    );
    assert.deepEqual(await loadAppConfig(dir), { ...DEFAULTS, traeExe: exe });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
