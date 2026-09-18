import assert from "node:assert/strict";
import test from "node:test";

import {
  describeErrorChain,
  formatProbeLine,
  probeSucceeded,
  redactQueryValues,
  redactUrl,
  stripProxyEnv,
} from "../src/lib/net-diagnostics.js";

function withCause(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

test("describeErrorChain exposes the useful transport cause", () => {
  const inner = withCause("connect ECONNREFUSED 127.0.0.1:9", null);
  inner.code = "ECONNREFUSED";
  inner.syscall = "connect";
  inner.address = "127.0.0.1";
  inner.port = 9;
  const described = describeErrorChain(withCause("fetch failed", inner));
  assert.match(described, /fetch failed/);
  assert.match(described, /ECONNREFUSED/);
  assert.match(described, /127\.0\.0\.1:9/);
});

test("secret query values are removed from reports", () => {
  assert.equal(
    redactQueryValues("GET https://api.trae.cn/x?did=12345&other=1 failed"),
    "GET https://api.trae.cn/x?did=<redacted>&other=1 failed",
  );
  assert.equal(
    redactUrl("https://api.trae.cn/x?did=12345&token=abc"),
    "https://api.trae.cn/x?did=%3Credacted%3E&token=%3Credacted%3E",
  );
});

test("stripProxyEnv removes ambient proxy controls for direct children", () => {
  const env = stripProxyEnv({
    PATH: "/bin",
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: "http://p:1",
    HTTPS_PROXY: "http://p:1",
    NO_PROXY: "127.0.0.1",
    http_proxy: "http://p:1",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.NODE_USE_ENV_PROXY, undefined);
  for (const name of Object.keys(env)) {
    assert.equal(name.toLowerCase().includes("proxy"), false, `${name} should be gone`);
  }
});

test("probe formatting distinguishes reachable and failed hosts", () => {
  assert.equal(
    probeSucceeded({ host: "a.cn", addresses: ["1.2.3.4 (IPv4)"], httpStatus: 200, error: null }),
    true,
  );
  assert.equal(probeSucceeded({ host: "a.cn", dnsError: "ENOTFOUND", httpStatus: null, error: null }), false);
  const line = formatProbeLine({
    host: "a.cn",
    addresses: ["1.2.3.4 (IPv4)", "5.6.7.8 (IPv4)", "9.10.11.12 (IPv4)", "13.14.15.16 (IPv4)"],
    httpStatus: 200,
    error: null,
    dnsError: null,
  });
  assert.match(line, /可达，HTTP 200/);
  assert.match(line, /\+1 个/);
  assert.match(formatProbeLine({ host: "a.cn", dnsError: "ENOTFOUND" }), /DNS 失败/);
});
