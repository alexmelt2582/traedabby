# Project Rules

## 发布流程
本项目遵循 `docs/RELEASE_FLOW.md` 中的流程。

核心规则：
- `main` 是唯一长期分支，禁止直接推送。
- 功能开发从 `main` 创建 `feature/*` 分支。
- 开发完成后，AI 执行构建和打包，生成发布包，等待用户本地验收。
- 用户说“验收通过，发布 vX.Y.Z”后，AI 才能执行发布。
- 发布动作：合并功能分支到 `main`，推送 `main`，打标签 `vX.Y.Z`，推送标签。
- 推送标签后，GitHub Actions 自动创建 Release。
- 禁止创建 `release/*` 或 `develop` 分支。
- 禁止强制推送 `main`。
- 提交信息遵循 Conventional Commits。



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
- Keep-alive may rotate credentials only for inactive accounts, and only on expiry:
  exchange when the access token has under a day left, or the refresh token under a
  month. A credential with days left must be used as-is, because exchanging it
  invalidates every other device holding the same chain. The active account must be
  synchronized from the running TRAE storage and must not have its refresh token
  rotated directly from the backup.
- Account switching uses the same expiry guard (`refreshAuthSnapshotIfNeeded`). It
  must not exchange a target account merely because it is being selected; a later 401
  is the explicit retry point that may rotate once.
- Identifying the active account yields three states, not two: `matched` takes the
  sync path; `not-managed` (TRAE holds an account outside the saved list) is safe and
  rotates normally; `unknown` (the live identity cannot be read at all) must skip the
  entire sweep and log why, because rotating then could invalidate a session we cannot
  see. Never collapse `unknown` into `not-managed`, and never treat it as "keep-alive
  is not needed".
- Skip automatic check-in and keep-alive while Cockpit Tools is running. Both tools
  rotating the same refresh tokens can invalidate each other.
- When the Cockpit Tools probe cannot decide (`unknown`), check-in still runs but
  credential rotation is refused, and keep-alive is skipped. Both paths now rotate only
  on expiry, so the refusal is what removes the remaining overlap.
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
- Keep-alive sweeps every 30 minutes. An inactive account is processed every six hours
  and retried 30 minutes after a failure; the credential is exchanged only on expiry,
  so most sweeps just refresh insights.
- The panel shows each account's credential expiry, derived from `keepalive.accessExpiresAt`
  and `keepalive.refreshExpiresAt`. Those two fields are display metadata carried inside
  the keep-alive payload — they add no index schema.
- Those two fields are also filled from the account snapshot when the panel opens
  (`AccountStore.fillCredentialExpiryFromSnapshots`), because the sweep that writes them
  may be skipped entirely while Cockpit Tools runs or the live identity is unreadable.
  The value is the same `auth.expiredAt` the sweep copies, and the fill touches neither
  the network nor a credential. It must never write `status` or `updatedAt`: a fresh
  timestamp there reads as a finished sync and postpones the real sweep by a full interval.
- A validated account snapshot also writes both expiry fields into the index at save
  time, so a newly added account is visible in the panel immediately instead of waiting
  for the first sweep or the next panel open. This still leaves `status` and `updatedAt`
  untouched and does not rotate credentials.
- Keep-alive, check-in, account switching, login flows, and insight refresh must be
  mutually exclusive.
- Restarting the daemon requires stopping the exact PID reported by `/api/health`.
  Never terminate all Node or Electron processes.
- A restart is never performed in place. The daemon spawns
  `service daemon --wait-pid <its own pid>` detached and then exits, so the
  replacement is started only after the listening port is free and with inherited
  proxy environment controls removed (`POST /api/daemon/restart`).
- The settings tab inside the injected panel is the only UI for check-in and TRAE
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
- URLs that reach a message or a log must go through `redactUrl`: the check-in
  status query carries `did`, which is an account identifier.
- This release has no proxy configuration. Child processes that can reach the network
  are spawned with `stripProxyEnv` so inherited proxy environment controls cannot
  silently reintroduce a proxy path.
- `service net` only performs direct DNS/HTTPS probes. It must not read or mutate
  Windows proxy settings.

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

## Local Codex Runtime

- On this Windows workspace, the built-in `apply_patch` tool and some sandboxed
  shell launches can fail before running their command with
  `fs sandbox helper failed ... setup refresh had errors`. Treat this as a failure
  of the local Codex execution environment, not as evidence about the repository or
  the code under test.
- `.git` is intentionally a 17-byte file containing `gitdir: .git-meta`;
  `.git-meta` is the real Git metadata directory. Do not move, delete, or recreate
  `.git` as a repair attempt. It was tested once and did not resolve the runner
  failure.
- When a sandboxed process launch is rejected this way, retry the exact command with
  escalation. Read-only commands that still run should be preferred first:
  `rg`, `git log`, `git diff --stat`, and `git diff --check`.
- If the built-in `apply_patch` tool remains unavailable, use the Codex executable's
  `--codex-run-as-apply-patch` mode directly with the same
  `*** Begin Patch ... *** End Patch` payload under escalation. The
  `apply_patch.bat` wrapper may lose multiline arguments, so invoke the backing
  `codex.exe` directly. Do not replace source edits with `Set-Content`, shell
  redirects, or ad-hoc file rewriting.
- After editing through this fallback, verify the change with `git diff --check`,
  `npm test`, and `npm run check`; use an escalated `git status --short --branch`
  when the sandboxed status command is still rejected.

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
