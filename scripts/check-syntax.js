#!/usr/bin/env node
/**
 * Syntax-checks every source file with `node --check`.
 *
 * This replaces a hand-maintained chain of file names, which silently stops
 * covering new files as soon as one is added.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(path.dirname(path.resolve(process.argv[1])), "..");
const TARGET_DIRS = ["src", "scripts"];

async function collectJavaScriptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const files = [];
  for (const target of TARGET_DIRS) {
    files.push(...(await collectJavaScriptFiles(path.join(PROJECT_ROOT, target))));
  }
  files.sort();

  const failures = [];
  for (const file of files) {
    try {
      await execFileAsync(process.execPath, ["--check", file], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        windowsHide: true,
      });
    } catch (error) {
      failures.push({ file, message: (error.stderr || error.message || "").trim() });
    }
  }

  if (failures.length) {
    for (const { file, message } of failures) {
      console.error(`FAIL ${path.relative(PROJECT_ROOT, file)}`);
      if (message) console.error(message);
    }
    throw new Error(`${failures.length} of ${files.length} files failed the syntax check`);
  }
  console.log(`syntax ok: ${files.length} files`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
