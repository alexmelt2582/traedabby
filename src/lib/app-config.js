/**
 * User-level configuration for this installation.
 *
 * It lives next to the executable (inside the resolved data directory) so that
 * a portable copy carries its own settings and never borrows another copy's.
 *
 * Validation is strict and rejects malformed values instead of silently falling
 * back, because a wrong TRAE path would otherwise only surface much later as an
 * unexplained failure during a switch.
 */
import path from "node:path";

import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import { proxyHasCredentials } from "./system-proxy.js";
import { TRAE_UPDATE_MODES } from "./trae-settings.js";

export const CONFIG_FILE_NAME = "config.json";

export function configPath(dataDir) {
  return path.join(dataDir, CONFIG_FILE_NAME);
}

export function normalizeTraeExe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("config.traeExe must be a string or null");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0")) throw new Error("config.traeExe contains a null byte");
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`config.traeExe must be an absolute path, got ${JSON.stringify(trimmed)}`);
  }
  if (path.extname(trimmed).toLowerCase() !== ".exe") {
    throw new Error(`config.traeExe must point to an .exe, got ${JSON.stringify(trimmed)}`);
  }
  return path.normalize(trimmed);
}

export const TRUE_WORDS = new Set(["1", "true", "yes", "on"]);
export const FALSE_WORDS = new Set(["0", "false", "no", "off", ""]);

export function normalizeUseEnvProxy(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_WORDS.has(normalized)) return true;
    if (FALSE_WORDS.has(normalized)) return false;
  }
  throw new Error(`config.useEnvProxy must be a boolean, got ${JSON.stringify(value)}`);
}

/**
 * How the daemon reaches the network.
 *
 * - `system` — follow the Windows system proxy. The default, and the only mode
 *   that works on an intranet machine where TRAE itself already follows it.
 *   On a machine with no system proxy configured this resolves to nothing, so it
 *   behaves exactly like `off` and cannot break a direct connection.
 * - `manual` — one proxy URL supplied by the user.
 * - `env`    — read `HTTP_PROXY`/`HTTPS_PROXY` from the environment. Kept for
 *   compatibility with v1.0.0's boolean `useEnvProxy` flag.
 * - `off`    — never use a proxy.
 */
export const PROXY_MODES = ["system", "manual", "env", "off"];

export function normalizeProxyMode(value) {
  if (value === null || value === undefined || value === "") return "system";
  if (typeof value !== "string") {
    throw new Error(`config.proxy.mode must be a string, got ${JSON.stringify(value)}`);
  }
  const normalized = value.trim().toLowerCase();
  if (PROXY_MODES.includes(normalized)) return normalized;
  throw new Error(
    `config.proxy.mode must be one of ${PROXY_MODES.join(", ")}, got ${JSON.stringify(value)}`,
  );
}

/**
 * A proxy URL is stored without credentials on purpose: this file is plain JSON
 * on disk, so a password written here would be an unencrypted secret. A proxy
 * that requires authentication has to be configured as the Windows system proxy
 * instead, where the operating system holds the credentials.
 */
export function normalizeProxyUrl(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`config.proxy.url must be a string or null, got ${JSON.stringify(value)}`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0")) throw new Error("config.proxy.url contains a null byte");
  if (proxyHasCredentials(trimmed)) {
    throw new Error(
      "config.proxy.url must not embed a username or password; configure the proxy as the Windows system proxy instead, or use the system mode",
    );
  }

  // A bare `host:port` is accepted and normalized, because that is the shape the
  // Windows registry stores and users usually paste.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`config.proxy.url is not a valid URL, got ${JSON.stringify(trimmed)}`);
  }
  if (!parsed.hostname) {
    throw new Error(`config.proxy.url has no host, got ${JSON.stringify(trimmed)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `config.proxy.url must use http or https, got ${JSON.stringify(parsed.protocol)}`,
    );
  }
  return candidate;
}

export function normalizeProxyNoProxy(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error(`config.proxy.noProxy must be a string, got ${JSON.stringify(value)}`);
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(",");
}

export function normalizeProxyConfig(raw, legacyUseEnvProxy) {
  if (raw === null || raw === undefined) {
    // v1.0.0 stored a single boolean. `true` meant "take the proxy from the
    // environment", which is exactly the `env` mode.
    const legacy =
      legacyUseEnvProxy === undefined ? null : normalizeUseEnvProxy(legacyUseEnvProxy);
    return {
      mode: legacy === true ? "env" : "system",
      url: null,
      noProxy: "",
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config.proxy must be a JSON object");
  }
  const mode = normalizeProxyMode(raw.mode);
  const url = normalizeProxyUrl(raw.url);
  if (mode === "manual" && !url) {
    throw new Error('config.proxy.url is required when config.proxy.mode is "manual"');
  }
  return { mode, url, noProxy: normalizeProxyNoProxy(raw.noProxy) };
}

/**
 * Whether TRAE's own updater should stay switched off, and what the setting read
 * before this project changed it.
 *
 * `previousMode` exists so "允许自动更新" can put back what the user had instead of
 * assuming there was nothing. Null means the entry was absent, which TRAE treats
 * as its own default.
 */
export function normalizeTraeUpdate(raw) {
  if (raw === null || raw === undefined) return { suppress: true, previousMode: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config.traeUpdate must be a JSON object");
  }
  let suppress = true;
  if (raw.suppress !== null && raw.suppress !== undefined) {
    if (typeof raw.suppress === "boolean") suppress = raw.suppress;
    else if (typeof raw.suppress === "string") {
      const normalized = raw.suppress.trim().toLowerCase();
      if (TRUE_WORDS.has(normalized)) suppress = true;
      else if (FALSE_WORDS.has(normalized)) suppress = false;
      else throw new Error(`config.traeUpdate.suppress must be a boolean, got ${JSON.stringify(raw.suppress)}`);
    } else {
      throw new Error(`config.traeUpdate.suppress must be a boolean, got ${JSON.stringify(raw.suppress)}`);
    }
  }

  let previousMode = null;
  if (raw.previousMode !== null && raw.previousMode !== undefined) {
    if (typeof raw.previousMode !== "string" || !TRAE_UPDATE_MODES.includes(raw.previousMode)) {
      throw new Error(
        `config.traeUpdate.previousMode must be one of ${TRAE_UPDATE_MODES.join(", ")}, got ${JSON.stringify(raw.previousMode)}`,
      );
    }
    previousMode = raw.previousMode;
  }
  return { suppress, previousMode };
}

export function normalizeConfig(raw) {
  if (raw === null || raw === undefined) {
    return {
      traeExe: null,
      proxy: { mode: "system", url: null, noProxy: "" },
      traeUpdate: { suppress: true, previousMode: null },
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("the configuration file must contain a JSON object");
  }
  return {
    traeExe: normalizeTraeExe(raw.traeExe),
    proxy: normalizeProxyConfig(raw.proxy, raw.useEnvProxy),
    traeUpdate: normalizeTraeUpdate(raw.traeUpdate),
  };
}

export async function loadAppConfig(dataDir) {
  const raw = await readJsonFile(configPath(dataDir), { required: false });
  return normalizeConfig(raw);
}

export async function saveAppConfig(dataDir, patch) {
  const current = await loadAppConfig(dataDir);
  const next = normalizeConfig({ ...current, ...patch });
  await writeJsonAtomic(configPath(dataDir), next, { mode: 0o600 });
  return next;
}
