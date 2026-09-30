import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProbeFailure,
  describeErrorChain,
  describeProxyTestVerdict,
  formatProbeLine,
  isTimeoutError,
  probeSucceeded,
  redactQueryValues,
  redactUrl,
  stripProxyEnv,
  summarizeProbeFailure,
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

test("a timeout is recognised wherever it sits in the cause chain", () => {
  // undici's own timeouts are ordinary errors, not aborts: this is the one that
  // used to reach the panel as a raw "Body Timeout Error | UND_ERR_BODY_TIMEOUT".
  const body = new Error("Body Timeout Error");
  body.code = "UND_ERR_BODY_TIMEOUT";
  assert.equal(isTimeoutError(withCause("fetch failed", body)), true);
  assert.equal(isTimeoutError(body), true);

  const aborted = new Error("This operation was aborted");
  aborted.name = "AbortError";
  assert.equal(isTimeoutError(aborted), true);

  const connect = new Error("Connect Timeout Error");
  connect.code = "UND_ERR_CONNECT_TIMEOUT";
  assert.equal(isTimeoutError(connect), true);

  // An ordinary transport failure must stay one: telling a user to check their
  // network when the release asset is simply gone would be a wrong instruction.
  const refused = new Error("fetch failed");
  refused.cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  assert.equal(isTimeoutError(refused), false);
  assert.equal(isTimeoutError(null), false);

  // A chain that points at itself must not spin.
  const loop = new Error("fetch failed");
  loop.cause = loop;
  assert.equal(isTimeoutError(loop), false);
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

const probed = (host, error) => ({ host, error, httpStatus: null, dnsError: null, addresses: [] });
const arrived = (host, status = 200) => ({ host, error: null, httpStatus: status, dnsError: null, addresses: [] });

test("failure classification prefers the most specific cause, not the first seen", () => {
  assert.equal(classifyProbeFailure("fetch failed → UNABLE_TO_GET_ISSUER_CERT_LOCALLY"), "certificate");
  // A certificate rejection proves something answered, so it outranks the
  // refused connection the same chain also mentions.
  assert.equal(
    classifyProbeFailure("fetch failed → connect ECONNREFUSED 1.2.3.4:7890 → UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
    "certificate",
  );
  assert.equal(classifyProbeFailure("407 Proxy Authentication Required"), "auth");
  assert.equal(classifyProbeFailure("SOCKS5 authentication failed"), "auth");
  assert.equal(classifyProbeFailure("fetch failed → connect ECONNREFUSED 127.0.0.1:7890"), "refused");
  assert.equal(classifyProbeFailure("getaddrinfo ENOTFOUND proxy.corp"), "dns");
  assert.equal(classifyProbeFailure("Headers Timeout Error"), "timeout");
  assert.equal(classifyProbeFailure("something else entirely"), "other");
  assert.equal(classifyProbeFailure(""), null);
  assert.equal(classifyProbeFailure(null), null);

  assert.equal(
    summarizeProbeFailure([probed("a.cn", "ENOTFOUND"), probed("b.cn", "UNABLE_TO_VERIFY_LEAF_SIGNATURE")]),
    "certificate",
  );
  assert.equal(summarizeProbeFailure([arrived("a.cn")]), null);
});

test("the test-connection verdict names the one thing the user should do next", () => {
  // No proxy run happened, and direct works: say so plainly.
  const direct = describeProxyTestVerdict({ direct: [arrived("api.trae.cn")], proxied: null });
  assert.equal(direct.conclusion, "direct");
  assert.equal(direct.severity, "ok");

  // Direct fails on an intranet: the sentence must point at the proxy, not at DNS.
  const intranet = describeProxyTestVerdict({
    direct: [probed("api.trae.cn", "connect ETIMEDOUT 10.0.0.1:443")],
    proxied: null,
  });
  assert.equal(intranet.conclusion, "timeout");
  assert.match(intranet.text, /走代理/);

  const both = describeProxyTestVerdict({
    direct: [arrived("api.trae.cn")],
    proxied: [arrived("api.trae.cn")],
  });
  assert.equal(both.conclusion, "both");
  assert.equal(both.severity, "ok");

  // The proxy is the fix: direct failed, proxied answered.
  const recommended = describeProxyTestVerdict({
    direct: [probed("api.trae.cn", "connect ECONNREFUSED 10.0.0.1:443")],
    proxied: [arrived("api.trae.cn")],
  });
  assert.equal(recommended.conclusion, "proxy");
  assert.equal(recommended.severity, "ok");
  assert.match(recommended.text, /建议保存并启用/);

  // Direct works but the proxy does not: the hint must be about the proxy.
  const badProxy = describeProxyTestVerdict({
    direct: [arrived("api.trae.cn")],
    proxied: [probed("api.trae.cn", "connect ECONNREFUSED 127.0.0.1:7890")],
  });
  assert.equal(badProxy.conclusion, "refused");
  assert.equal(badProxy.severity, "hint");
  assert.match(badProxy.text, /代理已启动/);

  // Both fail on a certificate: a hint would send the user to re-check an
  // address that is already correct, so this is reported as an error.
  const certificate = describeProxyTestVerdict({
    direct: [probed("api.trae.cn", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY")],
    proxied: [probed("api.trae.cn", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY")],
  });
  assert.equal(certificate.conclusion, "certificate");
  assert.equal(certificate.severity, "error");
  assert.match(certificate.text, /证书/);
});
