export const DEFAULT_KEEPALIVE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_KEEPALIVE_RETRY_INTERVAL_MS = 30 * 60 * 1000;

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
