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
  normalizeProxyConfig,
  normalizeProxyMode,
  normalizeProxyUrl,
  normalizeTraeExe,
  normalizeTraeUpdate,
  normalizeUseEnvProxy,
  saveAppConfig,
} from "../src/lib/app-config.js";

const DEFAULT_PROXY = { mode: "system", url: null, noProxy: "" };
const DEFAULT_TRAE_UPDATE = { suppress: true, previousMode: null };
const DEFAULTS = { traeExe: null, proxy: DEFAULT_PROXY, traeUpdate: DEFAULT_TRAE_UPDATE };

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

test("the legacy environment proxy switch still accepts explicit values", () => {
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

test("the proxy mode defaults to following the system proxy", () => {
  assert.equal(normalizeProxyMode(undefined), "system");
  assert.equal(normalizeProxyMode(null), "system");
  assert.equal(normalizeProxyMode(""), "system");
  assert.equal(normalizeProxyMode(" SYSTEM "), "system");
  assert.equal(normalizeProxyMode("manual"), "manual");
  assert.equal(normalizeProxyMode("env"), "env");
  assert.equal(normalizeProxyMode("off"), "off");
  assert.throws(() => normalizeProxyMode("auto"), /must be one of/);
});

test("a proxy url is accepted with or without a scheme", () => {
  assert.equal(normalizeProxyUrl("127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.equal(normalizeProxyUrl(" 127.0.0.1:7890 "), "http://127.0.0.1:7890");
  assert.equal(normalizeProxyUrl("http://proxy.corp:8080"), "http://proxy.corp:8080");
  assert.equal(normalizeProxyUrl("https://proxy.corp:8080"), "https://proxy.corp:8080");
  assert.equal(normalizeProxyUrl(""), null);
  assert.equal(normalizeProxyUrl(null), null);
});

test("a proxy url embedding credentials is refused so no secret reaches the file", () => {
  assert.throws(() => normalizeProxyUrl("http://user:secret@proxy.corp:8080"), /must not embed/);
  assert.throws(() => normalizeProxyUrl("user:secret@proxy.corp:8080"), /must not embed/);
});

test("a malformed proxy url is rejected instead of stored", () => {
  assert.throws(() => normalizeProxyUrl("ftp://proxy.corp:21"), /must use http or https/);
  assert.throws(() => normalizeProxyUrl("http://"), /not a valid URL|no host/);
  assert.throws(() => normalizeProxyUrl(42), /must be a string or null/);
});

test("manual mode without an address is refused rather than resolving to nothing", () => {
  assert.throws(
    () => normalizeProxyConfig({ mode: "manual" }, undefined),
    /config\.proxy\.url is required/,
  );
  assert.deepEqual(normalizeProxyConfig({ mode: "manual", url: "h:1" }, undefined), {
    mode: "manual",
    url: "http://h:1",
    noProxy: "",
  });
});

test("the no-proxy list is normalized into a comma separated value", () => {
  assert.deepEqual(normalizeProxyConfig({ mode: "off", noProxy: " a.com , ,b.com " }, undefined), {
    mode: "off",
    url: null,
    noProxy: "a.com,b.com",
  });
});

test("v1.0.0's boolean flag migrates onto the new modes", () => {
  assert.deepEqual(normalizeProxyConfig(undefined, true), { mode: "env", url: null, noProxy: "" });
  assert.deepEqual(normalizeProxyConfig(undefined, false), DEFAULT_PROXY);
  // An explicit proxy object always wins over the legacy field.
  assert.deepEqual(normalizeProxyConfig({ mode: "off" }, true), {
    mode: "off",
    url: null,
    noProxy: "",
  });
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

test("a malformed configuration file is rejected instead of ignored", () => {
  assert.throws(() => normalizeConfig([]), /must contain a JSON object/);
  assert.throws(() => normalizeConfig("nope"), /must contain a JSON object/);
  assert.throws(() => normalizeConfig({ traeExe: "relative.exe" }), /absolute path/);
  assert.throws(() => normalizeConfig({ useEnvProxy: "maybe" }), /must be a boolean/);
  assert.throws(() => normalizeConfig({ proxy: [] }), /must be a JSON object/);
  assert.throws(() => normalizeConfig({ proxy: { mode: "auto" } }), /must be one of/);
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
    assert.deepEqual(await loadAppConfig(dir), { traeExe: exe, proxy: DEFAULT_PROXY, traeUpdate: DEFAULT_TRAE_UPDATE });

    const written = JSON.parse(await fs.readFile(configPath(dir), "utf8"));
    assert.deepEqual(written, { traeExe: exe, proxy: DEFAULT_PROXY, traeUpdate: DEFAULT_TRAE_UPDATE });

    const stats = await fs.stat(path.join(dir, CONFIG_FILE_NAME));
    assert.equal(stats.isFile(), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("saving a patch keeps the previous values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trae-config-"));
  const exe = path.normalize("C:\\apps\\TRAE SOLO CN.exe");
  const manual = { mode: "manual", url: "http://127.0.0.1:7890", noProxy: "corp.local" };
  try {
    await saveAppConfig(dir, { traeExe: exe });
    await saveAppConfig(dir, { proxy: manual });
    assert.deepEqual(await loadAppConfig(dir), {
      traeExe: exe,
      proxy: manual,
      traeUpdate: DEFAULT_TRAE_UPDATE,
    });

    const cleared = await saveAppConfig(dir, { traeExe: null });
    assert.deepEqual(cleared, { traeExe: null, proxy: manual, traeUpdate: DEFAULT_TRAE_UPDATE });
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
    assert.deepEqual(await loadAppConfig(dir), { traeExe: exe, proxy: DEFAULT_PROXY, traeUpdate: DEFAULT_TRAE_UPDATE });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
