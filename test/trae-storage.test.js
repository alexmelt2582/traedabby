import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAuthSnapshot,
  extractIdentityFromSnapshot,
  maskAccountValue,
  mergeAuthSnapshot,
  normalizeAuthSnapshotForInjection,
  traeStorageKeys,
  validateAuthSnapshot,
} from "../src/lib/trae-storage.js";
import { parseIcubesValue } from "../src/lib/trae-crypto.js";

function storageFixture() {
  return {
    theme: "dark",
    windowsState: { openedWindows: [{ id: 1 }] },
    [traeStorageKeys.USERTAG_KEY]: "encrypted-usertag",
    "iCubeAuthInfo://icube-dc:1360520616887347": "encrypted-device-key",
    "iCubeAuthInfo://icube.cloudide": "encrypted-auth",
    "iCubeServerData://icube.cloudide": JSON.stringify({
      account: {
        userId: "1026288307407252",
        email: "tester@example.com",
      },
    }),
    "iCubeEntitlementInfo://icube.cloudide": JSON.stringify({
      entitlement_base_info: {
        user_id: "1026288307407252",
      },
    }),
  };
}

test("auth snapshot keeps only iCube authentication keys", () => {
  const snapshot = extractAuthSnapshot(storageFixture(), { capturedAt: 123 });
  assert.equal(snapshot.capturedAt, 123);
  assert.deepEqual(Object.keys(snapshot.keys).sort(), [
    "iCubeAuthInfo://icube-dc:1360520616887347",
    "iCubeAuthInfo://icube.cloudide",
    "iCubeAuthInfo://usertag",
    "iCubeEntitlementInfo://icube.cloudide",
    "iCubeServerData://icube.cloudide",
  ]);
  assert.equal(Object.hasOwn(snapshot.keys, "theme"), false);
  assert.equal(Object.hasOwn(snapshot.keys, "windowsState"), false);
});

test("auth snapshot accepts entitlement data embedded in server storage", () => {
  const source = storageFixture();
  delete source["iCubeEntitlementInfo://icube.cloudide"];
  source["iCubeServerData://icube.cloudide"] = JSON.stringify({
    account: { userId: "1026288307407252" },
    entitlementInfo: {
      entitlement_base_info: { user_id: "1026288307407252" },
    },
  });

  const snapshot = extractAuthSnapshot(source);
  assert.equal(Object.hasOwn(snapshot.keys, "iCubeEntitlementInfo://icube.cloudide"), false);
  assert.equal(snapshot.keys["iCubeServerData://icube.cloudide"].includes("entitlementInfo"), true);
});

test("auth snapshot validation rejects incomplete states", () => {
  assert.throws(
    () =>
      validateAuthSnapshot({
        schemaVersion: 1,
        keys: {
          "iCubeAuthInfo://icube.cloudide": "auth",
        },
      }),
    /Incomplete TRAE authentication state/,
  );
});

test("identity extraction never uses the device key suffix", () => {
  const snapshot = extractAuthSnapshot(storageFixture());
  const identity = extractIdentityFromSnapshot(snapshot);
  assert.equal(identity.userId, "1026288307407252");
  assert.equal(identity.email, "tester@example.com");
});

test("identity extraction prefers the decrypted auth userId over server data", () => {
  const source = storageFixture();
  source["iCubeAuthInfo://icube.cloudide"] = JSON.stringify({
    userId: "9999999999999999",
  });
  const identity = extractIdentityFromSnapshot(extractAuthSnapshot(source));
  assert.equal(identity.userId, "9999999999999999");
});

test("account values are masked for the public API", () => {
  assert.equal(maskAccountValue("1026288307407252"), "************7252");
  assert.equal(maskAccountValue("tester@example.com"), "te***@example.com");
});

test("merging a snapshot replaces only managed authentication keys", () => {
  const current = storageFixture();
  const target = extractAuthSnapshot(
    {
      ...storageFixture(),
      "iCubeAuthInfo://icube.cloudide": "target-auth",
      "iCubeServerData://icube.cloudide": JSON.stringify({
        account: { userId: "9999999999999999" },
      }),
    },
    { capturedAt: 999 },
  );
  const merged = mergeAuthSnapshot(current, target);
  assert.equal(merged.theme, "dark");
  assert.deepEqual(merged.windowsState, { openedWindows: [{ id: 1 }] });
  assert.equal(merged["iCubeAuthInfo://icube.cloudide"], "target-auth");
  assert.equal(merged["iCubeAuthInfo://icube-dc:1360520616887347"], "encrypted-device-key");
});

test("injection normalization restores fields required by the TRAE login manager", () => {
  const source = storageFixture();
  source["iCubeAuthInfo://icube.cloudide"] = JSON.stringify({
    accessToken: "access",
    refreshToken: "refresh",
    userId: "1026288307407252",
    deviceKeyPair: { privateKeyPEM: "private", publicKeyPEM: "public" },
    account: { userId: "1026288307407252", username: "tester" },
  });
  const normalized = normalizeAuthSnapshotForInjection(extractAuthSnapshot(source));
  const auth = parseIcubesValue(normalized.keys["iCubeAuthInfo://icube.cloudide"]);
  assert.equal(auth.account.scope, "marscode");
  assert.equal(auth.account.loginScope, "trae");
  assert.equal(auth.account.storeRegion, "CN");
  assert.equal(auth.account.userTag, "row");
  assert.equal(auth.token, "access");
});
