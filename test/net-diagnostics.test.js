import assert from "node:assert/strict";
import test from "node:test";

import {
  anyProxyConfigured,
  describeErrorChain,
  formatProbeLine,
  probeSucceeded,
  proxyEnvEnabled,
  proxyEnvReport,
  redactQueryValues,
  redactUrl,
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
