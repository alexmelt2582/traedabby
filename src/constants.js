import path from "node:path";

import { APP_ROOT } from "./lib/app-paths.js";

export const APP_NAME = "TRAE SOLO CN Enhancer";
export const APP_VERSION = "1.1.1";
export const PROJECT_ROOT = APP_ROOT;

export const DEFAULT_CDP_PORT = 9334;
export const DEFAULT_UI_PORT = 47834;
export const LOOPBACK_HOST = "127.0.0.1";

export const DEFAULT_TRAE_EXE =
  process.env.TRAE_ENHANCER_TRAE_EXE ||
  path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"),
    "Programs",
    "TRAE SOLO CN",
    "TRAE SOLO CN.exe",
  );

export const DEFAULT_TRAE_USER_DATA_DIR =
  process.env.TRAE_ENHANCER_USER_DATA_DIR ||
  path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
    "TRAE SOLO CN",
  );

export const DEFAULT_STORAGE_PATH = path.join(
  DEFAULT_TRAE_USER_DATA_DIR,
  "User",
  "globalStorage",
  "storage.json",
);

export const DEFAULT_DATA_DIR =
  process.env.TRAE_ENHANCER_DATA_DIR || path.join(PROJECT_ROOT, "data");

export function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}
