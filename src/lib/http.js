import { fetch as undiciFetch } from "undici";

import { describeErrorChain, redactUrl } from "./net-diagnostics.js";
import { getDispatcherFor } from "./proxy-runtime.js";

/**
 * Every outbound request in this daemon goes through here, which is what makes a
 * single dispatcher enough to route the whole program.
 *
 * The npm `undici` package is used rather than Node's global `fetch`: a
 * dispatcher built by npm undici cannot be handed to the built-in fetch, so the
 * two have to come from the same copy. Loopback callers keep the global fetch
 * (see `launcher.js`, `watchdog.js` and the injected panel) and never touch a
 * proxy.
 */
export async function requestJson(
  url,
  {
    method = "POST",
    headers = {},
    body,
    timeoutMs = 20000,
    dispatcher,
  } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const activeDispatcher = dispatcher === undefined ? getDispatcherFor(url) : dispatcher;
  try {
    const response = await undiciFetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "follow",
      ...(activeDispatcher ? { dispatcher: activeDispatcher } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Preserve non-JSON responses for callers that only need status/error metadata.
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  } catch (error) {
    /**
     * A bare `fetch failed` tells nobody anything: Node puts the real reason in
     * `error.cause`. The label keeps the method and the host and strips every
     * query value, because `did` carries an account identifier.
     */
    const label = `${method} ${redactUrl(url)}`;
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
    const wrapped = new Error(
      timedOut
        ? `${label} 超时（${timeoutMs}ms）`
        : `${label} 失败 → ${describeErrorChain(error)}`,
      { cause: error },
    );
    if (timedOut) wrapped.timedOut = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

export function pickPath(root, path) {
  let current = root;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

export function pickString(root, paths) {
  for (const path of paths) {
    const value = pickPath(root, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function pickNumber(root, paths) {
  for (const path of paths) {
    const value = pickPath(root, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      return Number(value.trim());
    }
  }
  return null;
}

export function safeRemoteError(response) {
  const error = response.json;
  const message =
    pickString(error, [
      ["ResponseMetadata", "Error", "Message"],
      ["error", "message"],
      ["message"],
      ["msg"],
      ["Result", "Message"],
    ]) ||
    (response.text ? `response length ${response.text.length}` : "empty response");
  return `HTTP ${response.status}: ${message}`;
}

