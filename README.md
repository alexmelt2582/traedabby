# TRAE SOLO CN Enhancer

A local, non-invasive enhancement assistant for `TRAE SOLO CN`.

The first milestone provides:

- a Windows launcher that starts TRAE SOLO CN with a loopback CDP port;
- a local daemon that injects a compact panel into the TRAE renderer;
- safe backup of the current account authentication snapshot;
- account listing without exposing authentication tokens.

Account switching and new-account login are implemented in later milestones.

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

