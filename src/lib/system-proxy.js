/**
 * Reads the Windows system proxy and turns any proxy configuration into one
 * concrete target the dispatcher can use.
 *
 * TRAE renders with Chromium and therefore honours the WinINET proxy settings that
 * live in the registry. Node's `fetch` does not read them at all, which is
 * precisely what produced "TRAE works, the assistant cannot reach api.trae.cn" on
 * the intranet machine.
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

/** The three supported proxy modes. `off` is the default. */
export const PROXY_MODES = ["off", "system", "custom"];

/**
 * Proxy protocols the dispatcher can speak.
 *
 * `socks` (v4) is deliberately absent: it is a different handshake and undici
 * does not implement it. A registry entry using it is reported, never ignored.
 */
export const PROXY_SCHEMES = ["http", "https", "socks5"];

/** Protocol keys WinINET stores in `ProxyServer`. */
const PROXY_KEYS = ["http", "https", "ftp", "socks", "socks5"];

const LOOPBACK_NO_PROXY = ["127.0.0.1", "localhost", "::1"];

/**
 * Replaces the password in a proxy URL with `<redacted>`.
 *
 * Both `scheme://user:pass@host` and a bare `user:pass@host` are handled, and the
 * match may start after any separator because a single `ProxyServer` value chains
 * several proxies (`http=u:p@h:1;https=u:p@h:2`). Missing that second entry would
 * put a live password into a log. The user part is kept: knowing which account is
 * configured is useful, the secret is not.
 */
export function redactProxyUrl(value) {
  const text = String(value ?? "");
  if (!text) return "";
  return text.replace(
    /(^|[/;,\s=])([^/@\s:]+):([^/@\s]*)@/g,
    (match, prefix, user) => `${prefix}${user}:<redacted>@`,
  );
}

/**
 * Splits a `host:port` entry, tolerating the bracketed IPv6 form.
 *
 * Returns null for anything without a usable port so callers can report
 * `empty-server` instead of building a dispatcher out of half an address.
 */
export function parseHostPort(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(text);
  if (bracketed) {
    const port = Number(bracketed[2]);
    if (port < 1 || port > 65535) return null;
    return { host: bracketed[1], port };
  }
  const separator = text.lastIndexOf(":");
  if (separator <= 0) return null;
  const host = text.slice(0, separator).trim();
  const port = Number(text.slice(separator + 1).trim());
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/**
 * Splits an optional `user:password@` prefix off a proxy entry.
 *
 * WinINET is not supposed to hold credentials, but configuration tools do write
 * them into `ProxyServer`. Left in place they would become part of `host` — the
 * value the panel displays and the daemon logs — so they are lifted out here and
 * handed to the dispatcher as structured options instead.
 */
export function splitCredentials(entry) {
  const text = String(entry ?? "").trim();
  const match = /^([^/@\s:]+):([^/@\s]*)@(.*)$/.exec(text);
  if (!match) return { address: text, username: "", password: "" };
  return {
    address: match[3],
    username: safeDecode(match[1]),
    password: safeDecode(match[2]),
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** One registry entry as a structured target, or null when it is unusable. */
function targetFromEntry(scheme, entry) {
  const { address, username, password } = splitCredentials(entry);
  const parsed = parseHostPort(address);
  if (!parsed) return null;
  return { scheme, host: parsed.host, port: parsed.port, username, password };
}

/**
 * Parses WinINET's `ProxyServer` value.
 *
 * Two shapes occur in practice:
 *   - `host:port`                          — one proxy for every protocol
 *   - `http=h:p;https=h:p;socks5=h:p`      — per protocol
 */
export function parseProxyServer(value) {
  const text = String(value ?? "").trim();
  const result = { all: null, byScheme: {} };
  if (!text) return result;

  const segments = text.split(";").map((segment) => segment.trim()).filter(Boolean);
  const hasAssignment = segments.some((segment) => segment.includes("="));

  if (!hasAssignment) {
    result.all = segments[0] ?? null;
    return result;
  }

  for (const segment of segments) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      // A bare entry alongside assignments is still a usable generic proxy.
      result.all ??= segment;
      continue;
    }
    const key = segment.slice(0, separator).trim().toLowerCase();
    const entry = segment.slice(separator + 1).trim();
    if (!entry) continue;
    if (PROXY_KEYS.includes(key)) result.byScheme[key] = entry;
    else result.all ??= entry;
  }
  return result;
}

/**
 * Parses WinINET's `ProxyOverride` value into a list of no-proxy entries.
 *
 * `<local>` is WinINET's macro for "any host without a dot", whose practical
 * meaning for this project is loopback.
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
  return entries;
}

/** Splits the panel's comma-separated exception field. */
export function parseNoProxyField(value) {
  const entries = [];
  for (const raw of String(value ?? "").split(",")) {
    const entry = raw.trim();
    if (entry && !entries.includes(entry)) entries.push(entry);
  }
  return entries;
}

/**
 * Loopback must never be sent through a proxy: the service, the supervisor and
 * the CDP endpoint are all local, and routing them through a proxy would break
 * the parts that currently work. They are always present.
 */
export function mergeNoProxy(...lists) {
  const entries = [];
  for (const list of lists) {
    for (const entry of list ?? []) {
      const text = String(entry ?? "").trim();
      if (text && !entries.includes(text)) entries.push(text);
    }
  }
  for (const loopback of LOOPBACK_NO_PROXY) {
    if (!entries.includes(loopback)) entries.push(loopback);
  }
  return entries;
}

/**
 * Reads `HKCU\...\Internet Settings`.
 *
 * `AutoConfigURL` is reported but never resolved: Node cannot evaluate a PAC
 * script, and pretending otherwise would produce a silent failure. Callers surface
 * this so the user can switch to the custom mode instead.
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
 * Turns a registry snapshot into one proxy target.
 *
 * Prefers the `https` entry because every request this project makes is HTTPS;
 * falls back to `http`, then a bare entry, then `socks5`. Returns `target: null`
 * with a `reason` whenever nothing usable can be built — a silent null would look
 * exactly like "no proxy configured" and is what makes a failure unexplainable.
 */
export function targetFromRegistry(snapshot) {
  const enabled = Number(snapshot?.ProxyEnable) === 1;
  const autoConfigUrl = String(snapshot?.AutoConfigURL ?? "").trim();
  if (!enabled) return { target: null, reason: autoConfigUrl ? "pac-only" : "disabled" };

  const parsed = parseProxyServer(snapshot?.ProxyServer);
  const candidate = parsed.byScheme.https ?? parsed.byScheme.http ?? parsed.all;
  if (candidate) {
    const target = targetFromEntry("http", candidate);
    if (target) return { target, reason: null };
  }
  const socks5 = parsed.byScheme.socks5;
  if (socks5) {
    const target = targetFromEntry("socks5", socks5);
    if (target) return { target, reason: null };
  }
  if (parsed.byScheme.socks) return { target: null, reason: "socks-v4-unsupported" };
  if (autoConfigUrl) return { target: null, reason: "pac-only" };
  return { target: null, reason: "empty-server" };
}

/**
 * Resolves the configured mode into `{ source, target, noProxy, reason, notes }`.
 *
 * Pure: the registry snapshot is passed in, so this is testable without Windows.
 * `target` is a structured object — never a URL string — so a password can never
 * travel inside one into a log or an exception message.
 */
export function resolveProxyTarget(proxy, systemRead) {
  const mode = PROXY_MODES.includes(proxy?.mode) ? proxy.mode : "off";
  const extraNoProxy = parseNoProxyField(proxy?.noProxy);

  if (mode === "off") {
    return { source: "off", target: null, noProxy: [], reason: "off", notes: [PROXY_REASON_TEXT.off] };
  }

  if (mode === "custom") {
    const host = String(proxy?.host ?? "").trim();
    const port = Number(proxy?.port);
    const scheme = PROXY_SCHEMES.includes(proxy?.scheme) ? proxy.scheme : "http";
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return {
        source: "custom",
        target: null,
        noProxy: mergeNoProxy(extraNoProxy, []),
        reason: "custom-incomplete",
        notes: [PROXY_REASON_TEXT["custom-incomplete"]],
      };
    }
    return {
      source: "custom",
      target: {
        scheme,
        host,
        port,
        username: String(proxy?.username ?? ""),
        password: String(proxy?.password ?? ""),
      },
      noProxy: mergeNoProxy(extraNoProxy, []),
      reason: null,
      notes: [],
    };
  }

  // mode === "system"
  if (!systemRead || systemRead.available === false) {
    return {
      source: "system",
      target: null,
      noProxy: mergeNoProxy(extraNoProxy, []),
      reason: "read-failed",
      notes: [PROXY_REASON_TEXT["read-failed"], systemRead?.error].filter(Boolean),
    };
  }

  const derived = targetFromRegistry(systemRead.snapshot);
  const noProxy = mergeNoProxy(
    parseProxyOverride(systemRead.snapshot?.ProxyOverride),
    extraNoProxy,
  );
  if (!derived.target) {
    return {
      source: "system",
      target: null,
      noProxy,
      reason: derived.reason,
      notes: [PROXY_REASON_TEXT[derived.reason] ?? `系统代理不可用（${derived.reason}）。`],
    };
  }
  // Any credential found in `ProxyServer` travels as structured fields, so it is
  // never part of the host the panel displays.
  return {
    source: "system",
    target: derived.target,
    noProxy,
    reason: null,
    notes: [],
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

/** Display metadata for the three modes, shared by the CLI report and the panel. */
export const PROXY_MODE_LABELS = {
  off: "不使用代理",
  system: "使用系统代理",
  custom: "使用自定义代理",
};

export const PROXY_MODE_DESCRIPTIONS = {
  off: "直接连网，不经过代理。普通网络用这个。",
  system: "跟随 Windows 里已配置的代理，公司内网通常选这个。",
  custom: "自己填写代理地址，适用于系统只配了自动脚本(PAC)或需要固定代理的情况。",
};

/** Human-readable explanation for every way a mode can resolve to nothing. */
export const PROXY_REASON_TEXT = {
  off: "已关闭代理。",
  disabled: "Windows 未启用系统代理。",
  "pac-only":
    "系统只配置了自动配置脚本（PAC），助手无法解析它。请改用「使用自定义代理」并填入代理地址。",
  "socks-v4-unsupported":
    "系统代理配置的是 SOCKS4，助手只支持 SOCKS5。请改用「使用自定义代理」并填入代理地址。",
  "empty-server": "系统代理已启用，但没有填写有效的代理地址。",
  "read-failed":
    "无法读取系统代理设置（常见原因是策略拦截了 powershell）。请改用「使用自定义代理」。",
  "custom-incomplete": "自定义代理没有填写完整的地址和端口。",
  "build-failed": "代理配置无法生效，请检查地址、端口与协议。",
};