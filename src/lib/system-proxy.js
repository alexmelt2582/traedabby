/**
 * Reads the Windows system proxy so the assistant can follow it.
 *
 * TRAE renders with Chromium and therefore honours the WinINET proxy settings that
 * live in the registry. Node's `fetch` does not: it only reads
 * `HTTP_PROXY`/`HTTPS_PROXY` when `NODE_USE_ENV_PROXY` is enabled, and those
 * variables are usually absent even on a machine that has a system proxy
 * configured. That mismatch is precisely what produced "TRAE works, the assistant
 * cannot reach api.trae.cn" on the intranet machine.
 *
 * The registry is read through PowerShell rather than `reg.exe`, because
 * `reg.exe` is blocked by security policy on some managed machines.
 *
 * Nothing here is ever written to disk. A proxy URL may embed credentials, so
 * every value is redacted before it can reach a report or a log.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Protocol keys WinINET stores in `ProxyServer`. */
const PROXY_KEYS = ["http", "https", "ftp", "socks", "socks5"];

/**
 * Replaces the password in a proxy URL with `<redacted>`.
 *
 * Both `scheme://user:pass@host` and a bare `user:pass@host` are handled, because
 * the manual field accepts the bare form before it is normalized. The user part is
 * kept: knowing which account is configured is useful, the secret is not.
 */
export function redactProxyUrl(value) {
  const text = String(value ?? "");
  if (!text) return "";
  return text.replace(
    /(^|\/\/)([^/@\s:]+):([^/@\s]*)@/g,
    (match, prefix, user) => `${prefix}${user}:<redacted>@`,
  );
}

/**
 * Whether a proxy value carries a password.
 *
 * The bare form has to be matched too: `user:pass@host:port` is normalized into
 * `http://user:pass@host:port`, so a check that only looked for `//` would let a
 * secret through into `config.json`.
 */
export function proxyHasCredentials(value) {
  return /(^|\/\/)[^/@\s:]+:[^/@\s]*@/.test(String(value ?? ""));
}

/**
 * Whether Node's environment-proxy support can actually use this value.
 *
 * It understands `http:` and `https:` only. A SOCKS value is not merely ignored:
 * undici's `EnvHttpProxyAgent` throws `InvalidArgumentError` from
 * `pre_execution`, so the daemon dies during startup with an error that never
 * mentions the proxy configuration. Every path that produces proxy variables
 * therefore has to reject it up front.
 *
 * A bare `host:port` has no scheme and is accepted; callers prepend `http://`.
 */
export function proxySchemeSupported(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (!match) return true;
  const scheme = match[1].toLowerCase();
  return scheme === "http" || scheme === "https";
}

/**
 * Normalizes one `host:port` entry.
 *
 * Returns null for an empty entry so callers can tell "not configured" apart from
 * "configured wrongly".
 */
export function normalizeProxyEntry(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text;
}

/**
 * Parses WinINET's `ProxyServer` value.
 *
 * Two shapes occur in practice:
 *   - `host:port`                          — one proxy for every protocol
 *   - `http=h:p;https=h:p;ftp=h:p;socks=h:p` — per protocol
 */
export function parseProxyServer(value) {
  const text = String(value ?? "").trim();
  const result = { all: null, byScheme: {} };
  if (!text) return result;

  const segments = text.split(";").map((segment) => segment.trim()).filter(Boolean);
  const hasAssignment = segments.some((segment) => segment.includes("="));

  if (!hasAssignment) {
    result.all = normalizeProxyEntry(segments[0]);
    return result;
  }

  for (const segment of segments) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      // A bare entry alongside assignments is still a usable generic proxy.
      result.all ??= normalizeProxyEntry(segment);
      continue;
    }
    const key = segment.slice(0, separator).trim().toLowerCase();
    const entry = normalizeProxyEntry(segment.slice(separator + 1));
    if (!entry) continue;
    if (PROXY_KEYS.includes(key)) result.byScheme[key] = entry;
    else result.all ??= entry;
  }
  return result;
}

const LOOPBACK_NO_PROXY = ["127.0.0.1", "localhost", "::1"];

/**
 * Parses WinINET's `ProxyOverride` value into `NO_PROXY` entries.
 *
 * `<local>` is WinINET's macro for "any host without a dot", whose practical
 * meaning for this project is loopback. Loopback is added unconditionally: the
 * service, the supervisor and the CDP endpoint are all local and must never be
 * routed through a proxy.
 */
export function parseProxyOverride(value) {
  const entries = [];
  for (const raw of String(value ?? "").split(";")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.toLowerCase() === "<local>") {
      for (const loopback of LOOPBACK_NO_PROXY) {
        if (!entries.includes(loopback)) entries.push(loopback);
      }
      continue;
    }
    if (!entries.includes(entry)) entries.push(entry);
  }
  for (const loopback of LOOPBACK_NO_PROXY) {
    if (!entries.includes(loopback)) entries.push(loopback);
  }
  return entries;
}

/**
 * Derives `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` from a registry snapshot.
 *
 * Pure, so it can be tested without touching the registry. Returns null when the
 * snapshot cannot be turned into usable proxy variables, with `reason` explaining
 * why — a silent null here would look exactly like "no proxy configured".
 */
export function proxyVarsFromRegistry(snapshot) {
  const enabled = Number(snapshot?.ProxyEnable) === 1;
  const autoConfigUrl = String(snapshot?.AutoConfigURL ?? "").trim();
  if (!enabled) {
    return { vars: null, reason: autoConfigUrl ? "pac-only" : "disabled" };
  }

  const parsed = parseProxyServer(snapshot?.ProxyServer);
  const generic = parsed.all;
  const http = parsed.byScheme.http ?? generic;
  const https = parsed.byScheme.https ?? parsed.byScheme.http ?? generic;

  if (!http && !https) {
    if (autoConfigUrl) return { vars: null, reason: "pac-only" };
    if (parsed.byScheme.socks || parsed.byScheme.socks5) return { vars: null, reason: "socks-only" };
    return { vars: null, reason: "empty-server" };
  }

  // Node's environment-proxy support understands http/https only; a bare
  // `host:port` has no scheme, so one is added for it to be usable at all.
  const withScheme = (entry) =>
    entry && !/^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? `http://${entry}` : entry;

  const vars = {};
  if (http) vars.HTTP_PROXY = withScheme(http);
  if (https) vars.HTTPS_PROXY = withScheme(https);
  const noProxy = parseProxyOverride(snapshot?.ProxyOverride);
  if (noProxy.length) vars.NO_PROXY = noProxy.join(",");
  return { vars, reason: null };
}

/**
 * Reads `HKCU\...\Internet Settings`.
 *
 * `AutoConfigURL` is reported but never resolved: Node cannot evaluate a PAC
 * script, and pretending otherwise would produce a silent failure. Callers surface
 * this so the user can switch to the manual mode instead.
 */
export async function readWindowsSystemProxy({ timeoutMs = 15000 } = {}) {
  const script = `
    $path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    $item = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
    if (-not $item) { '{}' } else {
      [pscustomobject]@{
        ProxyEnable   = [int]$item.ProxyEnable
        ProxyServer   = [string]$item.ProxyServer
        ProxyOverride = [string]$item.ProxyOverride
        AutoConfigURL = [string]$item.AutoConfigURL
      } | ConvertTo-Json -Compress
    }
  `;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: timeoutMs, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const text = String(stdout ?? "").trim();
    if (!text) {
      return { available: true, snapshot: {}, error: "registry probe returned nothing" };
    }
    return { available: true, snapshot: JSON.parse(text), error: null };
  } catch (error) {
    return {
      available: false,
      snapshot: {},
      error: error?.message || String(error),
    };
  }
}

/**
 * Display metadata for the four modes, shared by the CLI report and the panel's
 * settings tab so the wording cannot drift apart.
 */
export const PROXY_MODE_LABELS = {
  system: "跟随系统代理",
  manual: "手动指定代理地址",
  env: "使用环境变量",
  off: "不使用代理",
};

export const PROXY_MODE_DESCRIPTIONS = {
  off: "直接连网，不经过代理。普通网络用这个。",
  system: "跟随 Windows 里配好的代理。公司内网通常选这个。",
  manual: "自己填代理地址，适合系统里只配置了自动脚本（PAC），或者需要固定代理的情况。",
  env: "读取系统环境变量里的代理设置（HTTP_PROXY / HTTPS_PROXY）。",
};

/** Human-readable explanation for every way a mode can resolve to nothing. */
export const PROXY_REASON_TEXT = {
  disabled: "Windows 未启用系统代理。",
  "pac-only":
    "只配置了自动配置脚本（PAC），助手无法解析它。请在设置里改用「手动指定代理地址」并填入代理地址。",
  "socks-only":
    "系统代理只配置了 SOCKS，而 Node 无法通过 SOCKS 访问 HTTPS。请在手动模式填入 HTTP 代理地址。",
  "empty-server": "系统代理已启用，但没有填写代理地址。",
  "read-failed":
    "无法读取系统代理设置（常见原因是策略拦截了 powershell）。请改用「手动指定代理地址」。",
  "no-env-vars": "环境变量里没有 HTTP_PROXY / HTTPS_PROXY。",
  "unsupported-scheme":
    "代理地址用的是助手不支持的协议。Node 只能通过 HTTP/HTTPS 代理访问网络，不支持 SOCKS 代理，请改填该代理的 HTTP 地址。",
  "manual-url-missing": "手动模式没有填写代理地址。",
  off: "已关闭代理。",
};

/**
 * Turns the configured mode into the proxy variables a child process needs.
 *
 * Pure: the registry snapshot is passed in, so this is testable without Windows.
 * Returns `vars: null` plus a `reason` when the mode cannot produce usable proxy
 * variables — never a silent empty result, because that is indistinguishable from
 * "no proxy configured" and is what makes a network failure hard to explain.
 */
export function buildProxyVars(proxy, systemRead, { env = process.env } = {}) {
  const mode = proxy?.mode ?? "off";

  if (mode === "off") {
    return { source: "off", vars: null, reason: "off", notes: [PROXY_REASON_TEXT.off] };
  }

  if (mode === "env") {
    const vars = {};
    let rejected = null;
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY"]) {
      const value = env?.[name] ?? env?.[name.toLowerCase()];
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) continue;
      if (!proxySchemeSupported(trimmed)) {
        // Passing this on would kill the daemon before it ever listens, so it is
        // dropped and reported rather than forwarded.
        rejected = name;
        continue;
      }
      vars[name] = trimmed;
    }
    const noProxy = env?.NO_PROXY ?? env?.no_proxy;
    if (typeof noProxy === "string" && noProxy.trim()) vars.NO_PROXY = noProxy.trim();
    if (!vars.HTTP_PROXY && !vars.HTTPS_PROXY) {
      const reason = rejected ? "unsupported-scheme" : "no-env-vars";
      return {
        source: "env",
        vars: null,
        reason,
        notes: [PROXY_REASON_TEXT[reason]],
      };
    }
    return { source: "env", vars, reason: null, notes: [] };
  }

  if (mode === "manual") {
    const entry = String(proxy?.url ?? "").trim();
    if (!entry) {
      return {
        source: "manual",
        vars: null,
        reason: "manual-url-missing",
        notes: [PROXY_REASON_TEXT["manual-url-missing"]],
      };
    }
    if (!proxySchemeSupported(entry)) {
      // The config layer already rejects this, so reaching here means the value
      // came from somewhere else — a hand-edited file, or an older config. The
      // daemon must still refuse to start with it rather than die silently.
      return {
        source: "manual",
        vars: null,
        reason: "unsupported-scheme",
        notes: [PROXY_REASON_TEXT["unsupported-scheme"]],
      };
    }
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `http://${entry}`;
    const vars = { HTTP_PROXY: candidate, HTTPS_PROXY: candidate };
    const noProxy = String(proxy?.noProxy ?? "").trim();
    if (noProxy) vars.NO_PROXY = noProxy;
    return { source: "manual", vars, reason: null, notes: [] };
  }

  if (!systemRead || systemRead.available === false) {
    return {
      source: "system",
      vars: null,
      reason: "read-failed",
      notes: [PROXY_REASON_TEXT["read-failed"], systemRead?.error].filter(Boolean),
    };
  }

  const derived = proxyVarsFromRegistry(systemRead.snapshot);
  if (!derived.vars) {
    return {
      source: "system",
      vars: null,
      reason: derived.reason,
      notes: [PROXY_REASON_TEXT[derived.reason] ?? `系统代理不可用（${derived.reason}）。`],
    };
  }

  const vars = { ...derived.vars };
  const extra = String(proxy?.noProxy ?? "").trim();
  if (extra) {
    const merged = [vars.NO_PROXY, extra].filter(Boolean).join(",");
    vars.NO_PROXY = [...new Set(merged.split(",").map((entry) => entry.trim()).filter(Boolean))].join(",");
  }
  return { source: "system", vars, reason: null, notes: [] };
}

/**
 * Reads the registry when the mode needs it, then derives the variables.
 *
 * Every process that spawns the daemon calls this, because `NODE_USE_ENV_PROXY`
 * and the proxy variables are only read when the daemon starts.
 */
export async function resolveProxyVars(proxy, options = {}) {
  const mode = proxy?.mode ?? "off";
  const systemRead = mode === "system" ? await readWindowsSystemProxy(options) : null;
  return buildProxyVars(proxy, systemRead, options);
}

/**
 * A redacted, display-ready view for the settings page.
 */
export function describeProxyState(proxy, resolved, systemRead) {
  return {
    mode: proxy?.mode ?? "system",
    url: redactProxyUrl(proxy?.url ?? ""),
    noProxy: proxy?.noProxy ?? "",
    source: resolved?.source ?? null,
    active: Boolean(resolved?.vars),
    reason: resolved?.reason ?? null,
    notes: resolved?.notes ?? [],
    // Only names and whether they are set — a proxy URL may embed credentials.
    resolvedNames: resolved?.vars ? Object.keys(resolved.vars).sort() : [],
    system: systemRead ? describeSystemProxy(systemRead.snapshot) : null,
    systemReadError: systemRead?.available === false ? systemRead.error : null,
  };
}

/**
 * A redacted, display-ready view of the system proxy. Never contains a password.
 */
export function describeSystemProxy(snapshot) {
  const enabled = Number(snapshot?.ProxyEnable) === 1;
  const server = String(snapshot?.ProxyServer ?? "").trim();
  const autoConfigUrl = String(snapshot?.AutoConfigURL ?? "").trim();
  const parsed = parseProxyServer(server);
  const entries = { ...parsed.byScheme };
  if (parsed.all) entries.all = parsed.all;
  const redacted = {};
  for (const [key, value] of Object.entries(entries)) redacted[key] = redactProxyUrl(value);
  return {
    enabled,
    hasServer: server.length > 0,
    server: redactProxyUrl(server),
    byScheme: redacted,
    override: String(snapshot?.ProxyOverride ?? "").trim(),
    autoConfigUrl: redactProxyUrl(autoConfigUrl),
    hasAutoConfigUrl: autoConfigUrl.length > 0,
  };
}
