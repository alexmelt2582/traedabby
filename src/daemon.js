import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

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
import {
  CHECKIN_INTERVALS,
  PROXY_MODES,
  configPath,
  loadAppConfig,
  normalizeCheckin,
  normalizeProxyConfig,
  normalizeTraeUpdate,
  saveAppConfig,
} from "./lib/app-config.js";
import { UI_INJECT_PATH } from "./lib/app-paths.js";
import { createDaemonLogger } from "./lib/daemon-log.js";
import { detectSeaApi, loadInjectSource, renderInjectScript } from "./lib/inject-source.js";
import { readJsonFile, readTextFile, writeTextAtomic } from "./lib/json-file.js";
import { serviceSpec } from "./lib/launch-spec.js";
import {
  STATIC_HOSTS,
  describeErrorChain,
  formatProbeLine,
  probeHosts,
  probeSucceeded,
  proxyChildEnv,
  proxyEnvEnabled,
  proxyEnvReport,
  stripProxyEnv,
} from "./lib/net-diagnostics.js";
import { DAEMON_LOG_PATH } from "./lib/runtime-paths.js";
import {
  PROXY_MODE_DESCRIPTIONS,
  PROXY_MODE_LABELS,
  buildProxyVars,
  describeProxyState,
  readWindowsSystemProxy,
  resolveProxyVars,
} from "./lib/system-proxy.js";
import {
  TRAE_UPDATE_MODE_SUPPRESSED,
  applyTraeUpdateSetting,
  readTraeUpdateState,
} from "./lib/trae-settings.js";
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
  probeCockpitTools,
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
const execFileAsync = promisify(execFile);
let cdpConnected = false;
let switchInFlight = null;
let loginStartInFlight = null;
let insightsRefreshInFlight = null;
let checkinInFlight = null;
let keepaliveInFlight = null;

/**
 * Assigned by `main()` once the HTTP server is listening. Restarting is only
 * meaningful from that point on, and a hook keeps `route()` free of the server's
 * local state.
 */
let daemonShutdown = null;
let daemonRestartRequested = false;

/**
 * Assigned by `main()` next to the timers themselves. `POST /api/settings/checkin`
 * has to reach the running schedule, and a hook keeps `route()` out of the
 * timers' local state.
 */
let rescheduleAutoCheckin = null;

/**
 * Set at start-up when this run actually changed TRAE's settings file, so the
 * panel can say so once instead of changing a user's editor configuration
 * silently. Cleared when the panel has been told.
 */
let traeUpdateStartupNotice = null;
/** Set when TRAE's settings file could not be read or written at start-up. */
let traeUpdateStartupError = null;

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

/**
 * Event name the injected panel listens for. Both sides must agree on it.
 */
const ACCOUNTS_UPDATED_EVENT = "trae-enhancer:accounts-updated";

/**
 * Tells the injected panel that account state changed on disk.
 *
 * The panel is a pure view — it never derives check-in state itself — so this is
 * how a background sweep makes an already-open panel show the new result. The
 * panel keeps no polling loop, so without this push it would only catch up the
 * next time it was opened, which is exactly the v1.0.0 defect.
 *
 * Never throws. A disconnected CDP is recoverable: the panel refreshes whenever
 * it is opened, which is the fallback path on a machine where injection failed.
 */
async function notifyAccountsUpdated(cdpClient) {
  if (!cdpClient?.isConnected) {
    // Worth a line in the log: on another machine this is the evidence that the
    // open panel will stay stale until it is reopened.
    console.warn("[push] CDP is not connected; the panel was not notified");
    return false;
  }
  try {
    await cdpClient.evaluate(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(ACCOUNTS_UPDATED_EVENT)}))`,
      { awaitPromise: false, timeoutMs: 3000 },
    );
    return true;
  } catch (error) {
    console.warn(`[push] failed to notify the panel: ${error?.message || error}`);
    return false;
  }
}

/* -------------------------------------------------------------------------- *
 * Network settings
 *
 * Node reads its proxy configuration once, when the process starts:
 * `NODE_USE_ENV_PROXY` and `HTTP_PROXY`/`HTTPS_PROXY` are ignored if they are set
 * later. The daemon therefore cannot switch proxy at runtime — it can only save
 * the configuration and restart itself. Every payload below says so explicitly,
 * because a save that silently needs a restart is worse than no save at all.
 * -------------------------------------------------------------------------- */

/**
 * Loads the saved proxy configuration plus what it resolves to right now.
 *
 * In `system` mode this reads the Windows registry, so it costs a PowerShell
 * round-trip and is only called for settings requests.
 */
async function readProxySettings() {
  const config = await loadAppConfig(DATA_DIR);
  const systemRead = config.proxy.mode === "system" ? await readWindowsSystemProxy() : null;
  const resolved = buildProxyVars(config.proxy, systemRead);
  return { config, systemRead, resolved };
}

/** The shape the panel's settings tab renders. */
function proxySettingsPayload({ config, systemRead, resolved }) {
  return {
    modes: PROXY_MODES.map((mode) => ({
      value: mode,
      label: PROXY_MODE_LABELS[mode] ?? mode,
      description: PROXY_MODE_DESCRIPTIONS[mode] ?? "",
    })),
    state: describeProxyState(config.proxy, resolved, systemRead),
    // Whether *this* daemon process reaches the network through a proxy. Reported
    // so "已保存" can never be mistaken for "已生效".
    activeInThisProcess: proxyEnvEnabled() && Boolean(resolved.vars),
    envProxyEnabled: proxyEnvEnabled(),
    envReport: proxyEnvReport(),
    configPath: configPath(DATA_DIR),
  };
}

/**
 * Automatic check-in as the panel renders it.
 *
 * `options` is published from here rather than hard-coded in the panel, so the
 * allowed intervals cannot drift between the two.
 */
function checkinSettingsPayload(checkin) {
  return {
    auto: checkin.auto,
    intervalMinutes: checkin.intervalMinutes,
    onClientLoad: checkin.onClientLoad,
    options: [...CHECKIN_INTERVALS],
  };
}

/**
 * Runs the host probe in a child process, with an environment chosen by the caller.
 *
 * A child is not optional here. A "direct" probe is only meaningful from a process
 * that was not started with `NODE_USE_ENV_PROXY`, and a proxied probe cannot reuse
 * this daemon's own connections because its proxy variables are already fixed.
 */
async function probeHostsInChild(hosts, env) {
  const launch = serviceSpec("net", [
    "--probe-only",
    ...hosts.flatMap((host) => ["--host", host]),
  ]);
  try {
    const { stdout } = await execFileAsync(launch.command, launch.args, {
      cwd: launch.cwd,
      env,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const line = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    const parsed = JSON.parse(line);
    return { results: Array.isArray(parsed.results) ? parsed.results : [], error: null };
  } catch (error) {
    return { results: [], error: describeErrorChain(error) };
  }
}

function probeRunPayload(run) {
  if (!run) return null;
  return {
    results: run.results,
    error: run.error,
    lines: run.results.map(formatProbeLine),
    reachable: run.results.length > 0 && run.results.every(probeSucceeded),
  };
}

/**
 * Probes the required hosts twice: forced direct, then through the candidate
 * configuration. This is what lets the panel answer "是否需要代理" with evidence
 * instead of a guess, and it also works for a candidate that has not been saved.
 */
async function testProxyConfiguration(body) {
  const requested = Array.isArray(body?.hosts) ? body.hosts : [];
  const hosts = (requested.length ? requested : STATIC_HOSTS)
    .map((host) => String(host).trim())
    .filter(Boolean);
  const candidate = body?.proxy
    ? normalizeProxyConfig(body.proxy)
    : (await loadAppConfig(DATA_DIR)).proxy;

  const systemRead = candidate.mode === "system" ? await readWindowsSystemProxy() : null;
  const resolved = buildProxyVars(candidate, systemRead);

  // Strip first, then add: the daemon's own environment carries the proxy it was
  // started with, and inheriting it would make both probes measure the old setting.
  const baseEnv = stripProxyEnv(process.env);
  const direct = probeRunPayload(await probeHostsInChild(hosts, baseEnv));
  const proxied = resolved.vars
    ? probeRunPayload(
        await probeHostsInChild(hosts, proxyChildEnv({ proxyVars: resolved.vars, env: baseEnv })),
      )
    : null;

  const conclusion = direct.reachable ? "direct" : proxied?.reachable ? "proxy" : "none";
  const conclusionText =
    conclusion === "direct"
      ? "直连可达，不需要代理。"
      : conclusion === "proxy"
        ? "直连失败，但走这个代理可达 —— 可以保存这个配置。"
        : "直连和代理都不可达，请核对代理地址，或把下面的探测详情发给排查方。";

  return {
    hosts,
    direct,
    proxied,
    state: describeProxyState(candidate, resolved, systemRead),
    conclusion,
    conclusionText,
  };
}

/* -------------------------------------------------------------------------- *
 * TRAE's own auto-update
 *
 * `update.mode: "manual"` is what stops TRAE from checking for updates, and it is
 * read once, when TRAE starts, so the panel always says "restart TRAE to take
 * effect" instead of implying the change is already live.
 * -------------------------------------------------------------------------- */

/** The shape the panel renders for the TRAE update section. */
function traeUpdatePayload(state, extra = {}) {
  return {
    suppress: extra.suppress ?? null,
    path: state.path,
    settingsExists: state.exists,
    fileMode: state.mode,
    settingsSuppressed: state.suppressed,
    readable: state.readable,
    error: state.error ?? null,
    backupPath: extra.backupPath ?? null,
    changed: extra.changed ?? false,
    // TRAE reads this setting when it starts, so an edit is never live yet.
    traeRestartRequired: true,
  };
}

/**
 * Makes TRAE's settings file match the saved preference.
 *
 * `previousMode` is captured before the first write so "允许自动更新" can restore
 * what was there rather than guessing. The write is skipped when the file already
 * says the right thing, which keeps TRAE's settings.json untouched on every daemon
 * restart.
 */
async function syncTraeUpdateSetting({ suppress, previousMode = null } = {}) {
  const current = await readTraeUpdateState();
  const remembered =
    previousMode ??
    (typeof current.mode === "string" && current.mode !== TRAE_UPDATE_MODE_SUPPRESSED
      ? current.mode
      : null);
  const result = await applyTraeUpdateSetting({ suppress, previousMode: remembered });
  return { result, state: await readTraeUpdateState(), remembered };
}

/**
 * Restarts the daemon by handing the job to a detached helper and then exiting.
 *
 * The helper is `service daemon --wait-pid <this pid>`, so it waits for this
 * process to disappear before spawning a replacement and the two never contend
 * for the listening port. It is spawned with a proxy-free environment on purpose:
 * otherwise it would inherit this process's `NODE_USE_ENV_PROXY` and old proxy
 * variables, and a change to "不使用代理" would keep using the previous proxy.
 *
 * The helper also re-creates the supervisor if it is missing, so a restart repairs
 * a machine where the logon autostart entry is absent.
 */
function scheduleDaemonRestart() {
  if (!daemonShutdown) {
    throw new Error("守护进程仍在启动中，请稍后再试");
  }
  if (daemonRestartRequested) {
    return { restarting: true, alreadyRequested: true, pid: process.pid, helperPid: null };
  }
  daemonRestartRequested = true;

  const launch = serviceSpec("daemon", ["--wait-pid", String(process.pid)]);
  let helperPid = null;
  try {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: stripProxyEnv(process.env),
    });
    child.unref();
    helperPid = child.pid ?? null;
  } catch (error) {
    daemonRestartRequested = false;
    throw new Error(`无法启动重启助手：${error?.message || error}`);
  }

  console.log(`[restart] helper pid=${helperPid ?? "unknown"} is waiting for pid ${process.pid}`);

  // Give the HTTP response a moment to flush before this process goes away; the
  // shutdown path closes live connections, which would cut off that response.
  const timer = setTimeout(() => {
    daemonShutdown()?.catch?.((error) => {
      console.error(`[restart] shutdown failed: ${error?.message || error}`);
      process.exit(0);
    });
  }, 400);
  timer.unref?.();

  return { restarting: true, alreadyRequested: false, pid: process.pid, helperPid };
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

/**
 * Checks and, when needed, claims today's reward for one account.
 *
 * `allowTokenRefresh` gates the only step that rotates credentials. Cockpit Tools
 * rotates the same refresh tokens, so when its presence cannot be determined the
 * check-in still runs with the existing credentials but must not rotate them.
 */
/**
 * Resolves how a sweep must react to the current Cockpit Tools state.
 *
 * The three outcomes are intentionally different. Cockpit Tools and this daemon
 * rotate the same refresh tokens, so the real conflict surface is *rotation*:
 *
 *   - `skip`            — Cockpit is definitely running; do nothing at all.
 *   - `no-token-refresh` — the probe could not decide. A check-in only reuses the
 *                          existing credentials, so it may proceed; keep-alive
 *                          always rotates, so it must not.
 *   - `run`             — Cockpit is definitely not running.
 *
 * `probeCockpitTools()` never throws, so a broken probe can no longer abort a
 * whole sweep the way the PowerShell-only probe did in v1.0.0.
 */
async function resolveCockpitPolicy() {
  const probe = await probeCockpitTools();
  if (probe.running === true) return { action: "skip", probe };
  if (probe.running === null) {
    console.warn(
      `[cockpit] probe failed (${probe.error}); check-in continues without token rotation, keep-alive will skip`,
    );
    return { action: "no-token-refresh", probe };
  }
  return { action: "run", probe };
}

async function checkinOneAccount(
  account,
  { force = false, reason = "manual", allowTokenRefresh = true } = {},
) {
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
      if (!allowTokenRefresh) throw error;
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

async function runAccountCheckin(
  accountIds = null,
  { force = false, reason = "manual", allowTokenRefresh = true } = {},
) {
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
      results.push(await checkinOneAccount(account, { force, reason, allowTokenRefresh }));
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

    let active = { id: null, state: "unknown" };
    let storageRoot = null;
    try {
      storageRoot = await readJsonFile(STORAGE_PATH);
      active = await accountStore.resolveActiveAccount(storageRoot);
    } catch {
      active = { id: null, state: "unknown" };
    }

    // Rotating a refresh token can invalidate whoever still holds the old one, so
    // it is only safe once TRAE is known not to be signed in as an account we
    // manage. When the live identity cannot be read at all, refusing the whole
    // sweep is the only safe answer — the same rule the Cockpit probe follows.
    // `not-managed` needs no guard: TRAE holds an account outside this list, so
    // refreshing anything here cannot disturb that session.
    if (active.state === "unknown") {
      console.warn(
        "[keepalive] TRAE's signed-in account could not be read; skipping this sweep rather than rotating a refresh token that may still be in use",
      );
      return {
        total: selected.length,
        refreshed: 0,
        skipped: selected.length,
        failed: 0,
        skippedReason: "active-unknown",
        results: selected.map((account) => ({
          id: account.id,
          ok: true,
          skipped: true,
          reason: "active-unknown",
        })),
      };
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
      if (account.id === active.id) {
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
    // Logged here rather than left to the generic handler: the panel's empty state
    // cannot tell "no accounts saved yet" from "adoption failed", so this line is
    // the only place that distinction survives.
    try {
      const storageRoot = await readJsonFile(STORAGE_PATH);
      const liveIdentity = await cdpClient.getLiveIdentity();
      const result = await accountStore.backupCurrent(storageRoot, { liveIdentity });
      await notifyAccountsUpdated(cdpClient);
      jsonResponse(response, 200, { ok: true, ...result });
    } catch (error) {
      console.error(`[backup] could not save the current account: ${error.message || error}`);
      jsonResponse(response, 500, { ok: false, error: error.message || String(error) });
    }
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
    await notifyAccountsUpdated(cdpClient);
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

  /**
   * The panel reports that it was just opened.
   *
   * The daemon owns the work so the panel can stay a pure view: reconcile today's
   * check-in state against the server, refresh credits, then push the result back.
   * `checkinOneAccount()` is idempotent, so an account that was already checked in
   * is recorded as such without claiming a second reward — this is what turns
   * "actually checked in but shown as pending" into the correct display without
   * the user pressing anything.
   */
  if (request.method === "POST" && pathname === "/api/accounts/panel-open") {
    if (
      switchInFlight ||
      loginStartInFlight ||
      oauthManager.isActive() ||
      fakeLogoutManager.isActive() ||
      insightsRefreshInFlight ||
      checkinInFlight ||
      keepaliveInFlight
    ) {
      // Another sweep is already producing fresh state and will push when it is
      // done. The panel uses this flag to fall back to its own credit refresh
      // instead of being left with stale numbers.
      jsonResponse(response, 200, { ok: true, busy: true });
      return;
    }

    const cockpit = await resolveCockpitPolicy();
    if (cockpit.action === "skip") {
      jsonResponse(response, 200, {
        ok: true,
        skipped: "cockpit",
        cockpit: { running: true, source: cockpit.probe.source },
      });
      return;
    }

    // When the probe could not decide, the check-in may still run because it only
    // reuses the existing credentials. The credit refresh is skipped instead: it
    // falls back to `refreshAuthSnapshot()` on auth expiry, which does rotate the
    // refresh token that Cockpit Tools also holds.
    const canRotate = cockpit.action === "run";
    let checkin = null;
    let insights = null;
    if (!canRotate) {
      console.warn(
        "[panel-open] Cockpit Tools state is unknown; reconciling check-in without token rotation and skipping the credit refresh",
      );
    }
    try {
      checkin = await runAccountCheckin(null, {
        force: false,
        reason: "panel",
        allowTokenRefresh: canRotate,
      });
    } catch (error) {
      checkin = { error: error.message || String(error) };
    }
    if (canRotate) {
      insightsRefreshInFlight = refreshAccountsInsights(null);
      try {
        insights = await insightsRefreshInFlight;
      } catch (error) {
        insights = { error: error.message || String(error) };
      } finally {
        insightsRefreshInFlight = null;
      }
    }

    await notifyAccountsUpdated(cdpClient);
    jsonResponse(response, 200, {
      ok: true,
      cockpit: { running: cockpit.probe.running, source: cockpit.probe.source },
      checkin,
      insights,
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
      await notifyAccountsUpdated(cdpClient);
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
    await notifyAccountsUpdated(cdpClient);
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
    const cockpit = await resolveCockpitPolicy();
    if (cockpit.action !== "run") {
      jsonResponse(response, 409, {
        ok: false,
        error:
          cockpit.action === "skip"
            ? "Cockpit Tools is running; keepalive was skipped to avoid token rotation conflicts"
            : "Could not determine whether Cockpit Tools is running; keepalive was skipped because it always rotates credentials",
        cockpit: {
          running: cockpit.probe.running,
          source: cockpit.probe.source,
          error: cockpit.probe.error,
        },
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
    await notifyAccountsUpdated(cdpClient);
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
      await notifyAccountsUpdated(cdpClient);
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

  if (request.method === "GET" && pathname === "/api/settings") {
    const settings = await readProxySettings();
    const updateState = await readTraeUpdateState();
    jsonResponse(response, 200, {
      ok: true,
      network: proxySettingsPayload(settings),
      checkin: checkinSettingsPayload(settings.config.checkin),
      traeUpdate: {
        ...traeUpdatePayload(updateState, { suppress: settings.config.traeUpdate.suppress }),
        startupNotice: traeUpdateStartupNotice,
        startupError: traeUpdateStartupError,
      },
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/settings/trae-update") {
    const body = await readRequestBody(request);
    const current = await loadAppConfig(DATA_DIR);
    const suppress =
      body?.suppress === undefined
        ? current.traeUpdate.suppress
        : normalizeTraeUpdate({ suppress: body.suppress }).suppress;

    const { result, state, remembered } = await syncTraeUpdateSetting({
      suppress,
      previousMode: current.traeUpdate.previousMode,
    });
    await saveAppConfig(DATA_DIR, {
      traeUpdate: { suppress, previousMode: suppress ? remembered : current.traeUpdate.previousMode },
    });
    // The user just acted, so a start-up notice would be stale.
    traeUpdateStartupNotice = null;
    traeUpdateStartupError = null;

    console.log(
      `[settings] trae auto-update suppress=${suppress} changed=${result.changed} mode=${state.mode}`,
    );
    jsonResponse(response, 200, {
      ok: true,
      traeUpdate: traeUpdatePayload(state, {
        suppress,
        changed: result.changed,
        backupPath: result.backupPath,
      }),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/settings/checkin") {
    const body = await readRequestBody(request);
    const current = await loadAppConfig(DATA_DIR);
    // Every field is optional and an omitted one keeps its current value: the
    // panel submits the three controls as one form, but a partial request must
    // not quietly reset the rest to the defaults.
    const checkin = normalizeCheckin({
      ...current.checkin,
      ...(body?.auto === undefined ? {} : { auto: body.auto }),
      ...(body?.intervalMinutes === undefined ? {} : { intervalMinutes: body.intervalMinutes }),
      ...(body?.onClientLoad === undefined ? {} : { onClientLoad: body.onClientLoad }),
    });
    await saveAppConfig(DATA_DIR, { checkin });
    // Unlike the proxy, this takes effect in the running process: the schedule is
    // rebuilt here, and every later trigger re-reads the configuration. No
    // restart, and no "restart to apply" notice in the panel.
    rescheduleAutoCheckin?.({ initialRun: false });
    console.log(
      `[settings] checkin auto=${checkin.auto} interval=${checkin.intervalMinutes} onClientLoad=${checkin.onClientLoad}`,
    );
    jsonResponse(response, 200, { ok: true, checkin: checkinSettingsPayload(checkin) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/settings/network") {
    const body = await readRequestBody(request);
    const current = await loadAppConfig(DATA_DIR);
    const proxy =
      body?.proxy === undefined ? current.proxy : normalizeProxyConfig(body.proxy);
    const saved = await saveAppConfig(DATA_DIR, { proxy });
    const settings = await readProxySettings();
    console.log(
      `[settings] proxy mode=${saved.proxy.mode} url=${saved.proxy.url ? "set" : "unset"}`,
    );
    jsonResponse(response, 200, {
      ok: true,
      // Always true: the running daemon cannot adopt a proxy it did not start with.
      restartRequired: true,
      network: proxySettingsPayload(settings),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/settings/network/test") {
    const body = await readRequestBody(request);
    const result = await testProxyConfiguration(body);
    jsonResponse(response, 200, { ok: true, ...result });
    return;
  }

  if (request.method === "POST" && pathname === "/api/daemon/restart") {
    const result = scheduleDaemonRestart();
    jsonResponse(response, 200, { ok: true, ...result });
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

  /* ------------------------------------------------------------------------ *
   * Automatic check-in
   *
   * The schedule and both on/off switches come from `config.checkin`, and every
   * trigger re-reads the configuration instead of closing over the copy loaded at
   * start-up: `POST /api/settings/checkin` has to take effect in the running
   * process, and a captured value would silently ignore it.
   *
   * All four helpers are function declarations so that `onStateChange` below can
   * reference them before their textual position.
   * ------------------------------------------------------------------------ */

  let autoCheckinTimer = null;
  let autoCheckinStartTimer = null;
  /** Re-armed on every disconnect: one run per TRAE session, not per reconnect. */
  let clientLoadCheckinDone = false;
  /** Set on the first attempt, success or failure: a later reconnect must not
   * adopt an account the user has since removed by hand. */
  let adoptAttempted = false;

  async function runScheduledCheckin(reason) {
    if (
      switchInFlight ||
      loginStartInFlight ||
      oauthManager.isActive() ||
      fakeLogoutManager.isActive() ||
      insightsRefreshInFlight ||
      checkinInFlight ||
      keepaliveInFlight
    ) {
      // Another sweep is already doing the same work; it will push when it is done.
      return;
    }
    try {
      const cockpit = await resolveCockpitPolicy();
      if (cockpit.action === "skip") {
        console.log(`[checkin] ${reason} skipped because Cockpit Tools is running`);
        return;
      }
      const result = await runAccountCheckin(null, {
        force: false,
        reason,
        allowTokenRefresh: cockpit.action !== "no-token-refresh",
      });
      console.log(
        `[checkin] ${reason} checked=${result.checkedIn} skipped=${result.skipped} failed=${result.failed}`,
      );
      await notifyAccountsUpdated(cdpClient);
    } catch (error) {
      console.error(`[checkin] ${reason} run failed: ${error.message || error}`);
    }
  }

  /**
   * Rebuilds the schedule from the saved configuration.
   *
   * `initialRun` is only ever true on the start-up path. A settings change must
   * rebuild the interval without claiming a reward as a side effect, so the
   * caller passes false.
   */
  async function scheduleAutoCheckin({ initialRun = false } = {}) {
    clearTimeout(autoCheckinStartTimer);
    clearInterval(autoCheckinTimer);
    autoCheckinStartTimer = null;
    autoCheckinTimer = null;

    if (process.env.TRAE_ENHANCER_AUTO_CHECKIN === "0") return;

    let config;
    try {
      config = await loadAppConfig(DATA_DIR);
    } catch (error) {
      console.error(`[checkin] could not read the configuration: ${error.message || error}`);
      return;
    }
    if (!config.checkin.auto) {
      console.log("[checkin] automatic check-in is disabled by configuration");
      return;
    }

    if (initialRun) {
      autoCheckinStartTimer = setTimeout(() => void runScheduledCheckin("scheduled"), 5000);
      autoCheckinStartTimer.unref?.();
    }
    autoCheckinTimer = setInterval(
      () => void runScheduledCheckin("scheduled"),
      config.checkin.intervalMinutes * 60 * 1000,
    );
    autoCheckinTimer.unref?.();
  }

  /**
   * Adopts the account that is already signed in, the first time TRAE becomes
   * reachable.
   *
   * The panel opens on a list, never on a live lookup, so this used to happen
   * only inside the panel's own open flow — one attempt, no retry, and a failure
   * that looked exactly like "no accounts saved yet". Doing it here removes the
   * dependence on the moment the panel happened to be opened, and keeps the panel
   * a pure view instead of giving it a retry loop.
   */
  async function adoptCurrentAccount() {
    if (adoptAttempted) return;
    adoptAttempted = true;
    try {
      if ((await accountStore.list()).length) return;
      const storageRoot = await readJsonFile(STORAGE_PATH);
      const active = await accountStore.resolveActiveAccount(storageRoot);
      if (active.state !== "not-managed") {
        // `unknown` means the live identity could not be read at all. TRAE may
        // simply not be signed in yet, which is not a failure worth a stack trace.
        console.log(`[adopt] no account adopted (state=${active.state})`);
        return;
      }
      const liveIdentity = await cdpClient.getLiveIdentity();
      const result = await accountStore.backupCurrent(storageRoot, { liveIdentity });
      console.log(`[adopt] adopted the signed-in account (created=${result.createdSnapshot})`);
      await notifyAccountsUpdated(cdpClient);
    } catch (error) {
      console.error(`[adopt] could not adopt the current account: ${error.message || error}`);
    }
  }

  /** The client-load trigger, the equivalent of one run per page navigation. */
  async function runClientLoadCheckin() {
    try {
      const config = await loadAppConfig(DATA_DIR);
      if (!config.checkin.auto || !config.checkin.onClientLoad) return;
      await runScheduledCheckin("client-load");
    } catch (error) {
      console.error(`[checkin] client-load run failed: ${error.message || error}`);
    }
  }

  const cdpClient = new CdpClient({
    port: CDP_PORT,
    getInjectScript: () => buildInjectScript(apiToken, seaApi),
    onStateChange: (connected) => {
      cdpConnected = connected;
      if (!connected) {
        clientLoadCheckinDone = false;
        return;
      }
      if (clientLoadCheckinDone) return;
      clientLoadCheckinDone = true;
      // This callback is synchronous, and awaiting here would stall the CDP
      // client's own state handling.
      void adoptCurrentAccount();
      void runClientLoadCheckin();
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

  // TRAE's auto-update is switched off here rather than lazily, so the panel can
  // report the real result the moment it opens. A silent failure would look exactly
  // like a setting that was applied.
  try {
    const config = await loadAppConfig(DATA_DIR);
    const { result, state } = await syncTraeUpdateSetting({
      suppress: config.traeUpdate.suppress,
      previousMode: config.traeUpdate.previousMode,
    });
    traeUpdateStartupNotice = result.changed
      ? { mode: state.mode, path: state.path, suppress: config.traeUpdate.suppress }
      : null;
    console.log(
      `[trae-update] suppress=${config.traeUpdate.suppress} file=${state.mode ?? "(未设置)"} changed=${result.changed}`,
    );
  } catch (error) {
    traeUpdateStartupError = error?.message || String(error);
    console.error(`[trae-update] TRAE 设置文件无法读写：${traeUpdateStartupError}`);
  }

  // Assigned before the loop below and long before the first request in practice:
  // anything arriving in between would still be picked up, because the start-up
  // schedule reads the configuration as it is at that moment.
  rescheduleAutoCheckin = scheduleAutoCheckin;
  await scheduleAutoCheckin({ initialRun: true });

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
        const cockpit = await resolveCockpitPolicy();
        if (cockpit.action !== "run") {
          console.log(
            `[keepalive] skipped because ${
              cockpit.action === "skip"
                ? "Cockpit Tools is running"
                : "the Cockpit Tools state could not be determined"
            }`,
          );
          return;
        }
        const result = await runAccountKeepalive(null, {
          force: false,
          reason: "scheduled",
        });
        console.log(
          `[keepalive] refreshed=${result.refreshed} skipped=${result.skipped} failed=${result.failed}`,
        );
        await notifyAccountsUpdated(cdpClient);
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
    // The panel holds a keep-alive connection, which would keep `server.close()`
    // pending and leave the port bound. A restart has to release it promptly,
    // otherwise the replacement daemon that is already waiting cannot listen.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  }

  daemonShutdown = shutdown;
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
