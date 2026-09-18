import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TRAE_UPDATE_MODE_KEY,
  applyTraeUpdateSetting,
  readTopLevelRawValue,
  readTopLevelValue,
  readTraeUpdateState,
  removeTopLevelKey,
  scanTopLevelKeys,
  setTopLevelString,
  traeSettingsBackupPath,
} from "../src/lib/trae-settings.js";

async function tempUserData() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "trae-settings-"));
}

test("a top level key is found with the exact span of its value", () => {
  const text = '{\n\t"a": 1,\n\t"update.mode": "default"\n}\n';
  const { spans } = scanTopLevelKeys(text);
  const span = spans.find((entry) => entry.key === "update.mode");
  assert.equal(span.key, "update.mode");
  assert.equal(text.slice(span.valueStart, span.valueEnd), '"default"');
  assert.equal(readTopLevelValue(text, TRAE_UPDATE_MODE_KEY), "default");
});

test("an existing value is replaced in place and comments survive", () => {
  const text = [
    "{",
    "\t// keep me",
    '\t"editor.fontSize": 14,',
    '\t"update.mode": "default", // and me',
    '\t"files.eol": "\\n"',
    "}",
    "",
  ].join("\n");
  const next = setTopLevelString(text, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(next.includes("// keep me"), true);
  assert.equal(next.includes("// and me"), true);
  const { spans } = scanTopLevelKeys(next);
  assert.equal(spans.length, 3);
  assert.equal(readTopLevelValue(next, TRAE_UPDATE_MODE_KEY), "manual");
  assert.equal(next, text.replace('"default"', '"manual"'));
});

test("a missing key is inserted inside the root object", () => {
  const text = '{\n\t"editor.fontSize": 14\n}\n';
  const next = setTopLevelString(text, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(next, '{\n\t"update.mode": "manual",\n\t"editor.fontSize": 14\n}\n');
  assert.equal(readTopLevelValue(next, TRAE_UPDATE_MODE_KEY), "manual");
});

test("inserting keeps the indentation and line endings the file already uses", () => {
  const crlf = '{\r\n    "a": 1\r\n}\r\n';
  const next = setTopLevelString(crlf, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(next.includes("\r\n"), true);
  assert.equal(next.includes("    \"update.mode\": \"manual\","), true);
  assert.equal(next.replace(/\r\n/g, "").includes("\n"), false);
});

test("an empty root object becomes a one entry object", () => {
  const next = setTopLevelString("{\n}\n", TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(next, '{\n\t"update.mode": "manual"\n}\n');
  assert.equal(readTopLevelValue(next, TRAE_UPDATE_MODE_KEY), "manual");
});

test("a nested update.mode is not mistaken for the top level one", () => {
  const text = '{\n\t"ext": {\n\t\t"update.mode": "start"\n\t}\n}\n';
  const { spans } = scanTopLevelKeys(text);
  assert.deepEqual(spans.map((span) => span.key), ["ext"]);
  const next = setTopLevelString(text, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(next.includes('"update.mode": "start"'), true);
  assert.equal(readTopLevelValue(next, TRAE_UPDATE_MODE_KEY), "manual");
});

test("braces inside strings and comments do not break the scan", () => {
  const text = [
    "{",
    '\t"pattern": "a { brace } and a // slash",',
    "\t/* a comment with { } inside */",
    '\t"update.mode": "default"',
    "}",
  ].join("\n");
  const next = setTopLevelString(text, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(readTopLevelValue(next, TRAE_UPDATE_MODE_KEY), "manual");
  assert.equal(next.includes('"pattern": "a { brace } and a // slash"'), true);
  assert.equal(next.includes("/* a comment with { } inside */"), true);
});

test("a jsonc trailing comma does not confuse the scanner", () => {
  const text = '{\n\t"update.mode": "default",\n}\n';
  const next = setTopLevelString(text, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(next, '{\n\t"update.mode": "manual",\n}\n');
});

test("an escaped quote inside a string does not end it early", () => {
  const text = '{\n\t"label": "he said \\"update.mode\\": hi",\n\t"update.mode": "default"\n}\n';
  const next = setTopLevelString(text, TRAE_UPDATE_MODE_KEY, "manual");
  assert.equal(readTopLevelValue(next, TRAE_UPDATE_MODE_KEY), "manual");
  assert.equal(next.includes('he said \\"update.mode\\": hi'), true);
});

test("the literal value is available without decoding", () => {
  const text = '{\n\t"update.mode": "default"\n}';
  assert.equal(readTopLevelRawValue(text, TRAE_UPDATE_MODE_KEY), '"default"');
  assert.equal(readTopLevelRawValue(text, "missing"), null);
});

test("removing a middle entry takes its comma with it", () => {
  const text = '{\n\t"a": 1,\n\t"update.mode": "manual",\n\t"b": 2\n}\n';
  const next = removeTopLevelKey(text, TRAE_UPDATE_MODE_KEY);
  assert.equal(next, '{\n\t"a": 1,\n\t"b": 2\n}\n');
});

test("removing the last entry drops the comma of the entry before it", () => {
  const text = '{\n\t"a": 1,\n\t"update.mode": "manual"\n}\n';
  const next = removeTopLevelKey(text, TRAE_UPDATE_MODE_KEY);
  assert.equal(next, '{\n\t"a": 1\n}\n');
});

test("removing the only entry leaves an empty object", () => {
  const next = removeTopLevelKey('{\n\t"update.mode": "manual"\n}\n', TRAE_UPDATE_MODE_KEY);
  assert.equal(next, "{\n}\n");
});

test("removing a key that is not there changes nothing", () => {
  const text = '{\n\t"a": 1\n}\n';
  assert.equal(removeTopLevelKey(text, TRAE_UPDATE_MODE_KEY), text);
});

test("a file with no root object is refused instead of edited", () => {
  assert.throws(() => setTopLevelString("not json at all", TRAE_UPDATE_MODE_KEY, "manual"));
});

test("a settings file that does not exist yet is reported as not suppressed", async () => {
  const dir = await tempUserData();
  const state = await readTraeUpdateState({ userDataDir: dir });
  assert.equal(state.exists, false);
  assert.equal(state.mode, null);
  assert.equal(state.suppressed, false);
});

test("suppressing creates the settings file and reports the change", async () => {
  const dir = await tempUserData();
  const result = await applyTraeUpdateSetting({ userDataDir: dir, suppress: true });
  assert.equal(result.changed, true);
  assert.equal(result.mode, "manual");
  const text = await fs.readFile(result.path, "utf8");
  assert.equal(text, '{\n\t"update.mode": "manual"\n}\n');
});

test("suppressing an existing file keeps every other setting and makes a backup", async () => {
  const dir = await tempUserData();
  const settingsPath = path.join(dir, "User", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const original = '{\n\t"AI.rules.importClaudeMd": true,\n\t"files.autoSave": "off"\n}\n';
  await fs.writeFile(settingsPath, original, "utf8");

  const result = await applyTraeUpdateSetting({ userDataDir: dir, suppress: true });
  assert.equal(result.changed, true);
  assert.equal(result.backupPath, traeSettingsBackupPath(dir));
  const text = await fs.readFile(settingsPath, "utf8");
  assert.equal(
    text,
    '{\n\t"update.mode": "manual",\n\t"AI.rules.importClaudeMd": true,\n\t"files.autoSave": "off"\n}\n',
  );
  assert.equal(text.includes('"files.autoSave": "off"'), true);
  assert.equal(await fs.readFile(result.backupPath, "utf8"), original);
});

test("applying the same setting twice writes nothing the second time", async () => {
  const dir = await tempUserData();
  await applyTraeUpdateSetting({ userDataDir: dir, suppress: true });
  const settingsPath = path.join(dir, "User", "settings.json");
  const before = await fs.stat(settingsPath);
  const second = await applyTraeUpdateSetting({ userDataDir: dir, suppress: true });
  assert.equal(second.changed, false);
  assert.equal(second.backupPath, null);
  assert.equal((await fs.stat(settingsPath)).mtimeMs, before.mtimeMs);
});

test("restoring removes the entry and forgets it", async () => {
  const dir = await tempUserData();
  await applyTraeUpdateSetting({ userDataDir: dir, suppress: true });
  const restored = await applyTraeUpdateSetting({ userDataDir: dir, suppress: false });
  assert.equal(restored.changed, true);
  assert.equal(restored.mode, null);
  assert.equal(await fs.readFile(restored.path, "utf8"), "{\n}\n");
  const state = await readTraeUpdateState({ userDataDir: dir });
  assert.equal(state.suppressed, false);
});

test("restoring puts back the mode the file had before", async () => {
  const dir = await tempUserData();
  const settingsPath = path.join(dir, "User", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, '{\n\t"update.mode": "start"\n}\n', "utf8");

  await applyTraeUpdateSetting({ userDataDir: dir, suppress: true, previousMode: "start" });
  assert.equal(readTopLevelValue(await fs.readFile(settingsPath, "utf8"), TRAE_UPDATE_MODE_KEY), "manual");

  await applyTraeUpdateSetting({ userDataDir: dir, suppress: false, previousMode: "start" });
  assert.equal(readTopLevelValue(await fs.readFile(settingsPath, "utf8"), TRAE_UPDATE_MODE_KEY), "start");
});

test("restoring when nothing was suppressed reports no change", async () => {
  const dir = await tempUserData();
  const settingsPath = path.join(dir, "User", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, '{\n\t"update.mode": "default"\n}\n', "utf8");
  const result = await applyTraeUpdateSetting({ userDataDir: dir, suppress: false });
  assert.equal(result.changed, false);
  assert.equal(readTopLevelValue(await fs.readFile(settingsPath, "utf8"), TRAE_UPDATE_MODE_KEY), "default");
});
