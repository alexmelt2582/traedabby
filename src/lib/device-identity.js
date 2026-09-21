import crypto from "node:crypto";
import os from "node:os";

/**
 * Account-level device identity.
 *
 * Each saved account carries one fixed device identity (deviceId, machineId,
 * the hard fingerprint fields, and the matching EC key pair). It is created once
 * at the first login of an account, stored on the account snapshot as the
 * top-level `deviceIdentity` field, and reused by both login and refresh so an
 * account stops advertising a brand-new random device on every sign-in.
 *
 * Deleting an account deletes its snapshot together with this identity; a later
 * re-login simply mints a fresh one (no independent device vault is kept).
 */

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isKeyPairPem({ privateKeyPEM, publicKeyPEM }) {
  return (
    typeof privateKeyPEM === "string" &&
    privateKeyPEM.includes("PRIVATE KEY") &&
    typeof publicKeyPEM === "string" &&
    publicKeyPEM.includes("PUBLIC KEY")
  );
}

function isDeviceId(value) {
  return typeof value === "string" && /^\d{8,24}$/.test(value);
}

function isMachineId(value) {
  return typeof value === "string" && /^[\da-fA-F]{32}$/.test(value);
}

/** Returns true when the value is a complete, storeable device identity. */
export function isDeviceIdentity(value) {
  if (!object(value)) return false;
  if (!isDeviceId(value.deviceId)) return false;
  if (!isMachineId(value.machineId)) return false;
  if (!text(value.deviceName)) return false;
  if (!text(value.deviceType)) return false;
  if (!text(value.osVersion)) return false;
  return isKeyPairPem(value);
}

/** Reads the stored identity from an account snapshot, or null when absent/invalid. */
export function readDeviceIdentity(snapshot) {
  if (!object(snapshot) || !isDeviceIdentity(snapshot.deviceIdentity)) return null;
  return snapshot.deviceIdentity;
}

/**
 * Mints a brand-new device identity from the machine context.
 *
 * deviceId uses Number bounds (10 ** 15 / 10 ** 16), never BigInt, to stay
 * compatible with crypto.randomInt. The key pair reuses the same prime256v1
 * scheme the auth exchange uses.
 */
export function mintDeviceIdentity(context = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    // A fixed 15-digit width with a random tail, because crypto.randomInt caps
    // the range span at 2**48 - 1 and 10**16 is not a safe integer.
    deviceId: (10 ** 14 + crypto.randomInt(281474976710655)).toString(),
    machineId: crypto.randomUUID().replaceAll("-", ""),
    deviceName: os.hostname() || "PC",
    deviceBrand: process.env.PROCESSOR_IDENTIFIER || "Windows",
    deviceType: "windows",
    osVersion: `${os.type()} ${os.release()}`,
    privateKeyPEM: privateKey,
    publicKeyPEM: publicKey,
  };
}

/**
 * Seeds a login context with a fixed identity so the exchange reuses its
 * deviceId/machineId/fingerprint and key pair instead of randomizing them.
 */
export function applyDeviceIdentity(context, identity) {
  context.deviceId = identity.deviceId;
  context.machineId = identity.machineId;
  context.deviceName = identity.deviceName;
  context.deviceBrand = identity.deviceBrand;
  context.deviceType = identity.deviceType;
  context.osVersion = identity.osVersion;
  context.keyPair = {
    privateKeyPEM: identity.privateKeyPEM,
    publicKeyPEM: identity.publicKeyPEM,
  };
  return context;
}

/**
 * Serializes a fixed identity into the shape stored on the snapshot top level.
 */
export function deviceIdentityRecord(identity) {
  return {
    deviceId: identity.deviceId,
    machineId: identity.machineId,
    deviceName: identity.deviceName,
    deviceBrand: identity.deviceBrand,
    deviceType: identity.deviceType,
    osVersion: identity.osVersion,
    privateKeyPEM: identity.privateKeyPEM ?? identity.keyPair?.privateKeyPEM,
    publicKeyPEM: identity.publicKeyPEM ?? identity.keyPair?.publicKeyPEM,
  };
}