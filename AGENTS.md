# Project Rules

## Product

This repository contains a local enhancement assistant for `TRAE SOLO CN` on Windows.
The assistant must not modify the official installation package or `app.asar`.
It communicates with the running Electron renderer through Chrome DevTools Protocol
and keeps all account data on the local machine.

## Account Model

- Account switching uses the same shared TRAE user-data directory as WorkDaddy.
- A backup contains only TRAE authentication state, not the whole user-data directory.
- The authentication snapshot must include the account-scoped `iCube*` keys and the
  matching device-key/usertag records.
- Non-authentication keys such as workspaces, settings, extensions, and window state
  must be preserved.
- Switching is transactional: validate, back up, atomically replace, verify, and roll
  back on failure.
- Transaction rollback uses in-memory state only. Do not persist raw
  `storage.before.json` or legacy `state.before.vscdb` copies.
- Normalize sentinel identity values such as `unknown` to `null`; never store them
  as account metadata.
- Account exports must always be encrypted with a user-supplied password. Never write
  passwords or plaintext authentication snapshots to disk or logs.
- Check-in requests must use each account's stable `userId` as `x-device-id`. Never
  share one machine-generated device id across accounts.
- Check-in endpoints are served from `https://api.trae.cn`; do not substitute the
  account-specific `loginHost`.
- Keep-alive may rotate credentials only for inactive accounts. The active account
  must be synchronized from the running TRAE storage and must not have its refresh
  token rotated directly from the backup.
- Skip automatic check-in and keep-alive while Cockpit Tools is running. Both tools
  rotating the same refresh tokens can invalidate each other.
- The total check-in reward is `credits`; `extra_credits` is only an additional
  component and must not be displayed as the total.

## Safety

- Bind local services to `127.0.0.1` only.
- Never log or expose access tokens, refresh tokens, cookies, private keys, or complete
  authentication snapshots.
- Only manage processes whose executable path and user-data directory match the
  configured TRAE SOLO CN installation.
- Never close every Electron process or use broad process-name termination.
- Use UTF-8 without BOM for source files and JSON data.
- The background supervisor only ever *starts* the daemon. It never terminates
  anything, so it needs no kill path at all.
- Stopping the service uses two exact pids and nothing else: the daemon pid from
  `/api/health` and the supervisor pid from `data/watchdog.pid`. Before
  terminating, confirm the pid belongs to one of this project's own process
  images; refuse and report rather than guess.
- The project directory may contain non-ASCII characters. Never write that path
  into a `.cmd`, `.vbs`, or `.ps1` source file: create shortcuts through COM
  (UTF-16) and let generated scripts resolve the project root from their own
  location at runtime.
- `scripts/trae-enhancer.cmd`, `scripts/tray.ps1`, and every generated autostart
  script must stay pure ASCII with no BOM. Ask `assertAscii` from
  `src/lib/autostart.js` to enforce it, and keep Chinese display strings in
  `data/tray-config.json` (UTF-8) instead.
- Never pass a path through `JSON.stringify` into VBScript: `\\` is not an escape
  there and silently corrupts the path. Use `vbsQuote`.

## Runtime Invariants

- Git metadata is stored in `.git-meta`; use
  `git --git-dir=.git-meta --work-tree=. ...`.
- The default loopback service is `http://127.0.0.1:47834`; CDP defaults to
  `127.0.0.1:9334`.
- Check-in sweeps every 30 minutes and claims at most once per Asia/Shanghai day.
- Keep-alive sweeps every 30 minutes. Inactive accounts refresh every six hours;
  failures retry after 30 minutes.
- Keep-alive, check-in, account switching, login flows, and insight refresh must be
  mutually exclusive.
- Restarting the daemon requires stopping the exact PID reported by `/api/health`.
  Never terminate all Node or Electron processes.
- The supervisor polls `/api/health` every 15 seconds, restarts the daemon after
  three consecutive failures, and backs off for 60 seconds between attempts.
- `data/`, `logs/`, `dist/`, and `node_modules/` are local state and are never
  committed.

## Packaging Invariants

- `src/lib/app-paths.js` is the only module allowed to read `import.meta`. Node 22
  single-executable applications accept a CommonJS entry only, and esbuild replaces
  `import.meta` with an empty object in that output format. The build injects
  `__APP_BUNDLE_ROOT__` for the bundled case.
- A single executable cannot load sibling scripts from disk. The renderer script
  must be embedded as a SEA asset (`assets` in `sea-config.json`) and read through
  `src/lib/inject-source.js`; never read it from disk in a bundle.
- The daemon, the supervisor, and the service CLI are re-entered through the
  internal argv switches in `src/lib/launch-spec.js`. Without a switch the bundled
  executable behaves exactly like the service CLI, so both entry points agree.
- `npm run build:exe` must verify its own output: the preparation blob has to
  contain the renderer marker, and the produced executable has to answer `status`.
  A build that skips these checks must not be reported as working.
- `npm run build:installer` packages the portable output and must fail when that
  output is missing or incomplete; it never builds the executable itself.
- `scripts/win/trae-enhancer.iss` contains Chinese literals and therefore must stay
  UTF-8 **with BOM**; the build script adds the BOM when it is missing. A BOM-less
  script is read as ANSI by ISCC and the literals become mojibake.
- `scripts/win/ChineseSimplified.isl` is a third-party translation used exactly as
  published; never rewrite its bytes.
- The installer never reads a path back from a subprocess pipe. Node writes UTF-8
  while the installer decodes pipes with the system ANSI code page, so any
  non-ASCII path would be corrupted. Detection happens inside the installer with
  registry and file checks, and a chosen path is passed *to* the executable as a
  command line argument, which is Unicode safe.
- Registry detection for TRAE must match `TRAE SOLO CN` strictly. A looser `TRAE`
  match also selects the unrelated "Trae CN" IDE and breaks every flow that
  restarts TRAE.
- Uninstalling must ask whether to keep user data. `data\` holds account snapshots
  and the API token, so removing it is irreversible and must never be implicit.

## Installer Invariants

- Installer-built installs are per user (`PrivilegesRequired=lowest`) under
  `%LOCALAPPDATA%\Programs`, with the directory page enabled so the location can
  be changed.
- The chosen TRAE path is persisted through
  `TraeEnhancer.exe configure --trae-exe <path>`, which validates the file exists
  before writing `data/config.json`.
- The installer must remove the logon autostart and stop the service before
  deleting files (`[UninstallRun]`), otherwise a supervisor is left running from a
  deleted directory.
- Reinstall and upgrade must stop the old installed service before file replacement.
  The stable Inno `AppId`, previous app directory, and previous task choices must be
  preserved so account data and autostart preference survive an upgrade.
- Interactive uninstall asks whether to keep `data\`; silent uninstall must default
  to keeping it and must never block on a message box.


## Diagnostics Invariants

- The daemon writes `logs/daemon.log` through `redactLogLine`. Token shapes (JWTs,
  authorization headers, named secret assignments, long hex strings, secret query
  values) must be impossible to persist, so redaction is applied to every line.
- Daemon log writes are synchronous on purpose: the line written immediately before
  a crash is the most valuable one and an async queue would lose it.
- Never discard the daemon's output again. Running it with `stdio: "ignore"` and no
  log file leaves zero evidence on a user machine and makes every failure
  unfalsifiable.
- A transport failure must report its `cause` chain. Node hides the real reason
  (`ECONNREFUSED`, `ENOTFOUND`, a certificate error) inside `error.cause`, so a bare
  `fetch failed` is not an acceptable message.
- Never print or log the *value* of a proxy variable; a proxy URL may embed
  credentials. Report only whether it is set.
- URLs that reach a message or a log must go through `redactUrl`: the check-in
  status query carries `did`, which is an account identifier.
- `NODE_USE_ENV_PROXY` is read by Node at start-up only. It must be injected into a
  child's spawn environment; setting `process.env` at runtime has no effect. It
  defaults to off so a machine that currently connects directly is not broken.
- `NO_PROXY` must always include loopback (`127.0.0.1`, `localhost`, `::1`). The
  service, the supervisor, and the CDP endpoint are local and must never be routed
  through a proxy.
- `service net` is the first step when a remote call fails on another machine. It
  compares a direct probe with a proxied one on the same host.

## Workflow

- Each commit must represent one complete, user-confirmed feature.
- Do not commit until the user has tested and confirmed the feature.
- Do not commit at all without explicit approval from the user.
- Add focused tests for storage validation, account identity, and switch rollback.
- Run `npm test` and `npm run check` before requesting confirmation.
- `npm run check` walks `src/` and `scripts/` automatically, so new files are
  covered without editing a file list.
- Do not describe a result as implemented or verified until it has been reproduced
  through code, tests, or the real loopback/remote API.
