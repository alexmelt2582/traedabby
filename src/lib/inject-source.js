/**
 * Loads the renderer injection source.
 *
 * In source mode the script is read from disk. In a single-executable build the
 * source is embedded as a SEA asset, so `loadInjectSource` must not depend on
 * the file system being present next to the executable.
 */
import { readTextFile } from "./json-file.js";

export const INJECT_SOURCE_ASSET_KEY = "inject.js";

export function renderInjectScript(source, { apiBase, apiToken, appVersion }) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("The injection source is empty");
  }
  return source
    .replaceAll("__API_BASE__", String(apiBase ?? ""))
    .replaceAll("__API_TOKEN__", String(apiToken ?? ""))
    .replaceAll("__APP_VERSION__", String(appVersion ?? ""));
}

export async function detectSeaApi() {
  try {
    const sea = await import("node:sea");
    const inSea = typeof sea.isSea === "function" && sea.isSea() === true;
    return { inSea, getAsset: typeof sea.getAsset === "function" ? sea.getAsset : null };
  } catch {
    return { inSea: false, getAsset: null };
  }
}

export async function loadInjectSource({
  fallbackPath,
  assetKey = INJECT_SOURCE_ASSET_KEY,
  seaApi,
}) {
  const sea = seaApi ?? (await detectSeaApi());
  if (sea.inSea) {
    if (!sea.getAsset) throw new Error("This build is a single executable but exposes no SEA assets");
    try {
      return sea.getAsset(assetKey, "utf8");
    } catch (error) {
      throw new Error(`The embedded injection source "${assetKey}" is missing: ${error.message}`);
    }
  }
  if (!fallbackPath) throw new Error("No injection source path was provided for source mode");
  return await readTextFile(fallbackPath);
}
