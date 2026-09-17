# Project Rules

## Product

This repository contains a local enhancement assistant for `TRAE SOLO CN` on Windows.
The assistant must not modify the official installation package or `app.asar`.
It communicates with the running Electron renderer through Chrome DevTools Protocol
and keeps all account data on the local machine.

The only file of TRAE's own it may write is the user-level `User/settings.json`,
and only the `update.mode` entry inside it. Account state, workspaces, history and
every other setting stay untouched.

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
- Identifying the active account yields three states, not two: `matched` takes the
  sync path; `not-managed` (TRAE holds an account outside the saved list) is safe and
  rotates normally; `unknown` (the live identity cannot be read at all) must skip the
  entire sweep and log why, because rotating then could invalidate a session we cannot
  see. Never collapse `unknown` into `not-managed`, and never treat it as "keep-alive
  is not needed".
- Skip automatic check-in and keep-alive while Cockpit Tools is running. Both tools
  rotating the same refresh tokens can invalidate each other.
- When the Cockpit Tools probe cannot decide (`unknown`), check-in still runs but
  credential rotation is refused, and keep-alive is skipped. Check-in only rotates a
  token when the current one is expired; keep-alive rotates unconditionally, so the
  refusal is what removes the conflict.
- The injected panel is a pure view of `data/accounts/index.json`. It must never
  derive check-in state itself; the daemon pushes `trae-enhancer:accounts-updated`
  over CDP after every state change, and the panel re-reads on that event and on open.
  Nothing polls.
- Opening the panel asks the daemon to reconcile (`POST /api/accounts/panel-open`).
  That call is idempotent: an account already checked in on the server is recorded as
  such without claiming a second reward.
- The panel must never request a credit refresh in response to a daemon push. The
  daemon already pushes after its own refresh, so that pair would loop.
- The total check-in reward is `credits`; `extra_credits` is only an additional
  component and must not be displayed as the total.
- A failed account backup must write a log line before the 500 is returned. The panel's
  empty state cannot tell "no accounts saved yet" from "adopting the current account
  failed", so that log is the only place the difference survives.

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
- Only `http:` and `https:` proxy URLs may reach a child environment. Node's
  environment-proxy support throws on anything else *before* the process can start, so
  a SOCKS value surfaces as an unexplained startup crash. Validate at every producer:
  the config layer, `buildProxyVars` for the manual mode, and `buildProxyVars` for the
  environment mode. Report `unsupported-scheme`; never forward the value.
- `scripts/trae-enhancer.cmd`, `scripts/tray.ps1`, `scripts/launch-hidden.vbs`, and
  every generated autostart script must stay pure ASCII with no BOM. Ask `assertAscii`
  from `src/lib/autostart.js` to enforce it, and keep Chinese display strings in
  `data/tray-config.json` (UTF-8) instead.
- Never pass a path through `JSON.stringify` into VBScript: `\\` is not an escape
  there and silently corrupts the path. Use `vbsQuote`.

## Runtime Invariants

- Git metadata is stored in `.git-meta`; use
  `git --git-dir=.git-meta --work-tree=. ...`.
- The default loopback service is `http://127.0.0.1:47834`; CDP defaults to
  `127.0.0.1:9334`.
- Check-in sweeps every `config.checkin.intervalMinutes` (15/30/60/120, default 30) and
  claims at most once per Asia/Shanghai day. `config.checkin.auto` disables those
  automatic sweeps only: opening the panel and `POST /api/checkin/run` are user
  actions and are never gated by it.
- Check-in settings take effect without a restart. Read the configuration when a
  trigger fires, never when the timer is built, and rebuild the schedule with
  `initialRun: false` — saving settings must not claim a reward on the side.
- A successful CDP connect runs one check-in and adopts the signed-in account when the
  list is still empty. Both happen once per connection and re-arm only on disconnect.
  The adoption is attempted once per process run; retrying on every reconnect could
  adopt an account the user removed by hand.
- Keep-alive sweeps every 30 minutes. Inactive accounts refresh every six hours;
  failures retry after 30 minutes.
- Keep-alive, check-in, account switching, login flows, and insight refresh must be
  mutually exclusive.
- Restarting the daemon requires stopping the exact PID reported by `/api/health`.
  Never terminate all Node or Electron processes.
- A restart is never performed in place. The daemon spawns
  `service daemon --wait-pid <its own pid>` detached and then exits, so the
  replacement is started only after the listening port is free and with a freshly
  resolved proxy configuration (`POST /api/daemon/restart`).
- The settings tab inside the injected panel is the only UI for network and TRAE
  update options. It inherits the panel's existing token auth and loopback port, so
  no new listener is opened.
- The supervisor polls `/api/health` every 15 seconds, restarts the daemon after
  three consecutive failures, and backs off for 60 seconds between attempts.
- `data/`, `logs/`, `dist/`, and `node_modules/` are local state and are never
  committed.

## Packaging Invariants

- Any entry that *starts* the application goes through `scripts/launch-hidden.vbs`
  rather than the executable. The bundled binary is a console-subsystem program, so a
  shortcut pointing at it always opens a console window. Only launch entries are
  hidden; a command such as `stop` keeps its console so the user sees the result.
  `test/packaging-assets.test.js` enforces this against the installer script.
- `scripts/win/trae-enhancer.iss` must package `scripts/launch-hidden.vbs`; a launcher
  shortcut pointing at a file the installer never copies is dead on arrival.
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
- The proxy mode defaults to `system` (follow the Windows system proxy). This is safe
  on a machine with no system proxy precisely because the resolution then yields
  nothing and behaves like `off`; the invariant to preserve is that no proxy is ever
  introduced on a machine that has none, not the literal default value.
- A process that starts a *fresh* proxy resolution spawns its child with
  `stripProxyEnv`, never with the environment it inherited. Otherwise the inherited
  `NODE_USE_ENV_PROXY` and old proxy variables survive a change to "不使用代理".
- Because the proxy is fixed at start-up, saving a proxy configuration must report
  that a restart is required and offer the restart. Presenting a saved change as live
  is the defect that produced the intranet report.
- Loopback must always end up in `NO_PROXY`: `127.0.0.1`, `localhost`, `::1`. The
  service, the supervisor, and the CDP endpoint are local and must never be routed
  through a proxy.
- `service net` is the first step when a remote call fails on another machine. It
  compares a direct probe with a proxied one on the same host, and the settings tab
  runs the same comparison for a candidate configuration before it is saved.
- Never resolve a PAC (`AutoConfigURL`) by guessing. Node cannot evaluate one, so the
  reason is reported and the user is pointed at the manual mode.

## TRAE Settings Invariants

- TRAE is switched off from updating itself through
  `update.mode: "manual"` in `User/settings.json`. This is not a guess: the shipped
  build logs `update#ctor - manual checks only; automatic updates are disabled by
  user preference` on that branch and never schedules a check, while `default`
  schedules one every `update.interval` (60) minutes. Evidence lives in
  `%APPDATA%\TRAE SOLO CN\logs\<stamp>\main.log`.
- `update.enableWindowsBackgroundUpdates` already defaults to false and
  `extensions.autoUpdate` does not exist in this build. Do not add settings that
  change nothing.
- That file is JSONC. It is edited as text through `src/lib/trae-settings.js` — a
  targeted splice of one value — and never through parse-and-reserialise, which would
  delete comments and reformat whatever TRAE or the user put there.
- The previous value is remembered in `data/config.json`
  (`traeUpdate.previousMode`) so "允许自动更新" restores what was there instead of
  assuming the entry was absent.
- Before the first write the file is copied to `settings.json.trae-enhancer.bak`, and
  a failed write restores it. A half-written settings file must be impossible.
- Repeating the same value writes nothing, so daemon restarts do not touch TRAE's
  settings file over and over.
- A change here takes effect when TRAE next starts. Never present it as live.
- Server-pushed `forceUpdate` is out of scope: TRAE's own remote configuration can
  still require an update, and pretending otherwise would be a false promise.

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
