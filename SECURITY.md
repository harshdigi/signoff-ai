# Security

Signoff AI runs Claude Code on your machine and shows its work in a desktop window. That gives it real power: it opens
terminals, reads your repos and, if you turn Terminal integration on, edits a few of your config files. This page says
how that power is kept in check.

- Full audit, with every finding and its fix: [docs/security-audit.md](docs/security-audit.md)
- Hard guard rules (enforced in code): `src/main/security-rules.ts`, `src/main/security.ts`, tested in
  `src/main/__tests__/security-rules.test.ts`

## Guard rules in short

1. The window shows only the app's own page: no navigating away, no new windows, no web views.
2. The main process answers only that page.
3. The window is sandboxed, isolated, without Node.
4. Links leave the app only for https, http and mailto.
5. The window gets no OS permissions except writing to the clipboard.
6. Claude never starts with a permission-skipping flag or mode.
7. Links from outside (`decision-ide://`) only fill the chat box; they never run anything.
8. Your data folder is readable by you only.
9. Anything that sends data outside (messages, tickets, pushes, PRs) needs your approval, one at a time.
10. Commands run only in folders you trusted.
11. Release builds: no NODE_OPTIONS, no --inspect, code only from the integrity-checked archive, hardened runtime.
12. Voice input: the microphone is used only by the voice helper, only while 🎤 is on, and speech is recognised on
    the Mac only (a language without an on-device model is refused). The window gets text, never audio.

## What the app does not do

- No network calls of its own: no telemetry, no update checks. Claude traffic goes through your own Claude Code.
- It never sees your Claude login, API keys or MCP credentials.
- It never records: no audio is stored or sent. Voice input turns speech into text on your Mac and keeps nothing.
- Your data stays on your machine: `~/Library/Application Support/decision-ide/`.

## Reporting a vulnerability

Please report privately to the maintainer (open a GitHub security advisory on this repository) rather than in a public
issue. Include the version, what you did, and what happened.
