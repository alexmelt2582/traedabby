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

## Development

Requirements:

- Windows 10 or 11
- Node.js 22 or newer

```powershell
npm test
npm run check
npm start
```

The default local service is `http://127.0.0.1:47834`.

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
