/**
 * Makes this process trust the root certificates installed in the Windows store.
 *
 * Node ships its own root list and ignores the operating system's. On a network
 * whose proxy decrypts TLS, that difference *is* the whole failure: Chromium —
 * and therefore TRAE itself — accepts the proxy's re-signed certificate because
 * it reads the system store, while every request from this project dies with
 * `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Adding the system roots makes the two
 * agree instead of leaving the helper as the only program that cannot connect.
 *
 * This is not a relaxation of verification, and it must never be turned into
 * one. `NODE_TLS_REJECT_UNAUTHORIZED=0` accepts any certificate; this only
 * widens the set of roots an otherwise complete chain may terminate at, to the
 * same set Chromium already uses on the same machine. The chain itself is still
 * validated in full.
 *
 * The effect is per process and applies only to connections opened after the
 * call, so every entry point that reaches the network calls it once, before its
 * first request.
 *
 * Verified on Node 22.22.2: `getCACertificates("system")` returns the store
 * without any CLI flag, and merging it raises the default set from 144 to 260 —
 * the same count `--use-system-ca` produces. A local self-signed HTTPS server
 * proves the runtime call really reaches `fetch`: the request fails with
 * `DEPTH_ZERO_SELF_SIGNED_CERT` before the call and succeeds after it. Using the
 * API rather than the flag keeps this working for a directly launched
 * `TraeEnhancer.exe net`, which never inherits a spawn environment.
 */
import tls from "node:tls";

/** Cached so repeated calls are free and the reported numbers stay stable. */
let applied = null;

/**
 * Idempotent. Never throws: a process that cannot read the system store simply
 * keeps Node's own roots, which is the behaviour every version before this had.
 */
export function enableSystemCACertificates() {
  if (applied) return applied;
  if (
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    applied = { enabled: false, reason: "unsupported", bundled: 0, added: 0 };
    return applied;
  }
  try {
    const bundled = tls.getCACertificates("default");
    const merged = [...new Set([...bundled, ...tls.getCACertificates("system")])];
    const added = merged.length - bundled.length;
    if (added > 0) tls.setDefaultCACertificates(merged);
    applied = { enabled: true, reason: null, bundled: bundled.length, added };
    return applied;
  } catch (error) {
    applied = {
      enabled: false,
      reason: error instanceof Error ? error.message : String(error),
      bundled: 0,
      added: 0,
    };
    return applied;
  }
}

/** One line for the diagnostic report, so a certificate problem is visible. */
export function formatCAStatus(status) {
  if (!status?.enabled) {
    return `未启用（原因：${status?.reason ?? "unknown"}）`;
  }
  return status.added > 0
    ? `已信任系统证书（内置 ${status.bundled} 条 + 系统 ${status.added} 条）`
    : "已信任系统证书（系统中没有额外的根证书）";
}
