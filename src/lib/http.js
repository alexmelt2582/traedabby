export async function requestJson(
  url,
  {
    method = "POST",
    headers = {},
    body,
    timeoutMs = 20000,
  } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "follow",
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

