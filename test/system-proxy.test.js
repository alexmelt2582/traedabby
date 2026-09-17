import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProxyVars,
  describeSystemProxy,
  parseProxyOverride,
  parseProxyServer,
  proxyHasCredentials,
  proxySchemeSupported,
  proxyVarsFromRegistry,
  redactProxyUrl,
} from "../src/lib/system-proxy.js";

test("a proxy password is redacted while the user name survives", () => {
  assert.equal(
    redactProxyUrl("http://alice:s3cret@proxy.corp:8080"),
    "http://alice:<redacted>@proxy.corp:8080",
  );
  // The bare form the manual field accepts before it is normalized.
  assert.equal(
    redactProxyUrl("alice:s3cret@proxy.corp:8080"),
    "alice:<redacted>@proxy.corp:8080",
  );
  assert.equal(redactProxyUrl("http://proxy.corp:8080"), "http://proxy.corp:8080");
  assert.equal(redactProxyUrl("http://alice@proxy.corp:8080"), "http://alice@proxy.corp:8080");
  assert.equal(redactProxyUrl(""), "");
});

test("credentials in a proxy value are detected", () => {
  assert.equal(proxyHasCredentials("http://alice:s3cret@proxy.corp:8080"), true);
  assert.equal(proxyHasCredentials("alice:s3cret@proxy.corp:8080"), true);
  assert.equal(proxyHasCredentials("http://alice@proxy.corp:8080"), false);
  assert.equal(proxyHasCredentials("http://proxy.corp:8080"), false);
  assert.equal(proxyHasCredentials(""), false);
});

test("a bare host:port applies to every protocol", () => {
  assert.deepEqual(parseProxyServer("proxy.corp:8080"), {
    all: "proxy.corp:8080",
    byScheme: {},
  });
});

test("per-protocol entries are split apart", () => {
  assert.deepEqual(parseProxyServer("http=h1:1;https=h2:2;socks=s1:3"), {
    all: null,
    byScheme: { http: "h1:1", https: "h2:2", socks: "s1:3" },
  });
  assert.deepEqual(parseProxyServer(" HTTP=h1:1 ; HTTPS=h2:2 "), {
    all: null,
    byScheme: { http: "h1:1", https: "h2:2" },
  });
});

test("an empty or malformed proxy server is reported as not configured", () => {
  assert.deepEqual(parseProxyServer(""), { all: null, byScheme: {} });
  assert.deepEqual(parseProxyServer(undefined), { all: null, byScheme: {} });
});

test("the <local> macro expands to loopback and loopback is always present", () => {
  const entries = parseProxyOverride("*.corp.local;10.*;<local>");
  assert.ok(entries.includes("*.corp.local"));
  assert.ok(entries.includes("10.*"));
  assert.ok(entries.includes("127.0.0.1"));
  assert.ok(entries.includes("localhost"));
  assert.ok(entries.includes("::1"));
});

test("loopback is added even without an override list", () => {
  const entries = parseProxyOverride("");
  assert.deepEqual(entries, ["127.0.0.1", "localhost", "::1"]);
});

test("the override list is de-duplicated", () => {
  const entries = parseProxyOverride("localhost;localhost;127.0.0.1");
  assert.equal(entries.length, new Set(entries).size);
});

test("a disabled system proxy resolves to nothing with a reason", () => {
  const derived = proxyVarsFromRegistry({ ProxyEnable: 0, ProxyServer: "proxy.corp:8080" });
  assert.equal(derived.vars, null);
  assert.equal(derived.reason, "disabled");
});

test("an enabled system proxy becomes usable variables", () => {
  const derived = proxyVarsFromRegistry({
    ProxyEnable: 1,
    ProxyServer: "proxy.corp:8080",
    ProxyOverride: "<local>",
  });
  assert.equal(derived.vars.HTTP_PROXY, "http://proxy.corp:8080");
  assert.equal(derived.vars.HTTPS_PROXY, "http://proxy.corp:8080");
  assert.match(derived.vars.NO_PROXY, /127\.0\.0\.1/);
});

test("per-protocol system entries are honoured", () => {
  const derived = proxyVarsFromRegistry({
    ProxyEnable: 1,
    ProxyServer: "http=h1:1;https=h2:2",
  });
  assert.equal(derived.vars.HTTP_PROXY, "http://h1:1");
  assert.equal(derived.vars.HTTPS_PROXY, "http://h2:2");
});

test("a PAC-only configuration is reported instead of silently ignored", () => {
  const derived = proxyVarsFromRegistry({
    ProxyEnable: 1,
    ProxyServer: "",
    AutoConfigURL: "http://wpad/wpad.dat",
  });
  assert.equal(derived.vars, null);
  assert.equal(derived.reason, "pac-only");
});

test("a socks-only configuration is reported instead of silently ignored", () => {
  const derived = proxyVarsFromRegistry({ ProxyEnable: 1, ProxyServer: "socks=s1:1080" });
  assert.equal(derived.vars, null);
  assert.equal(derived.reason, "socks-only");
});

test("an enabled proxy with no address is reported", () => {
  const derived = proxyVarsFromRegistry({ ProxyEnable: 1, ProxyServer: "" });
  assert.equal(derived.vars, null);
  assert.equal(derived.reason, "empty-server");
});

test("the system proxy view never contains a password", () => {
  const view = describeSystemProxy({
    ProxyEnable: 1,
    ProxyServer: "http://alice:s3cret@proxy.corp:8080",
    ProxyOverride: "<local>",
  });
  assert.equal(view.enabled, true);
  assert.equal(view.hasServer, true);
  assert.equal(view.server.includes("s3cret"), false);
  assert.match(view.server, /<redacted>/);
});

test("mode off never produces proxy variables", () => {
  const resolved = buildProxyVars({ mode: "off" }, null, { env: {} });
  assert.equal(resolved.vars, null);
  assert.equal(resolved.source, "off");
});

test("mode env reads the uppercase variables", () => {
  const resolved = buildProxyVars({ mode: "env" }, null, {
    env: { HTTP_PROXY: " http://a:1 ", HTTPS_PROXY: "http://b:2", NO_PROXY: "x.com" },
  });
  assert.equal(resolved.vars.HTTP_PROXY, "http://a:1");
  assert.equal(resolved.vars.HTTPS_PROXY, "http://b:2");
  assert.equal(resolved.vars.NO_PROXY, "x.com");
  assert.equal(resolved.reason, null);
});

test("mode env with no variables explains itself", () => {
  const resolved = buildProxyVars({ mode: "env" }, null, { env: {} });
  assert.equal(resolved.vars, null);
  assert.equal(resolved.reason, "no-env-vars");
  assert.equal(resolved.notes.length, 1);
});

test("only http and https proxy schemes can be used at all", () => {
  assert.equal(proxySchemeSupported("http://proxy.corp:8080"), true);
  assert.equal(proxySchemeSupported("https://proxy.corp:8080"), true);
  // The bare shape users paste and the registry stores.
  assert.equal(proxySchemeSupported("proxy.corp:8080"), true);
  assert.equal(proxySchemeSupported("127.0.0.1:7890"), true);
  // Node's EnvHttpProxyAgent throws on these from pre_execution, so the daemon
  // dies before it can listen and the message never mentions the proxy.
  assert.equal(proxySchemeSupported("socks5://proxy.corp:1080"), false);
  assert.equal(proxySchemeSupported("socks4://proxy.corp:1080"), false);
  assert.equal(proxySchemeSupported("SOCKS5://PROXY.CORP:1080"), false);
  assert.equal(proxySchemeSupported("ftp://proxy.corp:21"), false);
  assert.equal(proxySchemeSupported(""), false);
  assert.equal(proxySchemeSupported(null), false);
});

test("a SOCKS environment proxy is dropped instead of crashing the daemon", () => {
  const resolved = buildProxyVars({ mode: "env" }, null, {
    env: { HTTP_PROXY: "socks5://proxy.corp:1080", HTTPS_PROXY: "socks5://proxy.corp:1080" },
  });
  assert.equal(resolved.vars, null);
  assert.equal(resolved.reason, "unsupported-scheme");
  assert.equal(resolved.notes.length, 1);
});

test("a usable environment proxy still resolves when its sibling is SOCKS", () => {
  const resolved = buildProxyVars({ mode: "env" }, null, {
    env: { HTTP_PROXY: "socks5://proxy.corp:1080", HTTPS_PROXY: "http://proxy.corp:8080" },
  });
  assert.equal(resolved.reason, null);
  assert.equal(resolved.vars.HTTPS_PROXY, "http://proxy.corp:8080");
  assert.equal(resolved.vars.HTTP_PROXY, undefined);
});

test("the manual mode refuses a SOCKS address rather than forwarding it", () => {
  const resolved = buildProxyVars({ mode: "manual", url: "socks5://proxy.corp:1080" }, null, {
    env: {},
  });
  assert.equal(resolved.vars, null);
  assert.equal(resolved.reason, "unsupported-scheme");
});

test("a bare manual address is still normalized to http", () => {
  const resolved = buildProxyVars({ mode: "manual", url: "proxy.corp:8080" }, null, { env: {} });
  assert.equal(resolved.reason, null);
  assert.equal(resolved.vars.HTTPS_PROXY, "http://proxy.corp:8080");
});

test("mode manual uses the configured address for both schemes", () => {
  const resolved = buildProxyVars(
    { mode: "manual", url: "127.0.0.1:7890", noProxy: "corp.local" },
    null,
    { env: {} },
  );
  assert.equal(resolved.vars.HTTP_PROXY, "http://127.0.0.1:7890");
  assert.equal(resolved.vars.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(resolved.vars.NO_PROXY, "corp.local");
});

test("mode manual with an empty address explains itself", () => {
  const resolved = buildProxyVars({ mode: "manual", url: null }, null, { env: {} });
  assert.equal(resolved.vars, null);
  assert.equal(resolved.reason, "manual-url-missing");
});

test("mode system uses the registry snapshot that was read for it", () => {
  const read = { available: true, snapshot: { ProxyEnable: 1, ProxyServer: "p:1" }, error: null };
  const resolved = buildProxyVars({ mode: "system", url: null, noProxy: "corp.local" }, read, {
    env: {},
  });
  assert.equal(resolved.vars.HTTP_PROXY, "http://p:1");
  assert.match(resolved.vars.NO_PROXY, /corp\.local/);
  assert.match(resolved.vars.NO_PROXY, /127\.0\.0\.1/);
});

test("mode system with an unreadable registry explains itself", () => {
  const resolved = buildProxyVars({ mode: "system" }, { available: false, error: "blocked" }, {
    env: {},
  });
  assert.equal(resolved.vars, null);
  assert.equal(resolved.reason, "read-failed");
  assert.ok(resolved.notes.some((note) => note.includes("blocked")));
});
