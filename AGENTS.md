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

## Safety

- Bind local services to `127.0.0.1` only.
- Never log or expose access tokens, refresh tokens, cookies, private keys, or complete
  authentication snapshots.
- Only manage processes whose executable path and user-data directory match the
  configured TRAE SOLO CN installation.
- Never close every Electron process or use broad process-name termination.
- Use UTF-8 without BOM for source files and JSON data.

## Workflow

- Each commit must represent one complete, user-confirmed feature.
- Do not commit until the user has tested and confirmed the feature.
- Add focused tests for storage validation, account identity, and switch rollback.
- Run `npm test` and `npm run check` before requesting confirmation.

