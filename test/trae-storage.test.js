import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAuthSnapshot,
  extractIdentityFromSnapshot,
  maskAccountValue,
  traeStorageKeys,
  validateAuthSnapshot,
} from "../src/lib/trae-storage.js";

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

test("account values are masked for the public API", () => {
  assert.equal(maskAccountValue("1026288307407252"), "************7252");
  assert.equal(maskAccountValue("tester@example.com"), "te***@example.com");
});

