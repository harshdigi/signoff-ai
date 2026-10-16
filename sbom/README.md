# Software bill of materials (SBOM)

CycloneDX 1.5 JSON, generated 13 October 2026 (IST) for Signoff AI 1.0.0, updated for 1.0.1 to 1.0.5 (no dependency changes since 1.0.0;
only the app's own version changed). 1.0.2 adds a first-party speech helper (`signoff-speech`, Swift) that links only
Apple system frameworks, so it adds no third-party component.

| File | What it lists |
|---|---|
| `app.cdx.json` | What ships in the app: 87 packages plus Electron (with the Chromium, Node.js and V8 it embeds) |
| `full.cdx.json` | Every package in the project, development and build tools included (708) |

## How `app.cdx.json` was made

The npm SBOM alone is not the shipped app. Libraries bundled into the window code (React, Monaco, the Markdown
stack) are development dependencies to npm, and electron-builder keeps only 5 packages in the app's `node_modules`.
So the app SBOM lists:

1. **Run-time `node_modules`**, read from the packaged app archive: `@electron-toolkit/preload` 3.0.2,
   `@electron-toolkit/utils` 4.0.0, `better-sqlite3` 13.0.3, `node-addon-api` 7.1.1, `node-pty` 1.1.0.
2. **Bundled code**, recorded from the real build: every module with code in the main, preload or window bundle
   (82 packages, all in the window code; main and preload bundle none).
3. **Electron 44.5.1**, with Chromium 152.0.7977.130, Node.js 24.21.0 and V8 15.2.124.28 (read from the binary).

Each component keeps npm's purl, SHA-512 hash, license and source links.

## Checks (13 October 2026)

| Check | Result |
|---|---|
| Every package in the packaged app is in the SBOM | Yes (5 of 5 run-time, 82 of 82 bundled) |
| Versions match `package-lock.json` | All |
| Licenses present | All. MIT 87, BSD-3-Clause 2, ISC 1, `MPL-2.0 OR Apache-2.0` 1 (dompurify; used under Apache-2.0) |
| Copyleft-only licenses (GPL, LGPL, AGPL) | None |
| Known vulnerabilities in shipped components (`npm audit`) | None |
| CycloneDX 1.5 schema | Both files valid |

## Regenerate

```bash
npm sbom --sbom-format cyclonedx --sbom-type application > sbom/full.cdx.json
```

Rebuilding `app.cdx.json` needs a build (to record bundled modules) and a packaged app (for the run-time
`node_modules`); the steps are the ones above.
