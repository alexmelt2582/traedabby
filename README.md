# TRAE SOLO CN Enhancer

A local, non-invasive enhancement assistant for `TRAE SOLO CN`.

The current release notes are in
[`docs/releases/v1.0.0.md`](docs/releases/v1.0.0.md).

The project provides:

- a Windows launcher that starts TRAE SOLO CN with a loopback CDP port;
- a local daemon that injects a compact panel into the TRAE renderer;
- safe backup of the current account authentication snapshot;
- account listing without exposing authentication tokens.

The account suite also supports:

- one-click switching with a refresh-first, transactional restart flow and automatic
  rollback when TRAE rejects the selected account;
- seamless login in the system browser without closing TRAE;
- traditional fake logout that backs up the current account, keeps non-authentication
  state, reopens TRAE at the login page, and saves the new account automatically.
- encrypted account export and import using scrypt plus AES-256-GCM, with deduplication
  by account identity and no automatic account switching during import.
- automatic check-in for every saved account, on an interval you choose (15, 30, 60 or
  120 minutes). Check-in uses each account's own stable user id as its request device
  id, so one account does not consume another account's daily check-in slot.
- the account signed in when TRAE first connects is adopted automatically, so a fresh
  install never opens on an empty list waiting for you to add one by hand.
- automatic account keep-alive. Every six hours each inactive account has its usage
  re-read, and its credential is exchanged **only when it is about to expire** — the
  access token with under a day left, or the refresh token under a month. The panel
  shows that expiry instead of a vague "keep-alive" state. The active account is
  synchronized from the running TRAE session instead of rotating its refresh token.
  Keep-alive is skipped while Cockpit Tools is running to avoid conflicting rotations.

Authentication backups are stored locally under `data/accounts`. Only account-scoped
`iCube*` keys are replaced or cleared; workspaces, settings, extensions, and window
state are preserved. Rollback state for account operations is held in memory and does
not leave raw `storage.json` copies in a transaction directory.

Exported account files always contain an encrypted envelope. Passwords are never
written to disk or included in the export.

## Getting started

In a packaged build, use the shortcut the installer created. It points at
`scripts\launch-hidden.vbs`, which starts the whole chain with no console window:
the bundled executable is a console-subsystem program, so launching it directly
always opens one. Only the launch entries are hidden. A command such as `stop` keeps
its console on purpose, because you asked for something to happen and should see it
reported.

The launcher also reports a missing executable in a dialog box, with the path it
looked in. A shortcut that silently does nothing is indistinguishable from one that
never ran, and the usual cause — antivirus quarantining the executable, or a partial
extraction — is then impossible to diagnose. The logon entry deliberately stays
silent instead, since a modal box at every logon would be worse than the silence.

To run it by hand, or to read the output, use the service CLI:

```powershell
node scripts\service.js start      # launch TRAE with CDP, the daemon, and the panel
node scripts\service.js daemon     # ensure the background service only
node scripts\service.js status     # show what is running right now
node scripts\service.js stop       # stop the supervisor and the daemon
```

| Command | What it does |
| --- | --- |
| `start` | Launches the full chain: TRAE with CDP, the daemon, and panel injection. |
| `daemon` | Brings the daemon up now, then starts the supervisor that keeps it alive. |
| `stop` | Stops the supervisor and the daemon by their exact pids. |
| `restart` | `stop` followed by `daemon`. |
| `status` | Prints daemon, CDP, supervisor, autostart, and endpoint state. |
| `locate` | Shows where TRAE was found and every location that was probed. |
| `configure` | Saves the TRAE path, or sets the proxy mode and address. |
| `net` | Probes the required hosts directly and through the configured proxy. |
| `install` | Registers the logon autostart entry (background service only). |
| `uninstall` | Removes the logon autostart entry. |
| `tray` | Starts the tray icon host. |
| `tray-stop` | Stops the tray icon host by its exact pid. |
| `logs` | Prints the tail of `logs\daemon.log` and `logs\watchdog.log`. |

`stop` never terminates a process group. It reads the daemon pid from
`/api/health` and the supervisor pid from `data/watchdog.pid`, confirms each pid
is one of this project's own process images, and then stops that single pid.

## Settings

The injected panel has a **设置** tab covering the two options that make the
assistant behave the same way on an intranet machine as TRAE itself does. Both are
also reachable from the CLI.

### Network proxy

TRAE renders with Chromium and therefore follows the Windows system proxy, while the
daemon's `fetch` reads neither the registry nor `HTTP_PROXY` unless it is told to.
On a machine where only the system proxy is configured, that difference shows up as
"TRAE works, the assistant cannot reach `api.trae.cn`".

The panel offers three choices. A fourth mode, `env` (read `HTTP_PROXY` from the
environment), still exists in `config.json` because v1.0.0 configurations migrate
into it, but it is not offered in the UI and is only shown while it *is* the current
value.

| Mode | What it does |
| --- | --- |
| `system` (default) | Reads `HKCU\...\Internet Settings` and follows it. With no system proxy configured this resolves to nothing, so it behaves exactly like `off`. |
| `manual` | One proxy address you supply, for machines that only publish a PAC script or need a fixed proxy. |
| `off` | Never use a proxy. |

```powershell
TraeEnhancer.exe configure --proxy-mode manual --proxy-url 127.0.0.1:7890
TraeEnhancer.exe configure --proxy-mode system
TraeEnhancer.exe net
```

A proxy address is stored without credentials: `data/config.json` is plain JSON, so a
password written there would be an unencrypted secret. A proxy that needs
authentication has to be set as the Windows system proxy instead, where the operating
system holds the credentials. A URL that embeds a username or password is refused.

**HTTP proxies only.** Node's environment-proxy support accepts `http:` and `https:`
and nothing else. A SOCKS address is not merely ignored: it makes the process throw
before it can start, so every path that produces proxy variables — the config layer,
the manual mode, and the environment mode — rejects it. A `socks5://` value found in
`HTTP_PROXY` is dropped and reported rather than passed on.

Only a PAC script and no proxy server is reported as such rather than guessed at:
Node cannot evaluate a PAC file, and the panel points at the manual mode instead.

**Saving is not applying.** Node reads its proxy configuration once, when it starts,
so both the panel and the CLI report that a restart is required and the panel offers
the restart. The restart is performed by a detached helper that waits for the old
process to exit, so the two never contend for the listening port.

### TRAE automatic updates

TRAE checks for updates every 60 minutes by default and requires a restart when one
is found, which interrupts whatever the assistant is doing. The settings tab writes
`update.mode: "manual"` into `%APPDATA%\TRAE SOLO CN\User\settings.json`, which stops
the automatic checks entirely; manual checks from TRAE's own menu still work.

- Only that single entry is touched. The file is JSONC and is edited as text, so
  comments and formatting survive, and every other setting is left byte-identical.
- The previous value is remembered, and "允许自动更新" restores it.
- The file is copied to `settings.json.trae-enhancer.bak` before the first change, and
  a failed write restores it.
- The change takes effect when TRAE restarts.

TRAE's separately pushed `forceUpdate` configuration is not affected by this setting.

## Background service and autostart

The supervisor (`scripts/watchdog.js`) polls `/api/health` every 15 seconds.
After three consecutive failures it starts the daemon again, with a 60-second
cooldown so a permanently broken daemon is not respawned in a tight loop. It only
ever *starts* processes; it never kills anything.

That three-failure threshold is deliberately conservative: it prevents flapping
and keeps the supervisor from racing a daemon that is already booting. It is
therefore *not* used for the first bring-up. `service daemon` starts the daemon
directly and only then hands supervision over, so the command reports the real
state instead of waiting out a recovery threshold.

`node scripts\service.js install` registers a logon autostart entry. It is
deliberately minimal:

- the entry lives in your own Startup folder, so you can delete it yourself and
  no administrator rights are involved;
- it starts the background service only. TRAE is still launched through
  `start`, so nothing pops up at logon.

## Tray

`node scripts\service.js tray` starts the tray host. The host is a Windows
PowerShell `NotifyIcon` script that drives the same service CLI, so it adds no
runtime dependency. The menu is generated from `data\tray-config.json`.

Two encoding rules make this portable across non-ASCII install paths, and both
are enforced by tests:

- `scripts\tray.ps1` and `scripts\trae-enhancer.cmd` are pure ASCII, because
  PowerShell 5.1 reads `.ps1` as ANSI and `cmd.exe` reads `.cmd` as OEM. All
  display strings live in the UTF-8 JSON file instead.
- the project path is never written into those files. The autostart helper
  resolves it from its own location at runtime, and the shortcut is created
  through COM, which stores paths as UTF-16.

## Building the Windows installer

```powershell
npm run build:exe          # the installer packages this output
npm run build:installer
```

The installer build needs Inno Setup 6 (`ISCC.exe`). It is found automatically
under `%LOCALAPPDATA%\Programs\Inno Setup 6`, or through the `INNO_SETUP_ISCC`
environment variable. The output is `dist\installer\TraeEnhancer-Setup-<version>.exe`.

What the installer does:

- installs per user under `%LOCALAPPDATA%\Programs`, with no administrator rights,
  and keeps the directory page enabled so the install location can be changed;
- asks the user to confirm the TRAE SOLO CN executable on a dedicated page that
  follows the directory page. Detection reads the uninstall registry entries,
  matched strictly on `TRAE SOLO CN` — a looser `TRAE` match also picks up the
  unrelated "Trae CN" IDE — plus a list of well-known directories. A
  "use the detected path" button appears when it differs from the saved one;
- hands the chosen path to `TraeEnhancer.exe configure --trae-exe <path>` as a
  command line argument. This is deliberate: subprocess stdout is UTF-8 while the
  installer decodes pipes with the system ANSI code page, so a path must never be
  read back through a pipe;
- offers optional tasks for a desktop shortcut and for registering the logon
  autostart of the background service;
- on uninstall, asks whether to keep user data. `data\` holds the account
  snapshots and the API token, so deleting it is irreversible; choosing cancel
  aborts the whole uninstall.

`scripts\win\ChineseSimplified.isl` is the community Simplified Chinese
translation collected at <https://jrsoftware.org/files/istrans/> and is used
exactly as published.

## Updating and reinstalling

Run a newer installer over the existing installation. The installer uses a stable
`AppId`, reuses the previous install directory and task choices, and asks the old
`TraeEnhancer.exe` to stop before replacing any files. Account data under `data\`
is not touched by an upgrade.

For a portable copy, stop the service first, replace the portable folder contents,
and keep the existing `data\` directory. The project does not yet implement an
online auto-updater; updates are applied by running the newer installer or copying
a newer portable build.

## Troubleshooting a failure on another machine

Start with the built-in network probe:

```powershell
TraeEnhancer.exe net
```

It resolves and contacts every host the project needs, first directly and then
through the configured proxy, and prints the conclusion. A failing step is
reported with its full `cause` chain (`ECONNREFUSED`, `ENOTFOUND`, a certificate
error) instead of the bare `fetch failed` that Node produces on its own.

The panel's **设置** tab runs the same comparison for a candidate configuration
before you save it, so "should this machine use a proxy" can be answered on the
machine itself rather than inferred.

If the conclusion is that the proxy is required:

```powershell
TraeEnhancer.exe configure --proxy-mode system      # follow the Windows system proxy
TraeEnhancer.exe configure --proxy-mode manual --proxy-url 127.0.0.1:7890
TraeEnhancer.exe restart
```

Two details matter here:

- Node's `fetch` **ignores** `HTTP_PROXY` / `HTTPS_PROXY` unless the process is
  started with environment proxy support. That is read at start-up only, so it is
  injected into the daemon's spawn environment rather than set at runtime — and a
  saved change needs the restart above.
- `NO_PROXY` always keeps loopback out of the proxy. The service, the supervisor,
  and the CDP endpoint are all local.

Proxy variable values are never printed or logged, because a proxy URL may embed
credentials.

Then read the daemon log, which records the reason for every failed remote call:

```powershell
TraeEnhancer.exe logs
```

`logs\daemon.log` is written through a redaction filter, so tokens, JWTs,
authorization headers and secret query values cannot reach it.

## Development

Requirements:

- Windows 10 or 11
- Node.js 22 or newer

```powershell
npm test
npm run check
npm start
```

`npm run check` syntax-checks every file under `src/` and `scripts/`.

The default local service is `http://127.0.0.1:47834`.

## Building the portable executable

```powershell
npm install
npm run build:exe
```

This produces `dist\portable\`, which is self-contained and needs no Node.js
installation on the target machine:

```
dist\portable\
  TraeEnhancer.exe
  scripts\launch-hidden.vbs   the shortcut target: starts everything with no console
  scripts\trae-enhancer.cmd
  scripts\tray.ps1
  README.md
  data\          created on first run
```

The executable embeds its own runtime, so it is roughly the size of `node.exe`
itself (about 83 MB and up). `npm run build:exe` verifies its own output: the
preparation blob must contain the renderer script marker, and the produced
executable must answer `status`.

Two constraints shape the build and must not be broken:

- Node 22 single-executable applications only accept a **CommonJS** entry, so
  the ESM tree is bundled with esbuild first. `import.meta` therefore cannot be
  used in bundled code; `src/lib/app-paths.js` is the only module that reads it,
  and the build injects `__APP_BUNDLE_ROOT__` for the bundled case.
- a single executable cannot load sibling scripts from disk, so the renderer
  script is embedded as a SEA asset and the daemon, the supervisor, and the
  service CLI are re-entered through an internal argv switch.

## Automatic jobs

- Check-in runs a sweep five seconds after daemon startup, then every 15, 30, 60 or 120
  minutes — 30 by default, changeable in 设置 → 自动签到. Each account is claimed at
  most once per Asia/Shanghai calendar day.
- When TRAE connects, the daemon runs one check-in as well, so restarting TRAE
  mid-session is covered immediately instead of waiting for the next interval.
- Turning automatic check-in off stops those two runs only. Opening the panel still
  reconciles today's state, and the 「立即签到」 button still works: those are actions you
  take, not background runs.
- Keep-alive sweeps every 30 minutes. Each inactive account is processed at most once
  every six hours (30-minute retry after a failure) to refresh credits; the credential
  itself is exchanged **only on expiry** — access token under a day left, refresh token
  under a month. A credential with days left is used as-is, because exchanging it would
  invalidate every other device holding the same chain.
- The active account is synchronized from the running TRAE storage. Its refresh
  token is not rotated from the stored backup.
- Rotating a refresh token invalidates whoever still holds the old one — including a
  copy you exported to another machine. Expiry-driven rotation makes that rare (roughly
  every 11–14 days per account instead of four times a day) but cannot eliminate it:
  two machines managing one account will always take turns kicking each other out. Treat
  an export as a **migration**, not a shared copy.
- A rotation additionally requires TRAE to be known *not* to be signed in as a managed
  account. If the live account cannot be read at all, the entire sweep is skipped and
  the reason is logged, rather than rotating blind. TRAE holding an account outside the
  saved list is fine and blocks nothing.
- Automatic check-in and keep-alive are skipped while Cockpit Tools is running.
- The Cockpit Tools test tries `tasklist` first and PowerShell second. If neither can
  answer, check-in still runs but credential rotation is refused and keep-alive is
  skipped, and the reason is written to `logs\daemon.log` — a probe failure must never
  silently cancel a sweep.
- Opening the panel reconciles check-in state with the server and refreshes credits.
  That call is idempotent: an account already checked in is recorded without claiming
  a second reward. The daemon pushes an event over CDP after every state change, so an
  open panel updates itself; there is no polling loop.

Set `TRAE_ENHANCER_AUTO_CHECKIN=0` or `TRAE_ENHANCER_AUTO_KEEPALIVE=0` to disable
the corresponding scheduler. Keep-alive timing can be overridden with
`TRAE_ENHANCER_KEEPALIVE_INTERVAL_MS` and
`TRAE_ENHANCER_KEEPALIVE_RETRY_INTERVAL_MS`.
