import assert from "node:assert/strict";
import test from "node:test";

import {
  PROXY_REASON_TEXT,
  describeSystemProxy,
  mergeNoProxy,
  parseHostPort,
  parseNoProxyField,
  parseProxyOverride,
  parseProxyServer,
  redactProxyUrl,
  resolveProxyTarget,
  splitCredentials,
  targetFromRegistry,
} from "../src/lib/system-proxy.js";

function registry(overrides = {}) {
  return {
    ProxyEnable: 1,
    ProxyServer: "",
    ProxyOverride: "",
    AutoConfigURL: "",
    ...overrides,
  };
}

test("a bare server applies to every protocol", () => {
  const parsed = parseProxyServer("proxy.corp.example.com:8080");
  assert.equal(parsed.all, "proxy.corp.example.com:8080");
  assert.deepEqual(parsed.byScheme, {});
});

test("per-protocol assignments are read by key", () => {
  const parsed = parseProxyServer("http=h:1;https=h:2;socks5=h:3;ftp=h:4");
  assert.deepEqual(parsed.byScheme, { http: "h:1", https: "h:2", socks5: "h:3", ftp: "h:4" });
  assert.equal(parsed.all, null);
});

test("an unassigned segment beside assignments stays usable as the generic entry", () => {
  const parsed = parseProxyServer("http=h:1;bare:9");
  assert.equal(parsed.byScheme.http, "h:1");
  assert.equal(parsed.all, "bare:9");
});

test("host:port parsing tolerates the bracketed IPv6 form and refuses half an address", () => {
  assert.deepEqual(parseHostPort("127.0.0.1:7890"), { host: "127.0.0.1", port: 7890 });
  assert.deepEqual(parseHostPort("[::1]:7890"), { host: "::1", port: 7890 });
  assert.equal(parseHostPort("127.0.0.1"), null);
  assert.equal(parseHostPort("127.0.0.1:0"), null);
  assert.equal(parseHostPort("127.0.0.1:70000"), null);
  assert.equal(parseHostPort(":7890"), null);
  assert.equal(parseHostPort(""), null);
});

test("<local> expands to loopback, and duplicate entries collapse", () => {
  assert.deepEqual(parseProxyOverride("<local>;*.corp.example.com;*.corp.example.com"), [
    "127.0.0.1",
    "localhost",
    "::1",
    "*.corp.example.com",
  ]);
});

test("loopback is always present in the exception list", () => {
  const merged = mergeNoProxy(["*"], []);
  assert.deepEqual(merged, ["*", "127.0.0.1", "localhost", "::1"]);
  assert.deepEqual(parseNoProxyField(" a , b , a ,, "), ["a", "b"]);
});

test("a credentials-bearing proxy URL is redacted wherever it appears", () => {
  assert.equal(redactProxyUrl("http://alice:pw@h:1"), "http://alice:<redacted>@h:1");
  assert.equal(redactProxyUrl("alice:pw@h:1"), "alice:<redacted>@h:1");
  // The chained form is what the registry actually stores, and missing the
  // second segment is exactly how a password ends up in a log.
  assert.equal(
    redactProxyUrl("http=alice:pw@h:1;https=alice:pw@h:2"),
    "http=alice:<redacted>@h:1;https=alice:<redacted>@h:2",
  );
  assert.equal(redactProxyUrl("http://h:1"), "http://h:1");
  assert.equal(redactProxyUrl(""), "");
});

test("credentials embedded in the registry value are lifted out of the host", () => {
  // Tools do write `user:pass@host:port` into ProxyServer. Left in place the
  // password would become part of `host`, which the panel renders and the daemon
  // logs, so it is separated out here.
  assert.deepEqual(splitCredentials("alice:p%40ss@h:8080"), {
    address: "h:8080",
    username: "alice",
    password: "p@ss",
  });
  assert.deepEqual(splitCredentials("h:8080"), { address: "h:8080", username: "", password: "" });
  // A malformed escape must not throw; the raw text is better than a crash.
  assert.deepEqual(splitCredentials("alice:100%@h:1"), {
    address: "h:1",
    username: "alice",
    password: "100%",
  });

  assert.deepEqual(
    resolveProxyTarget({ mode: "system", noProxy: "" }, { available: true, snapshot: registry({ ProxyServer: "alice:pw@h:8080" }) }),
    {
      source: "system",
      target: { scheme: "http", host: "h", port: 8080, username: "alice", password: "pw" },
      noProxy: ["127.0.0.1", "localhost", "::1"],
      reason: null,
      notes: [],
    },
  );
});

test("a disabled system proxy resolves to nothing, and says whether a PAC explains it", () => {
  assert.deepEqual(targetFromRegistry(registry({ ProxyEnable: 0 })), {
    target: null,
    reason: "disabled",
  });
  assert.deepEqual(
    targetFromRegistry(registry({ ProxyEnable: 0, AutoConfigURL: "http://pac/proxy.pac" })),
    { target: null, reason: "pac-only" },
  );
});

test("an enabled but empty system proxy is named as such", () => {
  assert.deepEqual(targetFromRegistry(registry({ ProxyServer: "  " })), {
    target: null,
    reason: "empty-server",
  });
  assert.deepEqual(targetFromRegistry(registry({ AutoConfigURL: "http://pac/p.pac" })), {
    target: null,
    reason: "pac-only",
  });
});

test("https is preferred, then http, then socks, and socks4 is refused by name", () => {
  const bare = { username: "", password: "" };
  assert.deepEqual(targetFromRegistry(registry({ ProxyServer: "http=h:1;https=h:2" })), {
    target: { scheme: "http", host: "h", port: 2, ...bare },
    reason: null,
  });
  assert.deepEqual(targetFromRegistry(registry({ ProxyServer: "http=h:1" })), {
    target: { scheme: "http", host: "h", port: 1, ...bare },
    reason: null,
  });
  assert.deepEqual(targetFromRegistry(registry({ ProxyServer: "socks5=h:3" })), {
    target: { scheme: "socks5", host: "h", port: 3, ...bare },
    reason: null,
  });
  assert.deepEqual(targetFromRegistry(registry({ ProxyServer: "socks=h:4" })), {
    target: null,
    reason: "socks-v4-unsupported",
  });
});

test("the off mode never reads the registry and never carries an exception list", () => {
  const resolved = resolveProxyTarget({ mode: "off" }, null);
  assert.equal(resolved.source, "off");
  assert.equal(resolved.target, null);
  assert.deepEqual(resolved.noProxy, []);
  assert.deepEqual(resolved.notes, [PROXY_REASON_TEXT.off]);
});

test("a custom proxy must be complete before it can produce a target", () => {
  const incomplete = resolveProxyTarget({ mode: "custom", host: "", port: 0 }, null);
  assert.equal(incomplete.reason, "custom-incomplete");
  assert.equal(incomplete.target, null);
  // The exception list survives an incomplete save so the user does not lose it.
  assert.deepEqual(incomplete.noProxy, ["127.0.0.1", "localhost", "::1"]);

  const complete = resolveProxyTarget(
    {
      mode: "custom",
      scheme: "socks5",
      host: "127.0.0.1",
      port: 7891,
      username: "alice",
      password: "s3cret",
      noProxy: "*.corp.example.com",
    },
    null,
  );
  assert.equal(complete.reason, null);
  assert.deepEqual(complete.target, {
    scheme: "socks5",
    host: "127.0.0.1",
    port: 7891,
    username: "alice",
    password: "s3cret",
  });
  assert.deepEqual(complete.noProxy, ["*.corp.example.com", "127.0.0.1", "localhost", "::1"]);
});

test("system mode combines the registry exceptions with the user's own", () => {
  const read = {
    available: true,
    error: null,
    snapshot: registry({ ProxyServer: "h:8080", ProxyOverride: "<local>;*.corp.example.com" }),
  };
  const resolved = resolveProxyTarget({ mode: "system", noProxy: "extra.example.com" }, read);
  assert.deepEqual(resolved.target, { scheme: "http", host: "h", port: 8080, username: "", password: "" });
  assert.deepEqual(resolved.noProxy, [
    "127.0.0.1",
    "localhost",
    "::1",
    "*.corp.example.com",
    "extra.example.com",
  ]);
  assert.equal(resolved.reason, null);
});

test("a registry read that failed is reported, never treated as 'no proxy'", () => {
  const resolved = resolveProxyTarget(
    { mode: "system" },
    { available: false, error: "powershell blocked by policy", snapshot: {} },
  );
  assert.equal(resolved.reason, "read-failed");
  assert.equal(resolved.target, null);
  assert.match(resolved.notes.join(" "), /powershell blocked by policy/);
});

test("the system snapshot shown to the panel never contains a password", () => {
  const described = describeSystemProxy(
    registry({
      ProxyServer: "http=alice:pw@h:1;https=alice:pw@h:2",
      AutoConfigURL: "http://alice:pw@pac/p.pac",
    }),
  );
  assert.equal(described.enabled, true);
  assert.equal(described.hasServer, true);
  assert.equal(described.hasAutoConfigUrl, true);
  const serialized = JSON.stringify(described);
  assert.equal(serialized.includes("pw@"), false);
  assert.match(described.server, /alice:<redacted>@h:1/);
  assert.match(described.server, /alice:<redacted>@h:2/);
  assert.match(described.autoConfigUrl, /alice:<redacted>@pac/);
});