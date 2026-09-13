import { requestJson, safeRemoteError } from "./http.js";
import { getTraeAuthContext } from "./trae-insights.js";

const CHECKIN_STATUS_PATH = "/trae/api/v2/ug/checkin_credits/status";
const CHECKIN_CLAIM_PATH = "/trae/api/v2/ug/checkin_credits/claim";
const CHECKIN_HOST = "https://api.trae.cn";

function normalize(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function responseRoot(value) {
  if (!value || typeof value !== "object") return {};
  return value.data && typeof value.data === "object" ? value.data : value;
}

function resolveDeviceId(context, deviceId) {
  const resolved = normalize(deviceId) || normalize(context.userId);
  if (!resolved) {
    throw new Error("TRAE snapshot is missing a stable user id for check-in");
  }
  return resolved;
}

function requestHeaders(context, deviceId) {
  return {
    authorization: `Cloud-IDE-JWT ${context.accessToken}`,
    "x-device-id": deviceId,
    origin: "https://www.trae.cn",
    referer: "https://www.trae.cn/",
    "x-app-type": "trae",
    "user-agent": "Trae/1.0.0 antigravity-cockpit-tools",
  };
}

async function requestCheckin(url, context, {
  method = "POST",
  deviceId,
  request = requestJson,
} = {}) {
  const resolvedDeviceId = resolveDeviceId(context, deviceId);
  return await request(url, {
    method,
    ...(method === "GET" ? {} : { body: {} }),
    headers: requestHeaders(context, resolvedDeviceId),
  });
}

export function parseCheckinStatus(response) {
  const root = responseRoot(response?.json);
  return {
    code: optionalNumber(root.code),
    checkedIn: root.checked_in === true,
    checkedInToday: root.checked_in === true,
    credits: optionalNumber(root.credits),
    extraCredits: optionalNumber(root.extra_credits),
    enabled: root.enable !== false,
    message: typeof root.message === "string" ? root.message : "",
  };
}

export function resolveCheckinReward(status, fallback = null) {
  if (Number.isFinite(status?.credits)) return status.credits;
  if (Number.isFinite(fallback?.credits)) return fallback.credits;
  return 0;
}

function throwForAuthFailure(response) {
  if (response.status !== 401 && response.status !== 403 && response.status !== 404) {
    return;
  }
  const error = new Error(safeRemoteError(response));
  error.authExpired = true;
  error.status = response.status;
  throw error;
}

export async function fetchCheckinStatus(snapshot, {
  deviceId,
  request = requestJson,
} = {}) {
  const context = getTraeAuthContext(snapshot);
  const resolvedDeviceId = resolveDeviceId(context, deviceId);
  const url = new URL(`${CHECKIN_HOST}${CHECKIN_STATUS_PATH}`);
  url.searchParams.set("did", resolvedDeviceId);
  const response = await requestCheckin(url.toString(), context, {
    method: "GET",
    deviceId: resolvedDeviceId,
    request,
  });
  throwForAuthFailure(response);
  if (!response.ok) throw new Error(safeRemoteError(response));
  const status = parseCheckinStatus(response);
  if (status.code !== null && status.code !== 0) {
    const error = new Error(status.message || `TRAE check-in status code ${status.code}`);
    error.apiCode = status.code;
    throw error;
  }
  return status;
}

export async function claimCheckin(snapshot, {
  deviceId,
  request = requestJson,
} = {}) {
  const context = getTraeAuthContext(snapshot);
  const response = await requestCheckin(
    `${CHECKIN_HOST}${CHECKIN_CLAIM_PATH}`,
    context,
    {
      method: "POST",
      deviceId,
      request,
    },
  );
  throwForAuthFailure(response);
  if (!response.ok) throw new Error(safeRemoteError(response));
  const result = parseCheckinStatus(response);
  if (result.code !== null && result.code !== 0) {
    const error = new Error(result.message || `TRAE check-in claim code ${result.code}`);
    error.apiCode = result.code;
    error.result = result;
    throw error;
  }
  return result;
}
