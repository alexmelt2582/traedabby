# TRAE SOLO CN Enhancer

A local, non-invasive enhancement assistant for `TRAE SOLO CN`.

The first milestone provides:

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

Authentication backups are stored locally under `data/accounts`. Only account-scoped
`iCube*` keys are replaced or cleared; workspaces, settings, extensions, and window
state are preserved.

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
