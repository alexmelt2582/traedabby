/**
 * Whether a newer release of this helper exists on GitHub.
 *
 * The check runs inside the daemon, never in the panel: TRAE's workbench enforces
 * a CSP that blocks HTTP from the injected page, so every network call has to
 * originate here. Nothing about an account or a credential is involved — this
 * only reads a public release page.
 *
 * The release payload is remote content, so it is normalised down to the handful
 * of fields the panel may render, and the download URL is required to point at
 * github.com. A tampered or unexpected payload must not be able to hand the
 * daemon an arbitrary URL to open.
 */
import { requestJson } from "./http.js";

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Parses `v1.2.3` / `1.2.3` into numbers.
 *
 * Returns null for anything else instead of guessing: an unparseable pair must
 * not be reported as "up to date", which is what a silent fallback would do.
 */
export function parseVersion(value) {
  const match = String(value ?? "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns -1, 0 or 1, or null when either side cannot be parsed. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

/** An unparseable version is never "newer", so the panel cannot be told a lie. */
export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) === 1;
}

/**
 * Reduces a GitHub release payload to what the panel renders.
 *
 * `notes` is the raw Markdown body; the panel escapes it and renders a small
 * subset, so this function only has to bound its length.
 */
export function normalizeRelease(payload, { maxNotesLength = 20000 } = {}) {
  const tag = typeof payload?.tag_name === "string" ? payload.tag_name.trim() : "";
  const version = tag.replace(/^v/i, "");
  if (!version || !parseVersion(version)) return null;

  const url = typeof payload?.html_url === "string" ? payload.html_url.trim() : "";
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\//i.test(url)) return null;

  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const body = typeof payload?.body === "string" ? payload.body : "";
  const publishedAt =
    typeof payload?.published_at === "string" && !Number.isNaN(Date.parse(payload.published_at))
      ? new Date(payload.published_at).toISOString()
      : null;

  return {
    version,
    tag,
    title: name || tag,
    notes: body.slice(0, maxNotesLength),
    url,
    publishedAt,
  };
}

/**
 * Reads the newest published release.
 *
 * Failures carry the transport's own `cause` chain (see `requestJson`), because
 * on the machines this ships to an unreachable GitHub is a normal outcome and
 * the panel has to say why rather than showing an empty "no update".
 */
export async function fetchLatestRelease({
  repo,
  requestJsonImpl = requestJson,
  timeoutMs = 15000,
} = {}) {
  if (typeof repo !== "string" || !repo.trim()) {
    throw new Error("未配置 GitHub 仓库，无法检查更新");
  }
  const url = `${GITHUB_API_ORIGIN}/repos/${repo.trim()}/releases/latest`;
  const response = await requestJsonImpl(url, {
    method: "GET",
    headers: { accept: "application/vnd.github+json" },
    timeoutMs,
  });
  if (!response.ok) {
    const hint =
      response.status === 403
        ? "，可能是访问频率限制或网络被拦截"
        : response.status === 404
          ? "，请确认发布页存在"
          : "";
    throw new Error(`检查更新失败：HTTP ${response.status}${hint}`);
  }
  const release = normalizeRelease(response.json);
  if (!release) throw new Error("发布信息无法解析，已忽略这次检查结果");
  return release;
}
