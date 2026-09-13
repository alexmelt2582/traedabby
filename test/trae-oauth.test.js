import assert from "node:assert/strict";
import test from "node:test";

import { buildVerificationUri, extractAuthCode } from "../src/lib/trae-oauth.js";

const context = {
  pluginVersion: "2.3.83557",
  clientId: "en1oxy7wnw8j9n",
  machineId: "machine-id",
  deviceId: "1360520616887347",
  deviceBrand: "Windows",
  deviceType: "windows",
  osVersion: "Windows 11",
  env: "",
  appVersion: "0.1.65",
  appType: "stable",
};

test("verification URI matches TRAE SOLO CN authorization parameters", () => {
  const uri = new URL(
    buildVerificationUri(
      context,
      "http://127.0.0.1:4567/authorize",
      "trace-id",
      "challenge-value",
      "https://www.trae.cn",
    ),
  );
  assert.equal(uri.origin, "https://www.trae.cn");
  assert.equal(uri.pathname, "/authorization");
  assert.equal(uri.searchParams.get("auth_from"), "solo");
  assert.equal(uri.searchParams.get("client_id"), "en1oxy7wnw8j9n");
  assert.equal(uri.searchParams.get("redirect"), "0");
  assert.equal(uri.searchParams.get("auth_callback_url"), "http://127.0.0.1:4567/authorize");
  assert.equal(uri.searchParams.get("code_challenge_method"), "S256");
  assert.equal(uri.searchParams.get("hide_saas_login"), "true");
});

test("verification URI normalizes a login host without a scheme", () => {
  const uri = new URL(
    buildVerificationUri(
      context,
      "http://127.0.0.1:4567/authorize",
      "trace-id",
      "challenge-value",
      "www.trae.cn",
    ),
  );
  assert.equal(uri.origin, "https://www.trae.cn");
});

test("auth code callback supports plain and authCodeInfo forms", () => {
  assert.equal(extractAuthCode(new URLSearchParams({ authCode: "code-1" })), "code-1");
  assert.equal(
    extractAuthCode(
      new URLSearchParams({
        authCodeInfo: JSON.stringify({
          AuthCode: "code-2",
          ExpireAt: Date.now() + 60_000,
        }),
      }),
    ),
    "code-2",
  );
});

test("expired authCodeInfo is rejected", () => {
  assert.throws(
    () =>
      extractAuthCode(
        new URLSearchParams({
          authCodeInfo: JSON.stringify({
            AuthCode: "expired",
            ExpireAt: Date.now() - 1,
          }),
        }),
      ),
    /expired/,
  );
});
