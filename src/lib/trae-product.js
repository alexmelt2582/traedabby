import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseIcubesValue } from "./trae-crypto.js";

const DEFAULT_CLIENT_ID = "en1oxy7wnw8j9n";
const DEFAULT_APP_VERSION = "3.5.54";

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

async function readJson(filePath, required = false) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readProductInfo(exePath) {
  if (!exePath) return {};
  const productPath = path.join(path.dirname(exePath), "resources", "app", "product.json");
  const root = await readJson(productPath);
  if (!root) return {};
  const appType = firstString(root.quality, "stable").toLowerCase();
  const authConfig = root.iCubeApp?.authConfig?.SOLO || {};
  return {
    clientId: firstString(authConfig[appType], authConfig.stable, ...Object.values(authConfig)),
    pluginVersion: firstString(root.tronBuildVersion, root.buildVersion, root.productVersion),
    appVersion: firstString(root.appVersion, root.productVersion, root.version),
    appType,
    accountApi: firstString(
      root.bootConfig?.account?.trae?.normal,
      root.bootConfig?.account?.trae?.NORMAL,
      "https://api.trae.cn",
    ),
    authDomain: "www.trae.cn",
  };
}

function getStorageString(storageRoot, key) {
  const value = storageRoot?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDeviceId(storageRoot) {
  for (const key of Object.keys(storageRoot || {})) {
    const match = /^iCubeAuthInfo:\/\/icube-dc:(\d{8,24})$/.exec(key);
    if (match) return match[1];
  }
  const direct = firstString(
    storageRoot?.device_id,
    storageRoot?.deviceId,
    storageRoot?.x_device_id,
  );
  return direct && /^\d{8,24}$/.test(direct) ? direct : null;
}

function parseAuthIdentity(storageRoot) {
  const raw = storageRoot?.["iCubeAuthInfo://icube.cloudide"];
  if (typeof raw !== "string") return {};
  try {
    const auth = parseIcubesValue(raw);
    return {
      userId: firstString(auth?.userId, auth?.user_id, auth?.uid),
      email: firstString(auth?.email, auth?.account?.email),
      nickname: firstString(auth?.nickname, auth?.account?.username, auth?.account?.name),
    };
  } catch {
    return {};
  }
}

export async function collectLoginContext({ exePath, storageRoot }) {
  const product = await readProductInfo(exePath);
  const authIdentity = parseAuthIdentity(storageRoot);
  const deviceId = parseDeviceId(storageRoot) || crypto.randomInt(10n ** 15n, 10n ** 16n).toString();
  const machineId =
    getStorageString(storageRoot, "telemetry.machineId") || crypto.randomUUID().replaceAll("-", "");
  const appVersion = firstString(product.appVersion, product.pluginVersion, DEFAULT_APP_VERSION);
  const deviceType = "windows";
  const deviceBrand = firstString(process.env.PROCESSOR_IDENTIFIER, "Windows");

  return {
    clientId: product.clientId || DEFAULT_CLIENT_ID,
    pluginVersion: firstString(product.pluginVersion, getStorageString(storageRoot, "iCubeLastVersion"), "local"),
    appVersion,
    appType: product.appType || "stable",
    accountApi: product.accountApi || "https://api.trae.cn",
    authDomain: product.authDomain || "www.trae.cn",
    machineId,
    deviceId,
    deviceName: os.hostname() || "PC",
    deviceBrand,
    deviceType,
    osVersion: `${os.type()} ${os.release()}`,
    env: getStorageString(storageRoot, "ai_assistant.request.env") || "",
    identity: {
      userId: firstString(authIdentity.userId),
      email: firstString(authIdentity.email),
      nickname: firstString(authIdentity.nickname),
    },
  };
}

export function buildDeviceInfo(context, publicKeyPem) {
  return {
    DeviceID: context.deviceId,
    MachineID: context.machineId,
    PlatformCode: "SOLO_PC",
    DeviceType: "PC",
    DeviceName: context.deviceName,
    DeviceModel: context.deviceBrand,
    ClientVersion: context.appVersion,
    DevicePublicKey: publicKeyPem,
    DeviceBrand: context.deviceBrand,
    DeviceCPU: "",
    OSInfo: context.deviceType,
    OSVersion: context.osVersion,
  };
}

