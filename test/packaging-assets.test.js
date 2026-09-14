import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../src/constants.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const LANGUAGE_SHA256 = "bf0751fa176569c6faa2f6e17ed2734617bef325d5cc06eae030fdd0258ee778";

async function read(relativePath) {
  return await fs.readFile(path.join(PROJECT_ROOT, relativePath));
}

test("entry scripts stay pure ASCII without a BOM", async () => {
  for (const relativePath of ["scripts/trae-enhancer.cmd", "scripts/tray.ps1"]) {
    const bytes = await read(relativePath);
    assert.equal(bytes.subarray(0, 3).equals(UTF8_BOM), false, relativePath);
    assert.equal(bytes.some((byte) => byte > 0x7f), false, relativePath);
  }
});

test("the cmd entry supports both source-build and portable layouts", async () => {
  const text = (await read("scripts/trae-enhancer.cmd")).toString("ascii");
  assert.match(text, /dist\\TraeEnhancer\.exe/);
  assert.match(text, /if exist "TraeEnhancer\.exe"/);
  assert.match(text, /"%ENHANCER_EXE%" %ARGS%/);
});

test("the installer script keeps its required UTF-8 BOM", async () => {
  const bytes = await read("scripts/win/trae-enhancer.iss");
  assert.equal(bytes.subarray(0, 3).equals(UTF8_BOM), true);
  assert.match(bytes.toString("utf8"), /登录时自动启动后台服务/);
});

test("the third-party Simplified Chinese translation is not rewritten", async () => {
  const bytes = await read("scripts/win/ChineseSimplified.isl");
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    LANGUAGE_SHA256,
  );
});

test("package and runtime versions stay aligned", async () => {
  const pkg = JSON.parse((await read("package.json")).toString("utf8"));
  assert.equal(APP_VERSION, pkg.version);
});
