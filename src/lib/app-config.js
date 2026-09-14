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

export function normalizeConfig(raw) {
  if (raw === null || raw === undefined) return { traeExe: null, useEnvProxy: false };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("the configuration file must contain a JSON object");
  }
  return {
    traeExe: normalizeTraeExe(raw.traeExe),
    useEnvProxy: normalizeUseEnvProxy(raw.useEnvProxy),
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
