/**
 * Direct network diagnostics and secret-safe error formatting.
 *
 * The release build deliberately has no proxy configuration. This module only
 * performs direct DNS/HTTPS probes and removes secret query values before text
 * can reach a log or report.
 */
import dns from "node:dns/promises";

const SECRET_QUERY = /([?&](?:did|token|access_token|refresh_token|code|password|secret|apikey|api_key|key)=)[^&\s"']+/gi;

/** Environment variables that could make a child inherit an ambient proxy. */
const PROXY_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
];

export function redactQueryValues(text) {
  if (typeof text !== "string") return "";
  return text.replace(SECRET_QUERY, "$1<redacted>");
}

export function redactUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "<redacted>");
    return url.toString();
  } catch {
    return redactQueryValues(String(value));
  }
}

function causeFields(error) {
  const fields = [];
  if (typeof error?.code === "string") fields.push(error.code);
  else if (typeof error?.errno !== "undefined" && error.errno !== null) fields.push(String(error.errno));
  if (typeof error?.syscall === "string" && !fields.includes(error.syscall)) fields.push(error.syscall);
  if (typeof error?.hostname === "string") fields.push(error.hostname);
  if (typeof error?.address === "string") {
    fields.push(error.port ? `${error.address}:${error.port}` : error.address);
  }
  return fields;
}

export function describeErrorChain(error, { maxDepth = 4 } = {}) {
  if (!error) return "unknown error";
  const parts = [];
  const seen = new Set();
  let current = error;
  for (let depth = 0; depth < maxDepth && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const fields = causeFields(current);
    const message = typeof current.message === "string" ? current.message.trim() : "";
    const segment = [message, ...fields].filter(Boolean).join(" | ");
    if (segment && !parts.includes(segment)) parts.push(segment);
    current = current.cause;
  }
  return redactQueryValues(parts.join(" → ") || String(error));
}

/**
 * Removes inherited proxy controls before spawning a child that should use a
 * direct connection. The release build does not expose proxy configuration.
 */
export function stripProxyEnv(env = process.env) {
  const next = { ...env };
  delete next.NODE_USE_ENV_PROXY;
  for (const name of PROXY_NAMES) delete next[name];
  return next;
}

export async function probeHost(hostname, { path: targetPath = "/", timeoutMs = 10000 } = {}) {
  const result = {
    host: hostname,
    addresses: [],
    dnsError: null,
    httpStatus: null,
    error: null,
  };

  try {
    const records = await dns.lookup(hostname, { all: true });
    result.addresses = records.map((record) => `${record.address} (IPv${record.family})`);
  } catch (error) {
    result.dnsError = describeErrorChain(error);
  }

  try {
    const response = await fetch(`https://${hostname}${targetPath}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    result.httpStatus = response.status;
  } catch (error) {
    result.error = describeErrorChain(error);
  }
  return result;
}

export async function probeHosts(hosts, options = {}) {
  const results = [];
  for (const host of hosts) results.push(await probeHost(host, options));
  return results;
}

export const STATIC_HOSTS = ["api.trae.cn", "api.trae.com.cn", "www.trae.cn"];

const MAX_LISTED_ADDRESSES = 3;

function summarizeAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return "";
  const shown = addresses.slice(0, MAX_LISTED_ADDRESSES).join(", ");
  const rest = addresses.length - MAX_LISTED_ADDRESSES;
  return rest > 0 ? `${shown}, +${rest} 个` : shown;
}

export function formatProbeLine(result) {
  if (Number.isInteger(result.httpStatus)) {
    const dns = result.dnsError
      ? `本地 DNS 失败：${result.dnsError}`
      : `DNS ${summarizeAddresses(result.addresses)}`;
    return `${result.host}: 可达，HTTP ${result.httpStatus}（${dns}）`;
  }
  if (result.dnsError) return `${result.host}: DNS 失败 → ${result.dnsError}`;
  if (result.error) return `${result.host}: 连接失败 → ${result.error}`;
  return `${result.host}: 未知状态`;
}

export function probeSucceeded(result) {
  return Boolean(result) && result.error === null && Number.isInteger(result.httpStatus);
}
