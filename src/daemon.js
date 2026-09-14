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
import { UI_INJECT_PATH } from "./lib/app-paths.js";
import { createDaemonLogger } from "./lib/daemon-log.js";
import { detectSeaApi, loadInjectSource, renderInjectScript } from "./lib/inject-source.js";
import { readJsonFile, readTextFile, writeTextAtomic } from "./lib/json-file.js";
import { DAEMON_LOG_PATH } from "./lib/runtime-paths.js";
import {
  createAccountsExport,
  openAccountsExport,
} from "./lib/secure-transfer.js";
import { normalizeAuthSnapshotForInjection } from "./lib/trae-storage.js";
import { SOURCES, createWindowsProbe, resolveTraeExe } from "./lib/trae-locate.js";
import {
  claimCheckin,
  fetchCheckinStatus,
  resolveCheckinReward,
} from "./lib/trae-checkin.js";
import { fetchTraeAccountInsights } from "./lib/trae-insights.js";
import {
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS,
  isKeepaliveDue,
  parseDuration,
} from "./lib/trae-keepalive.js";
import { TraeFakeLogoutManager } from "./lib/trae-fake-logout.js";
import {
  refreshAccountKeepalive,
  refreshAccountInsights,
  refreshAuthSnapshot,
} from "./lib/trae-refresh.js";
import {
  findTraeProcessIds,
  isCockpitRunning,
  startTraeWithCdp,
  stopTraeForRestart,
  traeExecutableExists,
  waitForCdp,
} from "./lib/trae-process.js";
import { TraeOAuthManager } from "./lib/trae-oauth.js";
import {
  applyAuthSnapshot,
  purgeLegacyTransactionDirectory,
  rollbackAuthSnapshot,
  waitForStorageIdentity,
} from "./lib/storage-transaction.js";

const CDP_PORT = parsePort(process.env.TRAE_ENHANCER_CDP_PORT, DEFAULT_CDP_PORT);
const UI_PORT = parsePort(process.env.TRAE_ENHANCER_UI_PORT, DEFAULT_UI_PORT);
const DATA_DIR = process.env.TRAE_ENHANCER_DATA_DIR || DEFAULT_DATA_DIR;
const STORAGE_PATH = process.env.TRAE_ENHANCER_STORAGE_PATH || DEFAULT_STORAGE_PATH;
/**
 * Resolved at startup from the configuration file and live detection. The
 * daemon must still run when TRAE is absent, because check-in and keep-alive
 * work from stored credentials; only the flows that restart TRAE need a path.
 */
let TRAE_EXE = process.env.TRAE_ENHANCER_TRAE_EXE || DEFAULT_TRAE_EXE;
const API_TOKEN_PATH = path.join(DATA_DIR, "api-token");
const LEGACY_TRANSACTION_DIR = path.join(DATA_DIR, "transactions");
const FAKE_LOGOUT_SESSION_PATH = path.join(DATA_DIR, "fake-logout", "session.json");
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const AUTO_CHECKIN_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_KEEPALIVE_ENABLED = process.env.TRAE_ENHANCER_AUTO_KEEPALIVE !== "0";
const AUTO_KEEPALIVE_INTERVAL_MS = parseDuration(
  process.env.TRAE_ENHANCER_KEEPALIVE_INTERVAL_MS,
  DEFAULT_KEEPALIVE_INTERVAL_MS,
);
const AUTO_KEEPALIVE_RETRY_INTERVAL_MS = parseDuration(
  process.env.TRAE_ENHANCER_KEEPALIVE_RETRY_INTERVAL_MS,
  DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS,
);
const AUTO_KEEPALIVE_SWEEP_INTERVAL_MS = parseDuration(
  process.env.TRAE_ENHANCER_KEEPALIVE_SWEEP_INTERVAL_MS,
  30 * 60 * 1000,
);

const accountStore = new AccountStore(DATA_DIR);
let cdpConnected = false;
let switchInFlight = null;
let loginStartInFlight = null;
let insightsRefreshInFlight = null;
let checkinInFlight = null;
let keepaliveInFlight = null;

async function getApiToken() {
  const existing = await readTextFile(API_TOKEN_PATH, { required: false });
  if (existing?.trim()) return existing.trim();
  const token = crypto.randomBytes(32).toString("hex");
  await writeTextAtomic(API_TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return token;
}

async function buildInjectScript(apiToken, seaApi) {
  const source = await loadInjectSource({ fallbackPath: UI_INJECT_PATH, seaApi });
  return renderInjectScript(source, {
    apiBase: `http://${LOOPBACK_HOST}:${UI_PORT}`,
    apiToken,
    appVersion: APP_VERSION,
  });
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
    if (size > MAX_REQUEST_BODY_BYTES) throw new Error("Request body is too large");
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
    throw new Error(
      [
        `TRAE SOLO CN 的可执行文件不存在：${TRAE_EXE}`,
        "请先指定一次路径，之后会被记住：",
        '  TraeEnhancer.exe configure --trae-exe "D:\\路径\\TRAE SOLO CN.exe"',
      ].join("\n"),
    );
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

async function refreshAccountsInsights(accountIds = null) {
  const accounts = await accountStore.list();
  const requested = accountIds ? new Set(accountIds.map(String)) : null;
  const selected = requested
    ? accounts.filter((account) => requested.has(account.id))
    : accounts;
  if (requested && selected.length !== requested.size) {
    throw new Error("One or more selected account backups were not found");
  }
  if (!selected.length) throw new Error("没有可刷新的账号");

  const results = [];
  for (const account of selected) {
    try {
      const snapshot = await accountStore.readSnapshot(account.id);
      const refreshed = await refreshAccountInsights(snapshot);
      if (refreshed.refreshedToken) {
        await accountStore.saveSnapshot(account.id, refreshed.snapshot);
      }
      const saved = await accountStore.saveInsights(account.id, refreshed.insights);
      results.push({ id: account.id, ok: true, account: saved });
    } catch (error) {
      const message = error.message || String(error);
      const saved = await accountStore.saveInsights(account.id, {
        ...(account.insights || {}),
        error: message,
        updatedAt: new Date().toISOString(),
      });
      results.push({ id: account.id, ok: false, error: message, account: saved });
    }
  }

  return {
    total: results.length,
    updated: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

function checkinDateKey(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

async function checkinOneAccount(account, { force = false, reason = "manual" } = {}) {
  const date = checkinDateKey();
  if (!force && account.checkin?.date === date && account.checkin.checkedInToday) {
    return { id: account.id, ok: true, skipped: true, reason: "already_checked" };
  }

  let snapshot = await accountStore.readSnapshot(account.id);
  let refreshedToken = false;
  const deviceId = account.userId || account.id;
  const runFlow = async () => {
    const status = await fetchCheckinStatus(snapshot, { deviceId });
    if (status.checkedInToday) return { status, claimed: false };
    try {
      const claim = await claimCheckin(snapshot, { deviceId });
      let finalStatus = claim;
      try {
        finalStatus = await fetchCheckinStatus(snapshot, { deviceId });
      } catch {
        // Claim success is still authoritative if the follow-up status refresh fails.
      }
      return { status: finalStatus, claim, claimed: true };
    } catch (error) {
      try {
        const recoveredStatus = await fetchCheckinStatus(snapshot, { deviceId });
        if (recoveredStatus.checkedInToday) {
          return { status: recoveredStatus, claimed: false };
        }
      } catch {
        // Preserve the claim error when the follow-up status check also fails.
      }
      throw error;
    }
  };

  try {
    let result;
    try {
      result = await runFlow();
    } catch (error) {
      if (!error.authExpired) throw error;
      const refreshed = await refreshAuthSnapshot(snapshot);
      snapshot = refreshed.snapshot;
      refreshedToken = true;
      await accountStore.saveSnapshot(account.id, snapshot);
      result = await runFlow();
    }

    const reward = resolveCheckinReward(result.status, result.claim);
    const saved = await accountStore.saveCheckin(account.id, {
      date,
      checkedInToday: true,
      checkedAt: new Date().toISOString(),
      credits: result.status.credits,
      reward,
      error: null,
      reason,
      updatedAt: new Date().toISOString(),
    });
    return {
      id: account.id,
      ok: true,
      skipped: !result.claimed,
      reward,
      credits: result.status.credits,
      refreshedToken,
      account: saved,
    };
  } catch (error) {
    const message = error.message || String(error);
    const saved = await accountStore.saveCheckin(account.id, {
      ...(account.checkin || {}),
      date,
      checkedInToday: false,
      error: message,
      reason,
      updatedAt: new Date().toISOString(),
    });
    return { id: account.id, ok: false, error: message, account: saved };
  }
}

async function runAccountCheckin(accountIds = null, { force = false, reason = "manual" } = {}) {
  if (checkinInFlight) throw new Error("Account check-in is already running");
  checkinInFlight = (async () => {
    const accounts = await accountStore.list();
    const requested = accountIds ? new Set(accountIds.map(String)) : null;
    const selected = requested
      ? accounts.filter((account) => requested.has(account.id))
      : accounts;
    if (requested && selected.length !== requested.size) {
      throw new Error("One or more selected account backups were not found");
    }
    if (!selected.length) throw new Error("没有可签到的账号");

    const results = [];
    for (const account of selected) {
      results.push(await checkinOneAccount(account, { force, reason }));
      if (selected.length > 1) await delay(350);
    }
    return {
      total: results.length,
      checkedIn: results.filter((result) => result.ok && !result.skipped).length,
      skipped: results.filter((result) => result.ok && result.skipped).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  })();
  try {
    return await checkinInFlight;
  } finally {
    checkinInFlight = null;
  }
}

async function keepaliveOneAccount(account, { reason = "scheduled" } = {}) {
  try {
    const snapshot = await accountStore.readSnapshot(account.id);
    const refreshed = await refreshAccountKeepalive(snapshot);
    await accountStore.saveSnapshot(account.id, refreshed.snapshot);
    if (refreshed.insights) {
      await accountStore.saveInsights(account.id, refreshed.insights);
    }
    const warning = refreshed.insightsError || refreshed.insights?.error || null;
    const saved = await accountStore.saveKeepalive(account.id, {
      status: "ok",
      reason,
      tokenRefreshed: true,
      insightsUpdated: !!refreshed.insights,
      warning,
      error: null,
      updatedAt: new Date().toISOString(),
    });
    return {
      id: account.id,
      ok: true,
      skipped: false,
      refreshedToken: true,
      insightsUpdated: !!refreshed.insights,
      warning,
      account: saved,
    };
  } catch (error) {
    const message = error.message || String(error);
    const saved = await accountStore.saveKeepalive(account.id, {
      ...(account.keepalive || {}),
      status: "error",
      reason,
      tokenRefreshed: false,
      insightsUpdated: false,
      warning: null,
      error: message,
      updatedAt: new Date().toISOString(),
    });
    return { id: account.id, ok: false, error: message, account: saved };
  }
}

async function keepaliveActiveAccount(
  account,
  storageRoot,
  { reason = "scheduled" } = {},
) {
  try {
    await accountStore.backupCurrent(storageRoot, { now: Date.now() });
    const snapshot = await accountStore.readSnapshot(account.id);
    let insights = null;
    let warning = null;
    try {
      insights = await fetchTraeAccountInsights(snapshot);
    } catch (error) {
      warning = error.message || String(error);
    }
    if (insights) await accountStore.saveInsights(account.id, insights);
    const saved = await accountStore.saveKeepalive(account.id, {
      status: "ok",
      reason,
      tokenRefreshed: false,
      syncedFromLive: true,
      insightsUpdated: !!insights,
      warning,
      error: null,
      updatedAt: new Date().toISOString(),
    });
    return {
      id: account.id,
      ok: true,
      skipped: false,
      activeAccount: true,
      tokenRefreshed: false,
      syncedFromLive: true,
      insightsUpdated: !!insights,
      warning,
      account: saved,
    };
  } catch (error) {
    const message = error.message || String(error);
    const saved = await accountStore.saveKeepalive(account.id, {
      ...(account.keepalive || {}),
      status: "error",
      reason,
      tokenRefreshed: false,
      syncedFromLive: false,
      insightsUpdated: false,
      warning: null,
      error: message,
      updatedAt: new Date().toISOString(),
    });
    return { id: account.id, ok: false, activeAccount: true, error: message, account: saved };
  }
}

async function runAccountKeepalive(
  accountIds = null,
  { force = false, reason = "manual" } = {},
) {
  if (keepaliveInFlight) throw new Error("Account keepalive is already running");
  keepaliveInFlight = (async () => {
    const accounts = await accountStore.list();
    const requested = accountIds ? new Set(accountIds.map(String)) : null;
    const selected = requested
      ? accounts.filter((account) => requested.has(account.id))
      : accounts;
    if (requested && selected.length !== requested.size) {
      throw new Error("One or more selected account backups were not found");
    }
    if (!selected.length) throw new Error("没有可保活的账号");

    let currentAccountId = null;
    let storageRoot = null;
    try {
      storageRoot = await readJsonFile(STORAGE_PATH);
      currentAccountId = await accountStore.resolveCurrentAccountId(storageRoot);
    } catch {
      currentAccountId = null;
    }

    const now = Date.now();
    const results = [];
    for (const account of selected) {
      if (
        !force &&
        !isKeepaliveDue(account, {
          now,
          intervalMs: AUTO_KEEPALIVE_INTERVAL_MS,
          retryIntervalMs: AUTO_KEEPALIVE_RETRY_INTERVAL_MS,
        })
      ) {
        results.push({ id: account.id, ok: true, skipped: true, reason: "not_due" });
        continue;
      }
      if (account.id === currentAccountId) {
        results.push(
          await keepaliveActiveAccount(account, storageRoot, { reason }),
        );
        continue;
      }
      results.push(await keepaliveOneAccount(account, { reason }));
      if (selected.length > 1) await delay(500);
    }

    return {
      total: selected.length,
      refreshed: results.filter((result) => result.ok && !result.skipped).length,
      skipped: results.filter((result) => result.ok && result.skipped).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  })();
  try {
    return await keepaliveInFlight;
  } finally {
    keepaliveInFlight = null;
  }
}

async function route(request, response, apiToken, cdpClient, oauthManager, fakeLogoutManager) {
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
      keepaliveEnabled: AUTO_KEEPALIVE_ENABLED,
      keepaliveIntervalMs: AUTO_KEEPALIVE_INTERVAL_MS,
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

  if (request.method === "POST" && pathname === "/api/accounts/export") {
    const body = await readRequestBody(request);
    const accountIds = Array.isArray(body.accountIds)
      ? body.accountIds.map((value) => String(value || "").trim()).filter(Boolean)
      : null;
    const snapshots = await accountStore.exportSnapshots(accountIds);
    const result = await createAccountsExport(snapshots, String(body.password || ""));
    jsonResponse(response, 200, {
      ok: true,
      filename: result.filename,
      mimeType: result.mimeType,
      content: result.content,
      count: result.count,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/accounts/import") {
    const body = await readRequestBody(request);
    const payload = await openAccountsExport(
      String(body.content || ""),
      String(body.password || ""),
    );
    const result = await accountStore.importSnapshots(payload.accounts);
    jsonResponse(response, 200, {
      ok: true,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      total: result.total,
      count: result.imported + result.updated,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/accounts/insights/refresh") {
    if (switchInFlight) {
      jsonResponse(response, 409, { ok: false, error: "An account switch is already running" });
      return;
    }
    if (checkinInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account check-in is already running" });
      return;
    }
    if (keepaliveInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account keepalive is already running" });
      return;
    }
    if (fakeLogoutManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A fake logout login flow is already running",
      });
      return;
    }
    if (insightsRefreshInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account insights are already refreshing" });
      return;
    }
    const body = await readRequestBody(request);
    const accountIds = Array.isArray(body.accountIds)
      ? body.accountIds.map((value) => String(value || "").trim()).filter(Boolean)
      : null;
    insightsRefreshInFlight = refreshAccountsInsights(accountIds);
    try {
      const result = await insightsRefreshInFlight;
      jsonResponse(response, 200, { ok: true, ...result });
    } finally {
      insightsRefreshInFlight = null;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/checkin/run") {
    if (switchInFlight) {
      jsonResponse(response, 409, { ok: false, error: "An account switch is already running" });
      return;
    }
    if (checkinInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account check-in is already running" });
      return;
    }
    if (keepaliveInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account keepalive is already running" });
      return;
    }
    if (loginStartInFlight) {
      jsonResponse(response, 409, { ok: false, error: "A login flow is already starting" });
      return;
    }
    if (oauthManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A seamless login flow is already running",
      });
      return;
    }
    if (fakeLogoutManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A fake logout login flow is already running",
      });
      return;
    }
    if (insightsRefreshInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account insights are already refreshing" });
      return;
    }
    const body = await readRequestBody(request);
    const accountIds = Array.isArray(body.accountIds)
      ? body.accountIds.map((value) => String(value || "").trim()).filter(Boolean)
      : null;
    const result = await runAccountCheckin(accountIds, {
      force: body.force === true,
      reason: "manual",
    });
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === "POST" && pathname === "/api/accounts/keepalive/run") {
    if (switchInFlight) {
      jsonResponse(response, 409, { ok: false, error: "An account switch is already running" });
      return;
    }
    if (checkinInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account check-in is already running" });
      return;
    }
    if (loginStartInFlight) {
      jsonResponse(response, 409, { ok: false, error: "A login flow is already starting" });
      return;
    }
    if (oauthManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A seamless login flow is already running",
      });
      return;
    }
    if (fakeLogoutManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A fake logout login flow is already running",
      });
      return;
    }
    if (insightsRefreshInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account insights are already refreshing" });
      return;
    }
    if (keepaliveInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account keepalive is already running" });
      return;
    }
    if (await isCockpitRunning()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "Cockpit Tools is running; keepalive was skipped to avoid token rotation conflicts",
      });
      return;
    }
    const body = await readRequestBody(request);
    const accountIds = Array.isArray(body.accountIds)
      ? body.accountIds.map((value) => String(value || "").trim()).filter(Boolean)
      : null;
    const result = await runAccountKeepalive(accountIds, {
      force: body.force === true,
      reason: "manual",
    });
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === "POST" && pathname === "/api/accounts/switch") {
    if (switchInFlight) {
      jsonResponse(response, 409, { ok: false, error: "An account switch is already running" });
      return;
    }
    if (checkinInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account check-in is already running" });
      return;
    }
    if (keepaliveInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account keepalive is already running" });
      return;
    }
    if (fakeLogoutManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A fake logout login flow is already running",
      });
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

  if (request.method === "POST" && pathname === "/api/fake-logout/start") {
    if (switchInFlight) {
      jsonResponse(response, 409, { ok: false, error: "An account switch is already running" });
      return;
    }
    if (checkinInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account check-in is already running" });
      return;
    }
    if (keepaliveInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account keepalive is already running" });
      return;
    }
    if (loginStartInFlight) {
      jsonResponse(response, 409, { ok: false, error: "A login flow is already starting" });
      return;
    }
    if (oauthManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A seamless login flow is already running",
      });
      return;
    }
    loginStartInFlight = fakeLogoutManager.start();
    try {
      const result = await loginStartInFlight;
      jsonResponse(response, 200, { ok: true, ...result });
    } finally {
      loginStartInFlight = null;
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/fake-logout/status") {
    const sessionId = requestUrl.searchParams.get("sessionId") || "";
    const status = fakeLogoutManager.status(sessionId);
    jsonResponse(response, status.status === "missing" ? 404 : 200, {
      ok: status.status !== "missing",
      ...status,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/fake-logout/active") {
    const status = fakeLogoutManager.active();
    jsonResponse(response, 200, { ok: true, ...status });
    return;
  }

  if (request.method === "POST" && pathname === "/api/fake-logout/cancel") {
    const body = await readRequestBody(request);
    const cancelled = await fakeLogoutManager.cancel(String(body.sessionId || ""));
    jsonResponse(response, 200, { ok: true, cancelled });
    return;
  }

  if (request.method === "POST" && pathname === "/api/oauth/start") {
    if (checkinInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account check-in is already running" });
      return;
    }
    if (keepaliveInFlight) {
      jsonResponse(response, 409, { ok: false, error: "Account keepalive is already running" });
      return;
    }
    if (fakeLogoutManager.isActive()) {
      jsonResponse(response, 409, {
        ok: false,
        error: "A fake logout login flow is already running",
      });
      return;
    }
    if (loginStartInFlight) {
      jsonResponse(response, 409, { ok: false, error: "A login flow is already starting" });
      return;
    }
    loginStartInFlight = oauthManager.start();
    try {
      const result = await loginStartInFlight;
      jsonResponse(response, 200, { ok: true, ...result });
    } finally {
      loginStartInFlight = null;
    }
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

/**
 * Routes every console call through the redacting file logger, so a failure on a
 * user machine leaves evidence without any risk of a credential reaching disk.
 * Returning the logger lets callers flush or inspect the path.
 */
function installLogging() {
  const logger = createDaemonLogger({ logPath: DAEMON_LOG_PATH });
  console.log = (...values) => logger.info(...values);
  console.info = (...values) => logger.info(...values);
  console.warn = (...values) => logger.warn(...values);
  console.error = (...values) => logger.error(...values);

  process.on("uncaughtException", (error) => {
    logger.error(`uncaught exception: ${error?.stack || error}`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`unhandled rejection: ${reason?.stack || reason}`);
    process.exit(1);
  });
  return logger;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  installLogging();
  const purgedTransactionDirectory = await purgeLegacyTransactionDirectory(
    LEGACY_TRANSACTION_DIR,
  );
  const accountRepair = await accountStore.repairIndex();
  const apiToken = await getApiToken();
  const seaApi = await detectSeaApi();

  const traeResolution = await resolveTraeExe({
    dataDir: DATA_DIR,
    probe: createWindowsProbe(),
  });
  if (traeResolution.path) {
    TRAE_EXE = traeResolution.path;
    console.log(
      `[trae] ${TRAE_EXE} (来源: ${SOURCES[traeResolution.source] ?? traeResolution.source})`,
    );
  } else {
    console.warn(
      "[trae] 未找到 TRAE SOLO CN：账号切换与登录流程不可用；签到与保活不受影响。",
    );
    console.warn(
      '[trae] 请运行 configure --trae-exe "D:\\路径\\TRAE SOLO CN.exe" 指定一次，之后会记住。',
    );
  }

  const cdpClient = new CdpClient({
    port: CDP_PORT,
    getInjectScript: () => buildInjectScript(apiToken, seaApi),
    onStateChange: (connected) => {
      cdpConnected = connected;
    },
  });
  const oauthManager = new TraeOAuthManager({
    accountStore,
    storagePath: STORAGE_PATH,
    exePath: TRAE_EXE,
    openBrowser: process.env.TRAE_ENHANCER_OPEN_BROWSER !== "0",
  });
  const fakeLogoutManager = new TraeFakeLogoutManager({
    accountStore,
    storagePath: STORAGE_PATH,
    stopTrae: stopTraeForSwitch,
    startTrae: startTraeForSwitch,
    isTraeRunning: async () => (await findTraeProcessIds(TRAE_EXE)).length > 0,
    getLiveIdentity: () => cdpClient.getLiveIdentity(),
    sessionPath: FAKE_LOGOUT_SESSION_PATH,
  });
  cdpClient.start();

  const server = http.createServer((request, response) => {
    route(
      request,
      response,
      apiToken,
      cdpClient,
      oauthManager,
      fakeLogoutManager,
    ).catch((error) => {
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
  console.log(`[cleanup] removed legacy transactions: ${purgedTransactionDirectory}`);
  if (accountRepair.repaired) {
    console.log(`[cleanup] repaired account metadata: ${accountRepair.repaired}`);
  }
  const recoveredFakeLogout = await fakeLogoutManager.recover();
  if (recoveredFakeLogout.status !== "missing") {
    console.log(
      `[fake-logout] recovered session status=${recoveredFakeLogout.status}`,
    );
    await cdpClient.inject().catch(() => false);
  }

  let autoCheckinTimer = null;
  let autoCheckinStartTimer = null;
  if (process.env.TRAE_ENHANCER_AUTO_CHECKIN !== "0") {
    const runScheduledCheckin = async () => {
      if (
        switchInFlight ||
        loginStartInFlight ||
        oauthManager.isActive() ||
        fakeLogoutManager.isActive() ||
        insightsRefreshInFlight ||
        checkinInFlight ||
        keepaliveInFlight
      ) {
        return;
      }
      try {
        if (await isCockpitRunning()) {
          console.log("[checkin] skipped because Cockpit Tools is running");
          return;
        }
        const result = await runAccountCheckin(null, {
          force: false,
          reason: "scheduled",
        });
        console.log(
          `[checkin] scheduled checked=${result.checkedIn} skipped=${result.skipped} failed=${result.failed}`,
        );
      } catch (error) {
        console.error(`[checkin] scheduled run failed: ${error.message || error}`);
      }
    };
    autoCheckinStartTimer = setTimeout(runScheduledCheckin, 5000);
    autoCheckinStartTimer.unref?.();
    autoCheckinTimer = setInterval(runScheduledCheckin, AUTO_CHECKIN_INTERVAL_MS);
    autoCheckinTimer.unref?.();
  }

  let autoKeepaliveTimer = null;
  let autoKeepaliveStartTimer = null;
  if (AUTO_KEEPALIVE_ENABLED) {
    const runScheduledKeepalive = async () => {
      if (
        switchInFlight ||
        loginStartInFlight ||
        oauthManager.isActive() ||
        fakeLogoutManager.isActive() ||
        insightsRefreshInFlight ||
        checkinInFlight ||
        keepaliveInFlight
      ) {
        return;
      }
      try {
        if (await isCockpitRunning()) {
          console.log("[keepalive] skipped because Cockpit Tools is running");
          return;
        }
        const result = await runAccountKeepalive(null, {
          force: false,
          reason: "scheduled",
        });
        console.log(
          `[keepalive] refreshed=${result.refreshed} skipped=${result.skipped} failed=${result.failed}`,
        );
      } catch (error) {
        console.error(`[keepalive] scheduled run failed: ${error.message || error}`);
      }
    };
    autoKeepaliveStartTimer = setTimeout(runScheduledKeepalive, 20_000);
    autoKeepaliveStartTimer.unref?.();
    autoKeepaliveTimer = setInterval(
      runScheduledKeepalive,
      AUTO_KEEPALIVE_SWEEP_INTERVAL_MS,
    );
    autoKeepaliveTimer.unref?.();
  }

  async function shutdown() {
    clearTimeout(autoCheckinStartTimer);
    clearInterval(autoCheckinTimer);
    clearTimeout(autoKeepaliveStartTimer);
    clearInterval(autoKeepaliveTimer);
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
