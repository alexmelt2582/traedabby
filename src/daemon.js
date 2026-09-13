import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CdpClient } from "./cdp/client.js";
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_CDP_PORT,
  DEFAULT_DATA_DIR,
  DEFAULT_STORAGE_PATH,
  DEFAULT_TRAE_EXE,
  DEFAULT_UI_PORT,
  LOOPBACK_HOST,
  parsePort,
} from "./constants.js";
import { AccountStore } from "./lib/accounts.js";
import { readJsonFile, readTextFile, writeTextAtomic } from "./lib/json-file.js";
import { normalizeAuthSnapshotForInjection } from "./lib/trae-storage.js";
import { refreshAuthSnapshot } from "./lib/trae-refresh.js";
import {
  findTraeProcessIds,
  startTraeWithCdp,
  stopTraeForRestart,
  traeExecutableExists,
  waitForCdp,
} from "./lib/trae-process.js";
import { TraeOAuthManager } from "./lib/trae-oauth.js";
import {
  applyAuthSnapshot,
  rollbackAuthSnapshot,
  waitForStorageIdentity,
} from "./lib/storage-transaction.js";

const CDP_PORT = parsePort(process.env.TRAE_ENHANCER_CDP_PORT, DEFAULT_CDP_PORT);
const UI_PORT = parsePort(process.env.TRAE_ENHANCER_UI_PORT, DEFAULT_UI_PORT);
const DATA_DIR = process.env.TRAE_ENHANCER_DATA_DIR || DEFAULT_DATA_DIR;
const STORAGE_PATH = process.env.TRAE_ENHANCER_STORAGE_PATH || DEFAULT_STORAGE_PATH;
const TRAE_EXE = process.env.TRAE_ENHANCER_TRAE_EXE || DEFAULT_TRAE_EXE;
const API_TOKEN_PATH = path.join(DATA_DIR, "api-token");
const TRANSACTION_DIR = path.join(DATA_DIR, "transactions");

const accountStore = new AccountStore(DATA_DIR);
let cdpConnected = false;
let switchInFlight = null;

async function getApiToken() {
  const existing = await readTextFile(API_TOKEN_PATH, { required: false });
  if (existing?.trim()) return existing.trim();
  const token = crypto.randomBytes(32).toString("hex");
  await writeTextAtomic(API_TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return token;
}

async function buildInjectScript(apiToken) {
  const source = await readTextFile(path.join(import.meta.dirname, "ui", "inject.js"));
  return source
    .replaceAll("__API_BASE__", `http://${LOOPBACK_HOST}:${UI_PORT}`)
    .replaceAll("__API_TOKEN__", apiToken);
}

function jsonResponse(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-trae-enhancer-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  response.end(payload);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requireApiToken(request, apiToken) {
  return request.headers["x-trae-enhancer-token"] === apiToken;
}

async function stopTraeForSwitch() {
  if (!(await traeExecutableExists(TRAE_EXE))) {
    throw new Error(`TRAE SOLO CN executable was not found: ${TRAE_EXE}`);
  }
  await stopTraeForRestart(TRAE_EXE);
  await delay(700);
  if ((await findTraeProcessIds(TRAE_EXE)).length) {
    await stopTraeForRestart(TRAE_EXE);
    await delay(700);
  }
  if ((await findTraeProcessIds(TRAE_EXE)).length) {
    throw new Error("TRAE SOLO CN did not remain fully stopped");
  }
}

async function startTraeForSwitch() {
  await startTraeWithCdp(TRAE_EXE, CDP_PORT);
  return await waitForCdp(CDP_PORT);
}

async function restartTraeForSwitch() {
  await stopTraeForSwitch();
  return await startTraeForSwitch();
}

async function switchAccount(accountId) {
  const account = await accountStore.findAccount(accountId);
  if (!account) throw new Error("Account backup was not found");
  let snapshot = normalizeAuthSnapshotForInjection(
    await accountStore.readSnapshot(accountId),
  );

  try {
    const refreshed = await refreshAuthSnapshot(snapshot);
    snapshot = refreshed.snapshot;
    await accountStore.saveSnapshot(accountId, snapshot);
  } catch (error) {
    throw new Error(
      `目标账号登录凭据已失效，请重新登录该账号后再切换：${error.message || error}`,
    );
  }

  await stopTraeForSwitch();
  let transaction;
  try {
    transaction = await applyAuthSnapshot({
      storagePath: STORAGE_PATH,
      snapshot,
      transactionDir: TRANSACTION_DIR,
    });
  } catch (error) {
    await startTraeForSwitch().catch(() => false);
    throw error;
  }

  try {
    await startTraeForSwitch();
    const verification = await waitForStorageIdentity(STORAGE_PATH, account.userId);
    if (!verification.ok) {
      throw new Error("TRAE did not accept the selected account after restart");
    }
    return {
      account,
      transactionId: transaction.transactionId,
      verified: true,
      refreshWarning: null,
    };
  } catch (error) {
    await stopTraeForSwitch().catch(() => {});
    await rollbackAuthSnapshot(STORAGE_PATH, transaction);
    await restartTraeForSwitch().catch(() => false);
    throw new Error(`${error.message}; the previous login state was restored`);
  }
}

async function route(request, response, apiToken, cdpClient, oauthManager) {
  const requestUrl = new URL(request.url || "/", `http://${LOOPBACK_HOST}:${UI_PORT}`);
  const pathname = requestUrl.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,x-trae-enhancer-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-max-age": "600",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    const accounts = await accountStore.list();
    jsonResponse(response, 200, {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      pid: process.pid,
      cdpPort: CDP_PORT,
      cdpConnected,
      accountCount: accounts.length,
    });
    return;
  }

  if (!requireApiToken(request, apiToken)) {
    jsonResponse(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/accounts") {
    const accounts = await accountStore.list();
    let currentAccountId = null;
    try {
      const storageRoot = await readJsonFile(STORAGE_PATH);
      currentAccountId = await accountStore.resolveCurrentAccountId(storageRoot);
    } catch {
      currentAccountId = null;
    }
    jsonResponse(response, 200, { ok: true, accounts, currentAccountId });
    return;
  }

  if (request.method === "POST" && pathname === "/api/accounts/backup") {
    const storageRoot = await readJsonFile(STORAGE_PATH);
    const liveIdentity = await cdpClient.getLiveIdentity();
    const result = await accountStore.backupCurrent(storageRoot, { liveIdentity });
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === "POST" && pathname === "/api/accounts/switch") {
    if (switchInFlight) {
      jsonResponse(response, 409, { ok: false, error: "An account switch is already running" });
      return;
    }
    const body = await readRequestBody(request);
    switchInFlight = switchAccount(String(body.accountId || ""));
    try {
      const result = await switchInFlight;
      jsonResponse(response, 200, { ok: true, ...result });
    } finally {
      switchInFlight = null;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/oauth/start") {
    const result = await oauthManager.start();
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === "GET" && pathname === "/api/oauth/status") {
    const loginId = requestUrl.searchParams.get("loginId") || "";
    const status = oauthManager.status(loginId);
    jsonResponse(response, status.status === "missing" ? 404 : 200, {
      ok: status.status !== "missing",
      ...status,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/oauth/cancel") {
    const body = await readRequestBody(request);
    const cancelled = oauthManager.cancel(String(body.loginId || ""));
    jsonResponse(response, 200, { ok: true, cancelled });
    return;
  }

  if (request.method === "POST" && pathname === "/api/oauth/open") {
    const body = await readRequestBody(request);
    const result = await oauthManager.reopen(String(body.loginId || ""));
    jsonResponse(response, 200, { ok: true, ...(result || { opened: false }) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/inject") {
    const injected = await cdpClient.inject();
    jsonResponse(response, injected ? 200 : 503, {
      ok: injected,
      error: injected ? undefined : "CDP is not connected",
    });
    return;
  }

  jsonResponse(response, 404, { ok: false, error: "Not found" });
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const apiToken = await getApiToken();
  const cdpClient = new CdpClient({
    port: CDP_PORT,
    getInjectScript: () => buildInjectScript(apiToken),
    onStateChange: (connected) => {
      cdpConnected = connected;
    },
  });
  const oauthManager = new TraeOAuthManager({
    accountStore,
    storagePath: STORAGE_PATH,
    exePath: process.env.TRAE_ENHANCER_TRAE_EXE || DEFAULT_TRAE_EXE,
    openBrowser: process.env.TRAE_ENHANCER_OPEN_BROWSER !== "0",
  });
  cdpClient.start();

  const server = http.createServer((request, response) => {
    route(request, response, apiToken, cdpClient, oauthManager).catch((error) => {
      jsonResponse(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(UI_PORT, LOOPBACK_HOST, resolve);
  });

  console.log(`${APP_NAME} daemon listening on http://${LOOPBACK_HOST}:${UI_PORT}`);

  async function shutdown() {
    cdpClient.stop().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    await delay(60_000);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
