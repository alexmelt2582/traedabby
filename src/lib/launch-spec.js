/**
 * Every process this project starts goes through a spec, so that the same
 * source tree works both as plain ESM and as a bundled single executable.
 *
 * In a bundle the daemon, the watchdog and the service CLI all live inside the
 * same executable, so they are re-entered through an internal argv switch
 * instead of being spawned as sibling script files.
 */
import {
  APP_ROOT,
  DAEMON_ENTRY_PATH,
  IS_BUNDLED,
  LAUNCHER_ENTRY_PATH,
  SERVICE_ENTRY_PATH,
  WATCHDOG_ENTRY_PATH,
} from "./app-paths.js";

export const INTERNAL_DAEMON_FLAG = "--internal-daemon";
export const INTERNAL_LAUNCHER_FLAG = "--internal-launcher";
export const INTERNAL_SERVICE_FLAG = "--internal-service";
export const INTERNAL_WATCHDOG_FLAG = "--internal-watchdog";

function spec(args) {
  return { command: process.execPath, args, cwd: APP_ROOT };
}

export function daemonSpec() {
  return spec(IS_BUNDLED ? [INTERNAL_DAEMON_FLAG] : [DAEMON_ENTRY_PATH]);
}

export function launcherSpec(extraArgs = []) {
  return spec(
    IS_BUNDLED
      ? [INTERNAL_LAUNCHER_FLAG, ...extraArgs]
      : [LAUNCHER_ENTRY_PATH, ...extraArgs],
  );
}

export function watchdogSpec(extraArgs = []) {
  return spec(IS_BUNDLED ? [INTERNAL_WATCHDOG_FLAG, ...extraArgs] : [WATCHDOG_ENTRY_PATH, ...extraArgs]);
}

export function serviceSpec(command, extraArgs = []) {
  return spec(
    IS_BUNDLED
      ? [INTERNAL_SERVICE_FLAG, command, ...extraArgs]
      : [SERVICE_ENTRY_PATH, command, ...extraArgs],
  );
}

/** Prefix arguments the tray host prepends to a service command. */
export function serviceBaseArgs() {
  return IS_BUNDLED ? [INTERNAL_SERVICE_FLAG] : [SERVICE_ENTRY_PATH];
}

/**
 * Describes how the logon autostart entry should reach the watchdog. A bundled
 * executable has no sibling script, so the entry must use the internal switch
 * and must not fall back to a bare `node.exe`.
 */
export function watchdogAutostartPlan() {
  return IS_BUNDLED
    ? { bundled: true, flags: [INTERNAL_WATCHDOG_FLAG, "--quiet"] }
    : {
        bundled: false,
        relativeScriptPath: "scripts\\watchdog.js",
        flags: ["--quiet"],
      };
}

export function classifyInternal(argv = process.argv) {
  const candidate = Array.isArray(argv) ? argv[2] : null;
  if (candidate === INTERNAL_DAEMON_FLAG) return "daemon";
  if (candidate === INTERNAL_WATCHDOG_FLAG) return "watchdog";
  if (candidate === INTERNAL_SERVICE_FLAG) return "service";
  if (candidate === INTERNAL_LAUNCHER_FLAG) return "launcher";
  return null;
}
