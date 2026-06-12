# Local UI Testing Server Launch

CPLayout has a repo-owned local launcher for browser-based user testing. It is for the static Expo web export and local developer web sessions only. It does not prove Android/iOS, native SQLite, ZIP sharing, MapLibre native rendering, Google Earth, or raw tile-package runtime behavior.

## Commands

Static user-testing server:

```bash
npm run ui:test:start
```

The command exports the web app first, serves `apps/mobile/dist`, prints the exact selected URL, and opens the browser. The default port is `19006`. Override it with:

```bash
CPLAYOUT_UI_TEST_PORT=19010 npm run ui:test:start
```

Status and cleanup:

```bash
npm run ui:test:status
npm run ui:test:stop
```

Expo live-reload developer mode:

```bash
npm run dev:web:smart
```

The developer mode default port is `8081`. Override it with `CPLAYOUT_DEV_WEB_PORT`.

## Agent Workflow

Agents should use this launcher instead of ad hoc local web server commands whenever a browser UI check needs a running CPLayout app.

- Before launching, run `npm run ui:test:status` when there may already be a server or a port conflict.
- For local static-export checks, run `npm run ui:test:start -- --no-open`, use the exact printed URL for browser or Playwright work, and report that URL.
- For live-reload development only, run `npm run dev:web:smart` and report the selected URL.
- For deterministic evidence, keep using `npm run proof:web`; set `CPLAYOUT_WEB_PROOF_PORT` explicitly when a non-default proof port is required.
- After manual launcher checks, run `npm run ui:test:stop` unless the user explicitly asks to leave the server running. The stop command may terminate only launcher-owned CPLayout servers.
- Never kill an unknown listener on `19006`, `19007`, `8081`, or adjacent ports. Use status output and port hopping instead.
- Do not treat launcher health, static export success, or browser screenshots as Android/iOS, native SQLite, ZIP sharing, MapLibre native, Google Earth, or raw tile-package proof.

## Desktop Shortcut

From Windows PowerShell, install the user Desktop shortcut:

```powershell
\\wsl.localhost\Ubuntu\mnt\h\cplayout\tools\windows\Install-CPLayoutDesktopShortcut.ps1 -WithStopShortcut
```

The shortcut runs `tools/windows/Launch-CPLayoutWeb.ps1`. That script enters WSL at `/mnt/h/cplayout`, runs `npm run ui:test:start -- --no-open`, captures the selected `http://127.0.0.1:<port>` URL, and opens it with PowerShell `Start-Process`.

The optional stop shortcut runs `npm run ui:test:stop` through WSL.

## Port Policy

- Static user-testing range: `19006-19020`.
- Expo developer range: `8081-8099`.
- `npm run proof:web` remains deterministic: it still uses `CPLAYOUT_WEB_PROOF_PORT` or defaults to `19006` through Playwright.
- Manual launcher commands may hop to the next free port, but they must print and open the exact selected URL.
- Unknown listeners are never killed automatically.

Port classification:

- `free`: start on the preferred port.
- `ownedHealthy`: reuse the launcher-owned CPLayout server and open its recorded URL.
- `ownedStale`: remove stale state; terminate only when live PID, command, and cwd match launcher-owned CPLayout metadata.
- `occupiedUnknown`: leave it running and try the next allowed port.
- `likelyCplayoutNoState`: reuse only when the CPLayout static health endpoint proves a compatible server and `--reuse-export` was requested.

## Local State

Launcher metadata and logs are local machine state:

- `.cplayout-local/servers/*.json`
- `.cplayout-local/logs/*.log`

The directory is ignored by git and must not be serialized into project documents, SQLite records, browser project storage, or project ZIP exports.

## Static Export Freshness

`npm run ui:test:start` reruns `npm run export:web` before serving unless `--reuse-export` is passed:

```bash
npm run ui:test:start -- --reuse-export
```

Use `--reuse-export` only when the existing `apps/mobile/dist` export is intentionally being reused.

## Browser Proof

For deterministic Playwright proof:

```bash
CPLAYOUT_WEB_PROOF_PORT=19007 npm run test:web:e2e
npm run proof:web
```

The smart launcher is a local user-testing convenience. `proof:web` remains the stable evidence command.
