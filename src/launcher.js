import { spawn } from "node:child_process";
import path from "node:path";

import {
  APP_NAME,
  DEFAULT_CDP_PORT,
  DEFAULT_DATA_DIR,
  DEFAULT_TRAE_EXE,
  DEFAULT_TRAE_USER_DATA_DIR,
  DEFAULT_UI_PORT,
  LOOPBACK_HOST,
  parsePort,
} from "./constants.js";
import { daemonSpec } from "./lib/launch-spec.js";
import {
  SOURCES,
  createWindowsProbe,
  formatNotFoundHelp,
  resolveTraeExe,
} from "./lib/trae-locate.js";
import {
  isTraeCdpAvailable,
  startTraeWithCdp,
  stopTraeForRestart,
  waitForCdp,
} from "./lib/trae-process.js";
import { readTextFile } from "./lib/json-file.js";
import { loadAppConfig } from "./lib/app-config.js";
import { proxyChildEnv } from "./lib/net-diagnostics.js";
import { setTimeout as delay } from "node:timers/promises";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const cdpPort = parsePort(
  argumentValue("--cdp-port") || process.env.TRAE_ENHANCER_CDP_PORT,
  DEFAULT_CDP_PORT,
);
const uiPort = parsePort(
  argumentValue("--ui-port") || process.env.TRAE_ENHANCER_UI_PORT,
  DEFAULT_UI_PORT,
);
const explicitTraeExe = argumentValue("--trae-exe");
let exePath = explicitTraeExe || process.env.TRAE_ENHANCER_TRAE_EXE || DEFAULT_TRAE_EXE;
const userDataDir =
  argumentValue("--user-data-dir") ||
  process.env.TRAE_ENHANCER_USER_DATA_DIR ||
  DEFAULT_TRAE_USER_DATA_DIR;
const dataDir =
  argumentValue("--data-dir") || process.env.TRAE_ENHANCER_DATA_DIR || DEFAULT_DATA_DIR;
const storagePath =
  process.env.TRAE_ENHANCER_STORAGE_PATH ||
  path.join(userDataDir, "User", "globalStorage", "storage.json");
const noRestart = process.argv.includes("--no-restart");

async function daemonHealth() {
  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${uiPort}/api/health`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function startDaemon() {
  const existing = await daemonHealth();
  if (existing?.ok) return existing;

  const launch = daemonSpec();
  const config = await loadAppConfig(dataDir);
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...proxyChildEnv({ useEnvProxy: config.useEnvProxy }),
      TRAE_ENHANCER_CDP_PORT: String(cdpPort),
      TRAE_ENHANCER_UI_PORT: String(uiPort),
      TRAE_ENHANCER_DATA_DIR: dataDir,
      TRAE_ENHANCER_STORAGE_PATH: storagePath,
      TRAE_ENHANCER_USER_DATA_DIR: userDataDir,
    },
  });
  child.unref();

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const health = await daemonHealth();
    if (health?.ok) return health;
    await delay(250);
  }
  throw new Error(`Timed out waiting for the local daemon on port ${uiPort}`);
}

async function main() {
  const resolved = await resolveTraeExe({
    dataDir,
    probe: createWindowsProbe(),
    explicit: explicitTraeExe,
  });
  if (!resolved.path) {
    throw new Error(formatNotFoundHelp({ attempts: resolved.attempts, dataDir }));
  }
  exePath = resolved.path;
  console.log(
    `[${APP_NAME}] TRAE: ${exePath} (来源: ${SOURCES[resolved.source] ?? resolved.source})`,
  );

  let cdpReady = await isTraeCdpAvailable(cdpPort);
  if (!cdpReady && noRestart) {
    throw new Error(
      `TRAE SOLO CN is not exposing CDP port ${cdpPort}. Start it through this launcher.`,
    );
  }

  if (!cdpReady) {
    console.log(`[${APP_NAME}] Restarting TRAE SOLO CN with CDP port ${cdpPort}...`);
    await stopTraeForRestart(exePath);
    await startTraeWithCdp(exePath, cdpPort);
    cdpReady = await waitForCdp(cdpPort);
    if (!cdpReady) {
      throw new Error(`Timed out waiting for TRAE SOLO CN CDP port ${cdpPort}`);
    }
  }

  const health = await startDaemon();
  const token = await getToken(dataDir);
  let lastInjectStatus = 0;
  const injectDeadline = Date.now() + 12000;
  while (Date.now() < injectDeadline) {
    const injectResponse = await fetch(`http://${LOOPBACK_HOST}:${uiPort}/api/inject`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trae-enhancer-token": token,
      },
      body: "{}",
    });
    lastInjectStatus = injectResponse.status;
    if (injectResponse.ok) break;
    await delay(500);
  }
  if (lastInjectStatus !== 200) {
    throw new Error(`Failed to inject the enhancer UI: HTTP ${lastInjectStatus}`);
  }

  console.log(`[${APP_NAME}] Ready: http://${LOOPBACK_HOST}:${uiPort}`);
  console.log(`[${APP_NAME}] CDP: http://${LOOPBACK_HOST}:${cdpPort}`);
  console.log(`[${APP_NAME}] Accounts: ${health.accountCount || 0}`);
}

async function getToken(dataDirPath) {
  const token = await readTextFile(path.join(dataDirPath, "api-token"));
  return token.trim();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
