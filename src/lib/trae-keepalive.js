export const DEFAULT_KEEPALIVE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_ACCESS_TOKEN_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REFRESH_TOKEN_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export function parseDuration(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isKeepaliveDue(record, {
  now = Date.now(),
  intervalMs = DEFAULT_KEEPALIVE_INTERVAL_MS,
  retryIntervalMs = DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS,
} = {}) {
  const updatedAt = Date.parse(record?.keepalive?.updatedAt || "");
  if (!Number.isFinite(updatedAt)) return true;
  const elapsed = Math.max(now - updatedAt, 0);
  const wait = record?.keepalive?.status === "error" ? retryIntervalMs : intervalMs;
  return elapsed >= wait;
}

/**
 * Accepts a Unix timestamp in seconds or milliseconds, or an ISO string.
 * Returns milliseconds, or null when the value cannot be interpreted.
 */
export function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value < 1e11 ? value * 1000 : value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Credential rotation is expiry-driven: the access token decides when we must
 * exchange, and the refresh token is only a long-stop guard against the
 * half-year credential lapsing. Missing fields rotate conservatively.
 *
 * A `refreshExpiredAt` equal to the access expiry means the writer fell back to
 * it (see `trae-refresh.js`), so the guard is skipped instead of reading as
 * permanently due.
 */
export function shouldRotateCredentials(
  auth,
  {
    now = Date.now(),
    accessThresholdMs = DEFAULT_ACCESS_TOKEN_THRESHOLD_MS,
    refreshThresholdMs = DEFAULT_REFRESH_TOKEN_THRESHOLD_MS,
  } = {},
) {
  const accessExpiresAt = toMillis(auth?.expiredAt ?? auth?.expiresAt);
  if (accessExpiresAt === null) return true;
  const refreshExpiresAt = toMillis(auth?.refreshExpiredAt);
  if (
    refreshExpiresAt !== null &&
    refreshExpiresAt !== accessExpiresAt &&
    refreshExpiresAt - now < refreshThresholdMs
  ) {
    return true;
  }
  return accessExpiresAt - now < accessThresholdMs;
}
