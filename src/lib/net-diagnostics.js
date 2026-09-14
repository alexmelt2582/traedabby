/**
 * Diagnostics for network failures and for anything that must not leak secrets
 * into logs or reports.
 *
 * Node hides the real reason for a transport failure in `error.cause`, so the
 * default `error.message` is only ever the useless string "fetch failed". Every
 * helper here exists to turn that back into an actionable code such as
 * `ECONNREFUSED`, `ENOTFOUND` or a certificate error.
 */
import dns from "node:dns/promises";

/** Query parameters whose values must never be printed. */
const SECRET_QUERY = /([?&](?:did|token|access_token|refresh_token|code|password|secret|apikey|api_key|key)=)[^&\s"']+/gi;

/** Proxy variables that Node's `--use-env-proxy` understands. */
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

/**
 * The URL with every query value removed, safe to print or log.
 */
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

/**
 * Walks the whole `cause` chain and returns one compact line, for example
 * `fetch failed | ECONNREFUSED | connect ECONNREFUSED 127.0.0.1:9`.
 */
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
  const text = parts.join(" → ") || String(error);
  return redactQueryValues(text);
}

/**
 * Reports whether proxy variables are present without ever revealing their
 * values: a proxy URL may embed credentials.
 */
export function proxyEnvReport(env = process.env) {
  const report = [];
  const seen = new Set();
  for (const name of PROXY_NAMES) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const value = env?.[name];
    report.push({
      name,
      set: typeof value === "string" && value.trim().length > 0,
    });
  }
  return report;
}

/** Whether this process was started with environment proxy support. */
export function proxyEnvEnabled(env = process.env) {
  const value = env?.NODE_USE_ENV_PROXY;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function anyProxyConfigured(env = process.env) {
  return proxyEnvReport(env).some((entry) => entry.set && !entry.name.toLowerCase().startsWith("no_proxy"));
}

/**
 * DNS, then an HTTPS request. A failure at either step is reported with its full
 * cause chain instead of being swallowed.
 */
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
  for (const host of hosts) {
    results.push(await probeHost(host, options));
  }
  return results;
}

/** Hosts this project needs, independent of any account. */
export const STATIC_HOSTS = ["api.trae.cn", "api.trae.com.cn", "www.trae.cn"];

const LOOPBACK_NO_PROXY = ["127.0.0.1", "localhost", "::1"];

/**
 * Loopback must never be sent through a proxy. Our own service, the supervisor
 * and the CDP endpoint are all local, and routing them through a proxy would
 * break the parts that currently work.
 */
export function ensureLocalNoProxy(existing) {
  const entries = typeof existing === "string"
    ? existing.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];
  for (const entry of LOOPBACK_NO_PROXY) {
    if (!entries.includes(entry)) entries.push(entry);
  }
  return entries.join(",");
}

/**
 * Environment for a child process that talks to the network.
 *
 * `NODE_USE_ENV_PROXY` is only read when Node starts, so it cannot be enabled by
 * mutating `process.env` at runtime: it has to be present in the spawn
 * environment of every process that performs fetches.
 */
export function proxyChildEnv({ useEnvProxy = false, env = process.env } = {}) {
  const next = { ...env };
  if (!useEnvProxy) return next;
  next.NODE_USE_ENV_PROXY = "1";
  next.NO_PROXY = ensureLocalNoProxy(env.NO_PROXY ?? env.no_proxy);
  return next;
}

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
