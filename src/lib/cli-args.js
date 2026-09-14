/**
 * Argument parsing shared by the service CLI and its bundled executable.
 *
 * The bundled build re-enters itself with an `--internal-*` switch that can land
 * before the command, so arguments must not be read by fixed position. These
 * helpers are kept out of `scripts/service.js` because importing that module runs
 * the CLI, which would make the parsing impossible to unit test.
 *
 * `drop` is 2 for both shapes: Node passes `[execPath, scriptPath, ...args]`,
 * and a single executable passes `[execPath, <embedded script name>, ...args]`.
 */
export const INTERNAL_FLAG_PREFIX = "--internal-";

export function commandArguments(argv, { drop = 2 } = {}) {
  return argv
    .slice(drop)
    .filter((argument) => !String(argument).startsWith(INTERNAL_FLAG_PREFIX))
    .map(String);
}

export function parseServiceArgs(argv, { drop = 2, defaultCommand = "start" } = {}) {
  const args = commandArguments(argv, { drop });
  const hasCommand = args.length > 0 && !args[0].startsWith("-");
  return {
    args,
    hasCommand,
    command: (hasCommand ? args[0] : defaultCommand).toLowerCase(),
    rest: hasCommand ? args.slice(1) : [],
  };
}

/** Reads the value that follows a named flag, or null. */
export function flagValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}
