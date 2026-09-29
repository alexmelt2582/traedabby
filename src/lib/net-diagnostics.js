/**
 * Network diagnostics and secret-safe error formatting.
 *
 * Two jobs: probe a host through a chosen dispatcher (direct, or through the
 * configured proxy) and turn the raw `cause` chain into a reason a non-technical
 * user can act on. It also removes secret query values before text can reach a
 * log or report.
 */
import dns from "node:dns/promises";
import { fetch as undiciFetch } from "undici";

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
 * Removes inherited proxy controls before spawning a child.
 *
 * The proxy for this process now comes from `proxy-runtime`, which decides per
 * request and per exception list. An ambient `HTTP_PROXY` inherited by a child
 * would be a second, invisible proxy decision that no part of the panel can
 * explain or turn off, so it is always stripped.
 */
export function stripProxyEnv(env = process.env) {
  const next = { ...env };
  delete next.NODE_USE_ENV_PROXY;
  for (const name of PROXY_NAMES) delete next[name];
  return next;
}

/**
 * DNS, then an HTTPS request through `dispatcher` (null = direct).
 *
 * A failure at either step is reported with its full cause chain instead of
 * being swallowed, because a probe that only says "unreachable" cannot tell an
 * intranet user what to do next.
 */
export async function probeHost(
  hostname,
  { path: targetPath = "/", timeoutMs = 10000, dispatcher = null } = {},
) {
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
    const response = await undiciFetch(`https://${hostname}${targetPath}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      ...(dispatcher ? { dispatcher } : {}),
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

/* -------------------------------------------------------------------------- *
 * Failure classification
 *
 * A probe that only ever says "unreachable" cannot tell an intranet user what to
 * do next, and a wrong hint is worse than none: a certificate rejection used to
 * be reported as "check the proxy address", sending people to re-check a value
 * that was already correct.
 * -------------------------------------------------------------------------- */

/** TLS failures that mean the chain was rejected, not that nothing answered. */
const CERTIFICATE_FAILURES = [
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
];

/** Most specific first: a certificate rejection proves something answered. */
export const FAILURE_PRIORITY = ["certificate", "auth", "refused", "dns", "timeout", "other"];

/**
 * One keyword for a formatted error chain, or null when there is nothing to
 * explain. `text` is `describeErrorChain` output, not a raw Error.
 */
export function classifyProbeFailure(text) {
  if (typeof text !== "string" || !text) return null;
  const upper = text.toUpperCase();
  if (CERTIFICATE_FAILURES.some((code) => upper.includes(code))) return "certificate";
  if (upper.includes("407") || upper.includes("PROXY AUTHENTICATION REQUIRED")) return "auth";
  if (upper.includes("AUTH_FAILED") || upper.includes("AUTHENTICATION FAILED")) return "auth";
  if (upper.includes("ECONNREFUSED")) return "refused";
  if (upper.includes("ENOTFOUND") || upper.includes("EAI_AGAIN")) return "dns";
  if (upper.includes("TIMEOUT") || upper.includes("ETIMEDOUT")) return "timeout";
  return "other";
}

/** The most informative failure across every host of one probe run. */
export function summarizeProbeFailure(results) {
  const seen = new Set();
  for (const result of results ?? []) {
    const kind = classifyProbeFailure(result?.error);
    if (kind) seen.add(kind);
  }
  return FAILURE_PRIORITY.find((kind) => seen.has(kind)) ?? null;
}

/** A run of probes counts as reachable when at least one host answered. */
export function probeRunReachable(results) {
  return (results ?? []).some((result) => probeSucceeded(result));
}

const THROUGH_PROXY_TEXT = {
  certificate: {
    severity: "error",
    text: "代理已连上，但本机不信任对方使用的证书。助手默认会信任 Windows 证书存储里的证书，仍报这个错说明那张根证书没有装进系统。请把高级信息里的详情发给排查方。",
  },
  auth: { severity: "hint", text: "代理需要认证，请填写账号密码。" },
  refused: { severity: "hint", text: "连接被拒绝，请确认代理已启动、地址端口正确。" },
  dns: { severity: "hint", text: "无法解析代理地址，请检查地址是否写对。" },
  timeout: { severity: "hint", text: "连接超时，请确认代理地址和端口是否正确、代理是否已启动。" },
  other: { severity: "error", text: "走代理连接不上，请把高级信息里的详情发给排查方。" },
};

const DIRECT_TEXT = {
  certificate: {
    severity: "error",
    text: "连接在证书校验这一步失败，本机不信任对方使用的证书。请把高级信息里的详情发给排查方。",
  },
  refused: {
    severity: "hint",
    text: "直连被拒绝。若本机在公司内网，通常需要走代理，请改用「使用系统代理」或填写代理地址。",
  },
  dns: { severity: "hint", text: "域名解析失败，请检查本机的 DNS 设置。" },
  timeout: {
    severity: "hint",
    text: "连接超时。若本机在公司内网，通常是因为需要走代理，请改用「使用系统代理」或填写代理地址。",
  },
  other: { severity: "error", text: "连接不上，请把高级信息里的详情发给排查方。" },
};

/**
 * Turns two probe runs into the one sentence the panel shows.
 *
 * `proxied` is null when no proxy run happened (mode `off`, or the address was
 * incomplete), in which case only the direct verdict is meaningful.
 */
export function describeProxyTestVerdict({ direct, proxied } = {}) {
  const directOk = probeRunReachable(direct);
  const proxiedOk = proxied ? probeRunReachable(proxied) : false;

  if (!proxied) {
    if (directOk) {
      return { conclusion: "direct", severity: "ok", text: "直连正常，当前未使用代理。" };
    }
    const kind = summarizeProbeFailure(direct) ?? "other";
    const entry = DIRECT_TEXT[kind] ?? DIRECT_TEXT.other;
    return { conclusion: kind, severity: entry.severity, text: entry.text };
  }

  if (directOk && proxiedOk) {
    return {
      conclusion: "both",
      severity: "ok",
      text: "直连和这个代理都能连通。当前网络不需要代理。",
    };
  }
  if (!directOk && proxiedOk) {
    return {
      conclusion: "proxy",
      severity: "ok",
      text: "直连失败，但走该代理可以连通：建议保存并启用。",
    };
  }
  if (directOk && !proxiedOk) {
    const kind = summarizeProbeFailure(proxied) ?? "other";
    const entry = THROUGH_PROXY_TEXT[kind] ?? THROUGH_PROXY_TEXT.other;
    return { conclusion: kind, severity: entry.severity, text: entry.text };
  }
  const kind = summarizeProbeFailure(proxied) ?? summarizeProbeFailure(direct) ?? "other";
  const entry = THROUGH_PROXY_TEXT[kind] ?? THROUGH_PROXY_TEXT.other;
  return { conclusion: kind, severity: entry.severity, text: entry.text };
}
