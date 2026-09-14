# TRAE SOLO CN Enhancer

A local, non-invasive enhancement assistant for `TRAE SOLO CN`.

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
- automatic daily check-in for every saved account. Check-in uses each account's own
  stable user id as its request device id, so one account does not consume another
  account's daily check-in slot.
- automatic account keep-alive. Inactive accounts refresh their login credentials and
  usage every six hours; the active account is synchronized from the running TRAE
  session instead of rotating its refresh token. Keep-alive is skipped while Cockpit
  Tools is running to avoid conflicting token rotations.

Authentication backups are stored locally under `data/accounts`. Only account-scoped
`iCube*` keys are replaced or cleared; workspaces, settings, extensions, and window
state are preserved. Rollback state for account operations is held in memory and does
not leave raw `storage.json` copies in a transaction directory.

Exported account files always contain an encrypted envelope. Passwords are never
written to disk or included in the export.

## Getting started

Double-click `scripts\trae-enhancer.cmd`, or run the service CLI directly:

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
| `configure` | Saves the TRAE path, or toggles environment proxy support. |
| `net` | Probes the required hosts directly and through the environment proxy. |
| `install` | Registers the logon autostart entry (background service only). |
| `uninstall` | Removes the logon autostart entry. |
| `tray` | Starts the tray icon host. |
| `tray-stop` | Stops the tray icon host by its exact pid. |
| `logs` | Prints the tail of `logs\daemon.log` and `logs\watchdog.log`. |

`stop` never terminates a process group. It reads the daemon pid from
`/api/health` and the supervisor pid from `data/watchdog.pid`, confirms each pid
is one of this project's own process images, and then stops that single pid.

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
through the environment proxy, and prints the conclusion. A failing step is
reported with its full `cause` chain (`ECONNREFUSED`, `ENOTFOUND`, a certificate
error) instead of the bare `fetch failed` that Node produces on its own.

If the conclusion is that the proxy is required:

```powershell
TraeEnhancer.exe configure --use-env-proxy on
TraeEnhancer.exe restart
```

Two details matter here:

- Node's `fetch` **ignores** `HTTP_PROXY` / `HTTPS_PROXY` unless the process is
  started with environment proxy support. The flag is only read at start-up, so it
  is injected into the daemon's spawn environment rather than set at runtime.
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

- Check-in runs a sweep five seconds after daemon startup and every 30 minutes.
  Each account is claimed at most once per Asia/Shanghai calendar day.
- Keep-alive sweeps every 30 minutes. Inactive accounts refresh credentials and
  usage at most once every six hours; failures retry after 30 minutes.
- The active account is synchronized from the running TRAE storage. Its refresh
  token is not rotated from the stored backup.
- Automatic check-in and keep-alive are skipped while Cockpit Tools is running.

Set `TRAE_ENHANCER_AUTO_CHECKIN=0` or `TRAE_ENHANCER_AUTO_KEEPALIVE=0` to disable
the corresponding scheduler. Keep-alive timing can be overridden with
`TRAE_ENHANCER_KEEPALIVE_INTERVAL_MS` and
`TRAE_ENHANCER_KEEPALIVE_RETRY_INTERVAL_MS`.
