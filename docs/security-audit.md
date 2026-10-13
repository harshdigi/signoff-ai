# Signoff AI security and privacy audit

- **Date:** 13 October 2026 (IST)
- **Version audited:** 1.0.0 (source and the packaged macOS app)
- **Auditor:** an internal review, done with Claude acting as a senior application-security reviewer. This is **not** an independent third-party audit.
- **Method:** manual code review of every main-process entry point, a dependency audit (`npm audit`), Electron configuration review, inspection of the packaged app, and checks run on the real build.

## 1. What Signoff AI is, and where the risk sits

Signoff AI is an Electron desktop app over the user's own Claude Code. Claude does the work. The user answers decisions and reviews changes. The app:

- starts `claude` in terminals (tmux) inside folders the user has trusted;
- reads git repositories in the open folder (diffs, file search, code previews);
- keeps its own data locally (`~/Library/Application Support/decision-ide`);
- when the user turns on Terminal integration, edits three of the user's files (`~/.claude/settings.json`, the shell rc file and `~/.local/bin/decide`), with a backup and an Undo.

The app makes **no network calls of its own**. Claude traffic goes through the user's own Claude Code and login. The app never sees an API key or OAuth token.

**Trust boundaries**

| Boundary | Untrusted input that crosses it |
|---|---|
| Window (renderer) → main process | Anything shown in the window: Claude's replies (Markdown), file contents in review, docs, PR text |
| Outside → app | `decision-ide://` links from websites and other apps |
| Repo → app | File names, file contents, task commands (package.json, Procfile, `.vscode/tasks.json`) |
| App → user's machine | Terminals, git commands, edits to the user's config files |

## 2. Summary

| Severity | Found | Fixed | Accepted (documented) |
|---|---|---|---|
| High | 2 | 2 | 0 |
| Medium | 5 | 4 | 1 |
| Low | 5 | 3 | 2 |

The two High findings were both about the window being able to leave the app's own page while keeping the app's bridge to the main process. Both are fixed and covered by tests.

## 3. Findings

### H1. The window could navigate away from the app (fixed)

- **What:** links in rendered Markdown, such as Claude's replies and docs, are real `<a href>` links. The app handled links that open *new* windows (`setWindowOpenHandler`). Nothing stopped a plain click from navigating the window itself (`will-navigate`).
- **Impact:** a remote page loaded in the window would still get the preload bridge (`window.api`). Through that bridge it could start terminals and read repo files. In effect, a malicious link in a reply could get code running on the user's Mac.
- **Fix:** `hardenWindow()` in `src/main/security.ts`:
  - blocks every navigation and redirect away from the app's page;
  - blocks embedded web views;
  - sends allowed links to the browser.
- **Test:** `isAppUrl` in `src/main/__tests__/security-rules.test.ts`.

### H2. The main process accepted messages from any page (fixed)

- **What:** about 106 `ipcMain` handlers took messages without checking which page sent them.
- **Impact:** together with H1, any page loaded in the window could call any handler.
- **Fix:** `guardIpc()` wraps `ipcMain.handle` and `ipcMain.on` once, before any handler is registered. Each message must come from the app's own page, which is `out/renderer` in a build or the dev server while developing. Anything else is refused and logged.
- **Verified:** a launch of the packaged app shows its own calls passing the guard.

### M1. The renderer sandbox was off (fixed)

- **What:** `sandbox: false`.
- **Fix:** `sandbox: true`, with `contextIsolation: true`, `nodeIntegration: false` and `webSecurity: true` set explicitly. The preload uses only `contextBridge` and `ipcRenderer`, so it works sandboxed.
- **Verified:** the packaged app launches and its preload API works.

### M2. External links opened with any scheme (fixed)

- **What:** links went straight to `shell.openExternal`, so `file:`, `smb:` or app handler schemes could open local files or start programs.
- **Fix:** `openExternalSafely()` allows only `https`, `http` and `mailto`. Everything else is dropped and logged. This applies to every `openExternal` call in the main process.
- **Test:** `externalAllowed`.

### M3. Deep links could run a pinned skill without asking (fixed)

- **What:** `decision-ide://run?skill=…` from any website sent a pinned skill to Claude immediately.
- **Fix:** links from outside now only fill the chat box, and a notice says what the link asked for. The user presses Send. `ask` links already only filled the box.

### M4. Hardening missing from the macOS build (fixed)

- **What:**
  - all Electron fuses were at their defaults: `NODE_OPTIONS` honoured, `--inspect` honoured, code loadable from outside the archive, no archive integrity check;
  - hardened runtime was off;
  - the entitlements allowed `DYLD_*` library injection.
- **Fix** (`electron-builder.yml`, `build/entitlements.mac.plist`):
  - turned off: the `NODE_OPTIONS` and `--inspect` fuses;
  - turned on: `onlyLoadAppFromAsar`, `enableEmbeddedAsarIntegrityValidation`, cookie encryption, and the hardened runtime;
  - removed the `allow-dyld-environment-variables` entitlement.
- **Verified on the build:**
  - fuses read back as set;
  - the signature shows `adhoc,runtime`;
  - `NODE_OPTIONS` is ignored;
  - the app and the CLI both run.

### M5. RunAsNode remains on (accepted, with a planned fix)

- **What:** the `signoff` CLI (old name `decide`), which Claude sessions call, runs as plain Node through the app's own binary (`ELECTRON_RUN_AS_NODE`).
- **Impact:** with this fuse on, a program already running as the user can run any JavaScript through the app's binary, including with a Node debugger. Checked: the `--inspect` fuse doesn't apply in this mode. That code would inherit macOS permissions the user granted Signoff AI, such as access to Documents.
- **Why accepted for now:** an attacker needs code execution on the Mac already, and turning the fuse off would break the CLI.
- **Mitigation:** don't grant Signoff AI Full Disk Access, Accessibility or Automation. It doesn't need them.
- **Planned fix:** ship `signoff` as its own small Node binary (for example a Node single-executable app), then turn RunAsNode off.

### L1. A vulnerable library in the shipped window code (fixed)

- **What:** the Monaco editor ships its **own embedded copy** of DOMPurify 3.4.15 (`monaco-editor/esm/vs/base/browser/dompurify/dompurify.js`), with two advisories: GHSA-p98j-92pf-mc4p and GHSA-6688-9rhm-gjv2 (DOM XSS in `IN_PLACE` mode).
- **Correction:** a first fix pinned the npm `dompurify` package with an `overrides` entry. Building the SBOM showed that this changed nothing in the app, because Monaco doesn't use the npm package.
- **Fix:** a build rule in `electron.vite.config.ts` (`patchedDompurify`) points Monaco's one import of its embedded copy at the npm package, which is pinned to 3.4.17 as a direct dependency.
- **Verified:** the built window code reports `DOMPurify.version = "3.4.17"`, and no copy of 3.4.15 remains.
- **Exploitability before the fix:** Monaco never uses `IN_PLACE` mode, and the window's Content Security Policy blocks inline and remote scripts. This was defence in depth.

### L2. Database file mode 644 (fixed)

- **What:** `board.db` was created `rw-r--r--` inside a `rwx------` folder. Other users already couldn't reach it, because the folder blocks them.
- **Fix:** `lockDataDir()` sets the folder to 700 and the database files to 600 at every start.

### L3. Claude launch flags weren't checked (fixed)

- **What:** the permission mode came from a stored value.
- **Fix:** `checkClaudeArgs()` refuses to start `claude` with `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions` or any permission mode other than `default`, `acceptEdits`, `plan` and `auto`. It applies both to sessions the app starts and to terminals the window opens.

### L4. Build-tool advisories (accepted)

- **What:** 8 moderate advisories, all in one chain: `electron-builder` → `@electron/get` → `global-agent` → `roarr` → `sprintf-js` (GHSA-hp3w-g68c-fv3c, a denial of service through format precision).
- **Why accepted:** this runs only on the build machine, for proxy support while downloading Electron. Nothing in the chain ships in the app, and no fixed `sprintf-js` exists (the newest, 1.1.3, is affected).

### L5. Data at rest is not encrypted (accepted)

- **What:** decisions, chat indexes and attachments sit in plain SQLite and files under the data folder. That folder is readable by the user only.
- **Why accepted:** this matches Claude Code itself, which keeps transcripts in plain files under `~/.claude`. Full-disk encryption (FileVault) covers a lost device.
- **Advice:** don't paste secrets into chats. If one is pasted, it is stored in Claude Code's transcript and in this index.

## 4. Areas reviewed and found sound

| Area | What is in place |
|---|---|
| Content Security Policy | `default-src 'self'; script-src 'self'`, with no remote connections. Inline styles are allowed only because the editor needs them. |
| HTML rendering | No `dangerouslySetInnerHTML`, `rehype-raw` or `eval` anywhere in the window code. Markdown renders without raw HTML. |
| Terminals the window can open | Only `claude` or the user's login shell (`src/main/ipc-terminals.ts`). This is the app's purpose: the window is trusted, and H1 and H2 keep it the app's own page. |
| Shell commands built from repo data | Spec file names are quoted with single-quote escaping (`src/main/testing.ts`, `src/main/integration.ts`). Most git calls use `execFile` or `spawn` with argument arrays, not shell strings. |
| File reads | Code preview and search read only inside the open folder's repos and their worktrees. Paths are resolved with `realpath` and must stay under the root, so symlinks can't escape. Files over 2 MB and binary files are refused. Evidence snippets read only inside the session's folder. |
| Running repo tasks | Only in folders the user explicitly trusted, and only when the user clicks. The command is shown first. |
| Outward actions | Tool calls that send something outside (messages, tickets, `git push`, PRs) are always shown as an editable draft and approved one at a time. "Allow for this chat" never covers them (`src/shared/outward.ts`). |
| MCP credentials | The window never receives them; configured servers are listed with credentials masked. |
| Edits to the user's files | Only with Terminal integration turned on, with a backup before each change, marker blocks so only the app's own lines are touched, and an Undo. The app refuses to overwrite a `signoff` or `decide` launcher it didn't write. |
| Microphone (added after 1.0.1) | Voice input runs a small native helper (`native/speech/main.swift`) only while the user has 🎤 on. It uses Apple's speech recognition with `requiresOnDeviceRecognition`, so audio stays on the Mac; a language without an on-device model is refused rather than sent to Apple. The helper prints text only; the window never gets audio or a browser microphone permission. macOS asks before first use (usage texts in `electron-builder.yml`, entitlement `device.audio-input`). |
| Network | The app has no telemetry, update checks or network calls. The URLs in the code are documentation links and the official Claude and git installer pages. |
| Packaged contents | No databases, transcripts, `.env` files, keys, logs, or paths from the build machine (checked by unpacking the dmg). |

## 5. Hard guard rules now in force

These are enforced by code, not by instructions to Claude. The source is `src/main/security-rules.ts` and `src/main/security.ts`; the tests are in `src/main/__tests__/security-rules.test.ts`.

1. The window shows only the app's own page: no navigation, redirects, new windows or web views.
2. The main process answers only the app's own page. Every message from elsewhere is refused.
3. The window is sandboxed, with context isolation and no Node access.
4. Links leave the app only for `https`, `http` and `mailto`.
5. The window gets no OS permissions except writing to the clipboard: no camera, microphone, location, notifications or screen capture.
6. `claude` never starts with a permission-skipping flag or mode.
7. Links from outside (`decision-ide://`) never run anything. They only fill the chat box.
8. The data folder is readable by the user only (700, database files 600).
9. Outward actions always need the user's approval, one at a time.
10. Commands run only in folders the user trusted.
11. Packaged builds: no `NODE_OPTIONS`, no `--inspect` in app mode, code only from the integrity-checked archive, hardened runtime, no library injection.
12. Voice input (added after the audit): the microphone only through the voice helper, only while 🎤 is on, recognition on the Mac only. The window's permission rule (5) is unchanged.

## 6. Dependencies

`npm audit`, 13 October 2026:

| Group | Result |
|---|---|
| Libraries the app needs at run time (`better-sqlite3`, `node-pty`, `@electron-toolkit/*`) | 0 known vulnerabilities |
| Bundled window code (React, Monaco and others) | 0 known vulnerabilities after routing Monaco's embedded DOMPurify to 3.4.17 (L1) |
| Build tools | 8 moderate advisories, one chain, build machine only (L4) |
| Electron | 44.5.1 |

Reproduce: `npm ci && npm audit && npm audit --omit=dev`.

The full component list, with versions, hashes and licenses, is in the SBOM: [`sbom/`](../sbom/README.md) (CycloneDX 1.5).

## 7. Privacy

- **What the app stores:** decisions, sessions, review state, test plans, comments, image attachments you paste, and a search index of your chats. Everything is local, in `~/Library/Application Support/decision-ide/`.
- **What it reads:** your open folder's git repos, Claude Code's own transcripts (to show the chat), and your flow docs folder if you set one.
- **What leaves your Mac:** nothing, from the app itself. Whatever Claude Code sends to Anthropic is governed by your Claude plan.
- **Removal:** delete the app and that folder. If Terminal integration was on, Settings → Undo first restores your config files.

## 8. Verifying this yourself

```bash
npm ci
npm audit && npm audit --omit=dev
npm test                                   # includes the security-rules tests
npm run dist:mac:friends                   # builds dist/signoff-ai-<version>.dmg
npx @electron/fuses read --app "dist/mac-universal/Signoff AI.app"
codesign -dvv "dist/mac-universal/Signoff AI.app"   # flags: adhoc,runtime
```

## 9. Open items

- **M5:** ship `signoff` as its own binary, then turn RunAsNode off.
- **Signing:** sign with an Apple Developer ID and notarize before any wider release. Then `disable-library-validation` can go too.
- **Third-party review:** an independent penetration test before selling the app.
