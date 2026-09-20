import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAuthSnapshot,
  extractIdentityFromSnapshot,
  maskAccountValue,
  mergeAuthSnapshot,
  normalizeEmail,
  normalizeAuthSnapshotForInjection,
  sanitizeAuthSnapshotEmails,
  traeStorageKeys,
  validateAuthSnapshot,
} from "../src/lib/trae-storage.js";
import { parseIcubesValue } from "../src/lib/trae-crypto.js";
import { mintDeviceIdentity } from "../src/lib/device-identity.js";

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

test("auth snapshot keeps a valid top-level device identity", () => {
  const identity = mintDeviceIdentity();
  const fixture = storageFixture();
  fixture.deviceIdentity = identity;
  const snapshot = extractAuthSnapshot(fixture, { capturedAt: 123 });
  assert.deepEqual(snapshot.deviceIdentity, identity);
  assert.equal(snapshot.capturedAt, 123);
});

test("auth snapshot omits absent or invalid device identity", () => {
  const snapshot = extractAuthSnapshot(storageFixture());
  assert.equal(Object.hasOwn(snapshot, "deviceIdentity"), false);
  const bad = storageFixture();
  bad.deviceIdentity = { deviceId: "broken" };
  assert.equal(Object.hasOwn(extractAuthSnapshot(bad), "deviceIdentity"), false);
});

test("auth snapshot validation rejects a malformed device identity", () => {
  const snapshot = extractAuthSnapshot(storageFixture());
  snapshot.deviceIdentity = { deviceId: "nope" };
  assert.throws(() => validateAuthSnapshot(snapshot), /invalid device identity/);
});

test("email sanitization and injection preservation keep device identity", () => {
  const identity = mintDeviceIdentity();
  const fixture = storageFixture();
  fixture.deviceIdentity = identity;
  fixture["iCubeAuthInfo://icube.cloudide"] = JSON.stringify({
    userId: "1026288307407252",
    account: { userId: "1026288307407252", username: "tester" },
  });
  const snapshot = extractAuthSnapshot(fixture);
  assert.deepEqual(sanitizeAuthSnapshotEmails(snapshot).deviceIdentity, identity);
  assert.deepEqual(normalizeAuthSnapshotForInjection(snapshot).deviceIdentity, identity);
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

test("sentinel and non-email values normalize to null", () => {
  assert.equal(normalizeEmail("unknown"), null);
  assert.equal(normalizeEmail("N/A"), null);
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(" Tester@Example.COM "), "tester@example.com");
});

test("identity extraction rejects sentinel email values", () => {
  const source = storageFixture();
  source["iCubeAuthInfo://icube.cloudide"] = JSON.stringify({
    userId: "1026288307407252",
    email: "unknown",
    account: {
      userId: "1026288307407252",
      email: "unknown",
      username: "tester",
    },
  });
  source["iCubeServerData://icube.cloudide"] = JSON.stringify({
    account: { userId: "1026288307407252", email: "unknown" },
  });
  const snapshot = extractAuthSnapshot(source);
  assert.equal(extractIdentityFromSnapshot(snapshot).email, null);
  const sanitized = sanitizeAuthSnapshotEmails(snapshot);
  const sanitizedAuth = parseIcubesValue(
    sanitized.keys["iCubeAuthInfo://icube.cloudide"],
  );
  assert.equal(sanitizedAuth.email, "");
  assert.equal(sanitizedAuth.account.email, "");
  assert.equal(
    JSON.parse(sanitized.keys["iCubeServerData://icube.cloudide"]).account.email,
    null,
  );
  assert.deepEqual(sanitizeAuthSnapshotEmails(sanitized), sanitized);
  const normalized = normalizeAuthSnapshotForInjection(snapshot);
  const auth = parseIcubesValue(normalized.keys["iCubeAuthInfo://icube.cloudide"]);
  assert.equal(auth.email, "");
  assert.equal(auth.account.email, "");
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
