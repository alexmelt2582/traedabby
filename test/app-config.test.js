import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONFIG_FILE_NAME,
  configPath,
  loadAppConfig,
  normalizeConfig,
  normalizeTraeExe,
  normalizeUseEnvProxy,
  saveAppConfig,
} from "../src/lib/app-config.js";

const DEFAULTS = { traeExe: null, useEnvProxy: false };

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

test("the environment proxy switch defaults to off and accepts explicit values", () => {
  assert.equal(normalizeUseEnvProxy(undefined), false);
  assert.equal(normalizeUseEnvProxy(null), false);
  assert.equal(normalizeUseEnvProxy(false), false);
  assert.equal(normalizeUseEnvProxy(true), true);
  for (const word of ["1", "true", "yes", "on", " TRUE "]) {
    assert.equal(normalizeUseEnvProxy(word), true);
  }
  for (const word of ["0", "false", "no", "off", ""]) {
    assert.equal(normalizeUseEnvProxy(word), false);
  }
  assert.throws(() => normalizeUseEnvProxy("maybe"), /must be a boolean/);
  assert.throws(() => normalizeUseEnvProxy(7), /must be a boolean/);
});

test("an absent configuration normalizes to defaults", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULTS);
  assert.deepEqual(normalizeConfig(undefined), DEFAULTS);
  assert.deepEqual(normalizeConfig({}), DEFAULTS);
});

test("a malformed configuration file is rejected instead of ignored", () => {
  assert.throws(() => normalizeConfig([]), /must contain a JSON object/);
  assert.throws(() => normalizeConfig("nope"), /must contain a JSON object/);
  assert.throws(() => normalizeConfig({ traeExe: "relative.exe" }), /absolute path/);
  assert.throws(() => normalizeConfig({ useEnvProxy: "maybe" }), /must be a boolean/);
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
    assert.deepEqual(await loadAppConfig(dir), { traeExe: exe, useEnvProxy: false });

    const written = JSON.parse(await fs.readFile(configPath(dir), "utf8"));
    assert.deepEqual(written, { traeExe: exe, useEnvProxy: false });

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
    await saveAppConfig(dir, { useEnvProxy: true });
    assert.deepEqual(await loadAppConfig(dir), { traeExe: exe, useEnvProxy: true });

    const cleared = await saveAppConfig(dir, { traeExe: null });
    assert.deepEqual(cleared, { traeExe: null, useEnvProxy: true });
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
    assert.deepEqual(await loadAppConfig(dir), { traeExe: exe, useEnvProxy: false });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
