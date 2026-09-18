import assert from "node:assert/strict";
import test from "node:test";

import {
  anyProxyConfigured,
  classifyProbeFailure,
  describeErrorChain,
  describeProbeVerdict,
  formatProbeLine,
  probeSucceeded,
  proxyChildEnv,
  proxyEnvEnabled,
  proxyEnvReport,
  redactQueryValues,
  redactUrl,
  stripProxyEnv,
  summarizeProbeFailure,
} from "../src/lib/net-diagnostics.js";

function withCause(message, cause, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  if (cause) error.cause = cause;
  return error;
}

test("a bare fetch failure is expanded through its cause chain", () => {
  const socket = withCause("connect ECONNREFUSED 127.0.0.1:9", null, {
    code: "ECONNREFUSED",
    errno: -4078,
    syscall: "connect",
    address: "127.0.0.1",
    port: 9,
  });
  const outer = withCause("fetch failed", socket);
  const described = describeErrorChain(outer);
  assert.match(described, /fetch failed/);
  assert.match(described, /ECONNREFUSED/);
  assert.match(described, /127\.0\.0\.1:9/);
});

test("a dns failure keeps the host name", () => {
  const inner = withCause("getaddrinfo ENOTFOUND api.trae.cn", null, {
    code: "ENOTFOUND",
    syscall: "getaddrinfo",
    hostname: "api.trae.cn",
  });
  const described = describeErrorChain(withCause("fetch failed", inner));
  assert.match(described, /ENOTFOUND/);
  assert.match(described, /api\.trae\.cn/);
});

test("a self referencing cause does not loop forever", () => {
  const error = new Error("fetch failed");
  error.cause = error;
  assert.equal(describeErrorChain(error), "fetch failed");
});

test("a cause chain is bounded and never empty", () => {
  assert.equal(describeErrorChain(null), "unknown error");
  assert.equal(describeErrorChain(new Error("plain")), "plain");
  let deep = new Error("level0");
  for (let index = 1; index <= 10; index += 1) deep = withCause(`level${index}`, deep);
  assert.equal(describeErrorChain(deep, { maxDepth: 3 }).split("→").length, 3);
});

test("identifiers in a url never reach the report", () => {
  assert.equal(
    redactQueryValues("GET https://api.trae.cn/x?did=12345&other=1 failed"),
    "GET https://api.trae.cn/x?did=<redacted>&other=1 failed",
  );
  assert.equal(
    redactUrl("https://api.trae.cn/x?did=12345&token=abc"),
    "https://api.trae.cn/x?did=%3Credacted%3E&token=%3Credacted%3E",
  );
  assert.equal(redactUrl("not a url?did=1"), "not a url?did=<redacted>");
});

test("a described error has its query values redacted", () => {
  const error = withCause("request to https://api.trae.cn/a?did=98765 failed", null);
  const described = describeErrorChain(error);
  assert.equal(described.includes("98765"), false);
  assert.match(described, /did=<redacted>/);
});

test("the proxy report never reveals a value", () => {
  const report = proxyEnvReport({
    HTTPS_PROXY: "http://user:secret@proxy.local:8080",
    NO_PROXY: "127.0.0.1",
  });
  assert.equal(report.length > 0, true);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("proxy.local"), false);
  const https = report.find((entry) => entry.name === "HTTPS_PROXY");
  assert.equal(https.set, true);
  const http = report.find((entry) => entry.name === "HTTP_PROXY");
  assert.equal(http.set, false);
});

test("case duplicated proxy variables are reported once", () => {
  const report = proxyEnvReport({ HTTP_PROXY: "a", http_proxy: "b" });
  const names = report.map((entry) => entry.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("environment proxy support is detected from the node variable", () => {
  assert.equal(proxyEnvEnabled({ NODE_USE_ENV_PROXY: "1" }), true);
  assert.equal(proxyEnvEnabled({ NODE_USE_ENV_PROXY: "TRUE" }), true);
  assert.equal(proxyEnvEnabled({ NODE_USE_ENV_PROXY: "0" }), false);
  assert.equal(proxyEnvEnabled({}), false);
});

test("a NO_PROXY entry alone is not treated as a configured proxy", () => {
  assert.equal(anyProxyConfigured({ NO_PROXY: "127.0.0.1" }), false);
  assert.equal(anyProxyConfigured({ HTTPS_PROXY: "http://p:1", NO_PROXY: "127.0.0.1" }), true);
  assert.equal(anyProxyConfigured({}), false);
});

test("proxy variables reach a child environment and loopback never does", () => {
  const env = proxyChildEnv({ proxyVars: { HTTP_PROXY: "http://p:8080" } });
  assert.equal(env.NODE_USE_ENV_PROXY, "1");
  assert.equal(env.HTTP_PROXY, "http://p:8080");
  for (const entry of ["127.0.0.1", "localhost", "::1"]) {
    assert.equal(env.NO_PROXY.split(",").includes(entry), true);
  }
});

test("a child without a resolved proxy keeps the environment untouched", () => {
  const source = { NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://old:1" };
  const env = proxyChildEnv({ proxyVars: null, env: source });
  // Passing the environment through is safe: Node only reads these variables when
  // NODE_USE_ENV_PROXY is present in the child's own start-up environment.
  assert.equal(env.HTTPS_PROXY, "http://old:1");
  assert.equal(source.HTTPS_PROXY, "http://old:1");
});

test("stripping removes every proxy variable, including the node switch", () => {
  const env = stripProxyEnv({
    PATH: "/usr/bin",
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: "http://p:1",
    HTTPS_PROXY: "http://p:1",
    ALL_PROXY: "socks://p:1",
    NO_PROXY: "127.0.0.1",
    http_proxy: "http://p:1",
    no_proxy: "127.0.0.1",
  });
  assert.equal(env.PATH, "/usr/bin");
  for (const name of Object.keys(env)) {
    assert.equal(name.toLowerCase().includes("proxy"), false, `${name} should be gone`);
  }
  assert.equal(env.NODE_USE_ENV_PROXY, undefined);
});

test("a stripped environment is a safe base for a fresh proxy resolution", () => {
  const stripped = stripProxyEnv({ NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://old:1" });
  const env = proxyChildEnv({ proxyVars: { HTTPS_PROXY: "http://new:1" }, env: stripped });
  assert.equal(env.HTTPS_PROXY, "http://new:1");
  assert.equal(env.NODE_USE_ENV_PROXY, "1");
});

test("probe results always produce a readable line", () => {
  assert.match(
    formatProbeLine({ host: "a.cn", dnsError: "ENOTFOUND" }),
    /a\.cn: DNS 失败 → ENOTFOUND/,
  );
  assert.match(
    formatProbeLine({ host: "a.cn", addresses: ["1.2.3.4 (IPv4)"], error: "ECONNREFUSED" }),
    /a\.cn: 连接失败 → ECONNREFUSED/,
  );
  assert.match(
    formatProbeLine({ host: "a.cn", addresses: ["1.2.3.4 (IPv4)"], httpStatus: 200 }),
    /a\.cn: 可达，HTTP 200/,
  );
});

test("a long dns answer is summarized instead of flooding the report", () => {
  const addresses = Array.from({ length: 10 }, (_, index) => `10.0.0.${index} (IPv4)`);
  const line = formatProbeLine({ host: "a.cn", addresses, httpStatus: 200 });
  assert.match(line, /10\.0\.0\.0/);
  assert.match(line, /\+7 个/);
  assert.equal(line.includes("10.0.0.9"), false);
});

test("a reachable proxy result is successful even when local DNS failed", () => {
  const result = {
    host: "api.trae.cn",
    addresses: [],
    dnsError: "getaddrinfo ENOTFOUND",
    httpStatus: 200,
    error: null,
  };
  assert.equal(probeSucceeded(result), true);
  assert.match(formatProbeLine(result), /可达，HTTP 200/);
  assert.match(formatProbeLine(result), /本地 DNS 失败/);
  assert.equal(probeSucceeded({ dnsError: "x", httpStatus: null, error: null }), false);
});

/* -------------------------------------------------------------------------- *
 * Failure classification
 *
 * These exist because the three-way "direct / proxy / neither" verdict sent an
 * intranet user to re-check a proxy address that was already correct: the real
 * failure was a certificate the machine did not trust. Each reason must now
 * produce its own instruction.
 * -------------------------------------------------------------------------- */

test("a certificate rejection is never reported as a wrong proxy address", () => {
  const chain =
    "fetch failed → unable to get local issuer certificate | UNABLE_TO_GET_ISSUER_CERT_LOCALLY";
  assert.equal(classifyProbeFailure(chain), "certificate");
  assert.equal(classifyProbeFailure("fetch failed → DEPTH_ZERO_SELF_SIGNED_CERT"), "certificate");
  assert.equal(classifyProbeFailure("fetch failed → SELF_SIGNED_CERT_IN_CHAIN"), "certificate");
});

test("every other transport failure maps to its own reason", () => {
  assert.equal(classifyProbeFailure("fetch failed → connect ECONNREFUSED 127.0.0.1:9"), "refused");
  assert.equal(classifyProbeFailure("fetch failed → getaddrinfo ENOTFOUND api.trae.cn"), "dns");
  assert.equal(
    classifyProbeFailure("fetch failed → The operation was aborted due to timeout"),
    "timeout",
  );
  assert.equal(classifyProbeFailure("407 Proxy Authentication Required"), "auth");
  assert.equal(classifyProbeFailure("something else entirely"), "other");
  assert.equal(classifyProbeFailure(""), null);
  assert.equal(classifyProbeFailure(null), null);
});

test("a certificate failure outranks a timeout reported by another host", () => {
  // Both appear across the three probed hosts. Only the certificate one tells an
  // intranet user something they can act on, so it has to win.
  const kind = summarizeProbeFailure([
    { error: "fetch failed → The operation was aborted due to timeout" },
    { error: "fetch failed → UNABLE_TO_GET_ISSUER_CERT_LOCALLY" },
    { error: "fetch failed → UNABLE_TO_GET_ISSUER_CERT_LOCALLY" },
  ]);
  assert.equal(kind, "certificate");
});

test("a probe run with no failures summarises to nothing", () => {
  assert.equal(summarizeProbeFailure([]), null);
  assert.equal(summarizeProbeFailure([{ error: null, httpStatus: 200 }]), null);
  assert.equal(summarizeProbeFailure(null), null);
});

/* --- verdict --------------------------------------------------------------- */

const RUN_OK = { reachable: true, results: [{ error: null, httpStatus: 200 }] };
const RUN_TIMEOUT = {
  reachable: false,
  results: [{ error: "fetch failed → The operation was aborted due to timeout" }],
};

function failingWith(error) {
  return { reachable: false, results: [{ error }] };
}

test("a working direct connection needs no proxy", () => {
  const verdict = describeProbeVerdict({ direct: RUN_OK });
  assert.equal(verdict.conclusion, "direct");
  assert.equal(verdict.severity, "ok");
});

test("a working proxy is reported as usable", () => {
  const verdict = describeProbeVerdict({ direct: RUN_TIMEOUT, proxied: RUN_OK });
  assert.equal(verdict.conclusion, "proxy");
  assert.equal(verdict.severity, "ok");
});

test("a usable system proxy is a hint the user can act on, not an error", () => {
  // The saved mode defaults to off, so this is how an intranet user finds out
  // which setting to change.
  const verdict = describeProbeVerdict({
    direct: RUN_TIMEOUT,
    proxied: null,
    suggestion: RUN_OK,
  });
  assert.equal(verdict.conclusion, "system-proxy");
  assert.equal(verdict.severity, "hint");
  assert.match(verdict.text, /跟随系统代理/);
});

test("a certificate failure names the certificate and not the proxy address", () => {
  const verdict = describeProbeVerdict({
    direct: RUN_TIMEOUT,
    proxied: failingWith("fetch failed → UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
  });
  assert.equal(verdict.conclusion, "certificate");
  assert.equal(verdict.severity, "error");
  assert.match(verdict.text, /证书/);
  assert.doesNotMatch(verdict.text, /核对代理地址/);
});

test("a 407 says the proxy wants credentials rather than blaming the address", () => {
  const verdict = describeProbeVerdict({
    direct: RUN_TIMEOUT,
    proxied: failingWith("407 Proxy Authentication Required"),
  });
  assert.equal(verdict.conclusion, "auth");
  assert.match(verdict.text, /407/);
  assert.doesNotMatch(verdict.text, /核对代理地址/);
});

test("a refused connection is the case that does ask about the address", () => {
  const verdict = describeProbeVerdict({
    direct: RUN_TIMEOUT,
    proxied: failingWith("fetch failed → connect ECONNREFUSED 127.0.0.1:9"),
  });
  assert.equal(verdict.conclusion, "refused");
  assert.match(verdict.text, /核对代理地址/);
});

test("a timeout on an intranet machine still points at the proxy setting", () => {
  const verdict = describeProbeVerdict({ direct: RUN_TIMEOUT });
  assert.equal(verdict.conclusion, "timeout");
  assert.match(verdict.text, /跟随系统代理/);
});

test("every verdict carries readable text and a known severity", () => {
  for (const input of [
    { direct: RUN_OK },
    { direct: RUN_TIMEOUT, proxied: RUN_OK },
    { direct: RUN_TIMEOUT, suggestion: RUN_OK },
    { direct: RUN_TIMEOUT },
    {},
  ]) {
    const verdict = describeProbeVerdict(input);
    assert.ok(verdict.text.length > 0, "a verdict must never be empty");
    assert.ok(["ok", "hint", "error"].includes(verdict.severity));
  }
});
