const AUTH_PREFIX = "iCubeAuthInfo://";
const SERVER_PREFIX = "iCubeServerData://";
const ENTITLEMENT_PREFIX = "iCubeEntitlementInfo://";
const DEVICE_PREFIX = "iCubeAuthInfo://icube-dc:";
const USERTAG_KEY = "iCubeAuthInfo://usertag";

const IDENTITY_KEYS = new Set([
  "userid",
  "user_id",
  "uid",
  "accountid",
  "account_id",
]);
const EMAIL_KEYS = new Set(["email", "nonplaintextemail", "mail"]);
const PHONE_KEYS = new Set(["phone", "mobile", "phonenumber", "nonplaintextmobile"]);
const NAME_KEYS = new Set(["nickname", "displayname", "username", "screenname"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeKey(value) {
  return String(value || "").replace(/[-_\s]/g, "").toLowerCase();
}

function parseJsonString(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  try {
    return parseIcubesValue(text);
  } catch {
    return value;
  }
}

function isDeviceKey(key) {
  return key.startsWith(DEVICE_PREFIX);
}

function isUserAuthKey(key) {
  return key.startsWith(AUTH_PREFIX) && !isDeviceKey(key) && key !== USERTAG_KEY;
}

export function extractAuthSnapshot(storageRoot, { capturedAt = Date.now() } = {}) {
  if (!isObject(storageRoot)) {
    throw new Error("TRAE storage.json must contain a JSON object");
  }

  const keys = {};
  for (const [key, value] of Object.entries(storageRoot)) {
    if (
      isUserAuthKey(key) ||
      isDeviceKey(key) ||
      key === USERTAG_KEY ||
      key.startsWith(SERVER_PREFIX) ||
      key.startsWith(ENTITLEMENT_PREFIX)
    ) {
      keys[key] = value;
    }
  }

  const snapshot = {
    schemaVersion: 1,
    platform: "trae_solo_cn",
    capturedAt,
    keys,
  };
  validateAuthSnapshot(snapshot);
  return snapshot;
}

export function validateAuthSnapshot(snapshot) {
  if (!isObject(snapshot) || snapshot.schemaVersion !== 1 || !isObject(snapshot.keys)) {
    throw new Error("Invalid TRAE authentication snapshot");
  }

  const keys = Object.keys(snapshot.keys);
  const hasUserAuth = keys.some(isUserAuthKey);
  const hasDevice = keys.some(isDeviceKey);
  const hasServer = keys.some((key) => key.startsWith(SERVER_PREFIX));
  const hasEntitlement = keys.some((key) => key.startsWith(ENTITLEMENT_PREFIX));
  const hasUsertag = Object.hasOwn(snapshot.keys, USERTAG_KEY);

  const missing = [];
  if (!hasUserAuth) missing.push("user authentication");
  if (!hasDevice) missing.push("device key");
  if (!hasServer) missing.push("server data");
  if (!hasEntitlement) missing.push("entitlement data");
  if (!hasUsertag) missing.push("usertag");
  if (missing.length) {
    throw new Error(`Incomplete TRAE authentication state: missing ${missing.join(", ")}`);
  }

  return true;
}

function collectIdentityCandidates(root) {
  const candidates = [];

  function visit(value, pathParts, depth) {
    if (depth > 10 || value === null || value === undefined) return;
    const parsed = parseJsonString(value);
    if (parsed !== value) {
      visit(parsed, pathParts, depth + 1);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, String(index)], depth + 1));
      return;
    }
    if (!isObject(value)) return;

    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...pathParts, key];
      const normalized = normalizeKey(key);
      if (IDENTITY_KEYS.has(normalized)) {
        const text = normalizeText(child);
        if (text && /^\d{6,24}$/.test(text)) {
          candidates.push({ kind: "userId", value: text, path: nextPath.join(".") });
        }
      } else if (EMAIL_KEYS.has(normalized)) {
        const text = normalizeText(child);
        if (text && text.includes("@")) {
          candidates.push({ kind: "email", value: text.toLowerCase(), path: nextPath.join(".") });
        }
      } else if (PHONE_KEYS.has(normalized)) {
        const text = normalizeText(child);
        if (text) candidates.push({ kind: "phone", value: text, path: nextPath.join(".") });
      } else if (NAME_KEYS.has(normalized)) {
        const text = normalizeText(child);
        if (text) candidates.push({ kind: "nickname", value: text, path: nextPath.join(".") });
      }
      visit(child, nextPath, depth + 1);
    }
  }

  visit(root, [], 0);
  return candidates;
}

function pickIdentityCandidate(candidates, kind, pathHint) {
  const matching = candidates.filter((candidate) => candidate.kind === kind);
  if (!matching.length) return null;
  if (pathHint) {
    const hinted = matching.find((candidate) => candidate.path.toLowerCase().includes(pathHint));
    if (hinted) return hinted.value;
  }
  return matching[0].value;
}

export function extractIdentityFromSnapshot(snapshot) {
  const roots = Object.entries(snapshot.keys)
    .filter(
      ([key]) =>
        key.startsWith(SERVER_PREFIX) ||
        key.startsWith(ENTITLEMENT_PREFIX) ||
        isUserAuthKey(key),
    )
    .map(([, value]) => value);

  const candidates = roots.flatMap(collectIdentityCandidates);
  const userId =
    pickIdentityCandidate(candidates, "userId", "entitlementbaseinfo") ||
    pickIdentityCandidate(candidates, "userId", "account") ||
    pickIdentityCandidate(candidates, "userId");

  return {
    userId,
    email: pickIdentityCandidate(candidates, "email"),
    phone: pickIdentityCandidate(candidates, "phone"),
    nickname: pickIdentityCandidate(candidates, "nickname"),
  };
}

export function mergeIdentity(primary, fallback) {
  const result = {};
  for (const key of ["userId", "email", "phone", "nickname"]) {
    result[key] = normalizeText(primary?.[key]) || normalizeText(fallback?.[key]) || null;
  }
  return result;
}

export function maskAccountValue(value, { visible = 4 } = {}) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.includes("@")) {
    const [name, domain] = text.split("@");
    const prefix = name.slice(0, Math.min(2, name.length));
    return `${prefix}***@${domain}`;
  }
  if (text.length <= visible) return "*".repeat(text.length);
  return `${"*".repeat(Math.max(4, text.length - visible))}${text.slice(-visible)}`;
}

export const traeStorageKeys = Object.freeze({
  AUTH_PREFIX,
  SERVER_PREFIX,
  ENTITLEMENT_PREFIX,
  DEVICE_PREFIX,
  USERTAG_KEY,
});
import { parseIcubesValue } from "./trae-crypto.js";

