import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDeviceIdentity,
  deviceIdentityRecord,
  isDeviceIdentity,
  mintDeviceIdentity,
  readDeviceIdentity,
  recoverDeviceIdentity,
} from "../src/lib/device-identity.js";
import { collectLoginContext } from "../src/lib/trae-product.js";
import { encryptIcubesValue } from "../src/lib/trae-crypto.js";

const DEVICE_PREFIX = "iCubeAuthInfo://icube-dc:";

test("minted identity is complete, stable-shaped and key-pair backed", () => {
  const identity = mintDeviceIdentity();
  assert.equal(isDeviceIdentity(identity), true);
  assert.match(identity.deviceId, /^\d{8,24}$/);
  assert.match(identity.machineId, /^[\da-f]{32}$/);
  assert.equal(identity.deviceType, "windows");
  assert.ok(identity.privateKeyPEM.includes("PRIVATE KEY"), "has private key PEM");
  assert.ok(identity.publicKeyPEM.includes("PUBLIC KEY"), "has public key PEM");
});

test("two minted identities differ (no shared device id or machine id)", () => {
  const first = mintDeviceIdentity();
  const second = mintDeviceIdentity();
  assert.notEqual(first.deviceId, second.deviceId);
  assert.notEqual(first.machineId, second.machineId);
});

test("readDeviceIdentity returns null when absent or invalid", () => {
  assert.equal(readDeviceIdentity(undefined), null);
  assert.equal(readDeviceIdentity({}), null);
  assert.equal(readDeviceIdentity({ deviceIdentity: { deviceId: "short" } }), null);
});

test("readDeviceIdentity returns a stored valid identity", () => {
  const identity = mintDeviceIdentity();
  const snapshot = { schemaVersion: 1, keys: {}, deviceIdentity: identity };
  assert.deepEqual(readDeviceIdentity(snapshot), identity);
});

test("applyDeviceIdentity overrides the context device fields and key pair", () => {
  const identity = mintDeviceIdentity();
  const context = {
    deviceId: "other",
    machineId: "other-machine",
    deviceName: "other",
    keyPair: null,
  };
  applyDeviceIdentity(context, identity);
  assert.equal(context.deviceId, identity.deviceId);
  assert.equal(context.machineId, identity.machineId);
  assert.equal(context.deviceName, identity.deviceName);
  assert.deepEqual(context.keyPair, {
    privateKeyPEM: identity.privateKeyPEM,
    publicKeyPEM: identity.publicKeyPEM,
  });
});

test("deviceIdentityRecord carries exactly the persisted fields", () => {
  const identity = mintDeviceIdentity();
  const record = deviceIdentityRecord(identity);
  assert.equal(record.deviceId, identity.deviceId);
  assert.equal(record.machineId, identity.machineId);
  assert.equal(record.deviceName, identity.deviceName);
  assert.equal(record.deviceBrand, identity.deviceBrand);
  assert.equal(record.deviceType, identity.deviceType);
  assert.equal(record.osVersion, identity.osVersion);
  assert.equal(record.privateKeyPEM, identity.privateKeyPEM);
  assert.equal(record.publicKeyPEM, identity.publicKeyPEM);
});

test("deviceIdentityRecord serializes a login context whose PEMs live in keyPair", () => {
  const identity = mintDeviceIdentity();
  const context = applyDeviceIdentity({}, identity);
  delete context.privateKeyPEM;
  delete context.publicKeyPEM;
  // context carries the PEMs inside keyPair (as collectLoginContext does).
  const record = deviceIdentityRecord(context);
  assert.equal(record.privateKeyPEM, identity.privateKeyPEM);
  assert.equal(record.publicKeyPEM, identity.publicKeyPEM);
  assert.equal(isDeviceIdentity(record), true, "record must be a storeable identity");
});

test("collectLoginContext reuses a provided identity instead of randomizing", async () => {
  const identity = mintDeviceIdentity();
  const context = await collectLoginContext({
    exePath: "",
    storageRoot: {},
    deviceIdentity: identity,
  });
  assert.equal(context.deviceId, identity.deviceId);
  assert.equal(context.machineId, identity.machineId);
  assert.equal(context.deviceName, identity.deviceName);
  assert.deepEqual(context.keyPair, {
    privateKeyPEM: identity.privateKeyPEM,
    publicKeyPEM: identity.publicKeyPEM,
  });
});

test("collectLoginContext mints a fixed identity with a key pair when none is given", async () => {
  const context = await collectLoginContext({ exePath: "", storageRoot: {} });
  assert.match(context.deviceId, /^\d{8,24}$/);
  assert.match(context.machineId, /^[\da-f]{32}$/);
  assert.ok(context.keyPair?.privateKeyPEM, "login context carries a private key");
  assert.ok(context.keyPair?.publicKeyPEM, "login context carries a public key");
  assert.equal(context.deviceType, "windows");
});

test("recoverDeviceIdentity restores the TRAE-bound id and key pair from an adopted snapshot", () => {
  const original = mintDeviceIdentity();
  const snapshot = {
    schemaVersion: 1,
    keys: {
      [DEVICE_PREFIX + original.deviceId]: encryptIcubesValue({
        privateKeyPEM: original.privateKeyPEM,
        publicKeyPEM: original.publicKeyPEM,
      }),
    },
  };
  const recovered = recoverDeviceIdentity(snapshot);
  assert.ok(recovered, "recovers an identity");
  assert.equal(recovered.deviceId, original.deviceId, "keeps the TRAE-bound deviceId");
  assert.equal(recovered.privateKeyPEM, original.privateKeyPEM, "keeps the same private key");
  assert.equal(recovered.publicKeyPEM, original.publicKeyPEM, "keeps the same public key");
  assert.equal(isDeviceIdentity(recovered), true, "recovered identity is storeable and valid");
});

test("recoverDeviceIdentity returns null when no TRAE device key is present", () => {
  assert.equal(recoverDeviceIdentity({}), null);
  assert.equal(recoverDeviceIdentity({ keys: {} }), null);
  assert.equal(recoverDeviceIdentity({ keys: { other: "x" } }), null);
  assert.equal(recoverDeviceIdentity(undefined), null);
});