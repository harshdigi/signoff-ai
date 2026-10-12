// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Hard security rules, as plain functions (tested in __tests__/security-rules.test.ts; applied in security.ts).
// They hold even if something inside the window goes wrong: a link in Claude's reply, a file shown in review.

// The app's own page: its file under out/renderer in a build, or the dev server while developing. Nothing else may
// load in the window or talk to the main process.
export function isAppUrl(url: string | undefined, app: { rendererDir: string; devUrl?: string | null }): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'file:') {
    const dir = app.rendererDir.replace(/\/+$/, '') + '/'
    return decodeURIComponent(u.pathname).startsWith(dir)
  }
  if (app.devUrl) {
    try {
      return u.origin === new URL(app.devUrl).origin
    } catch {
      return false
    }
  }
  return false
}

// Links leave the app only for the web and email. file:, app handlers (vscode:, x-apple...:), javascript: and the
// app's own decision-ide: links are refused, so a link in a reply can neither open a local file nor start a program.
export function externalAllowed(url: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

// What the window may ask the OS for: writing to the clipboard (Copy buttons). Camera, microphone, location,
// notifications, screen capture and the rest are denied.
export const allowedPermission = (permission: string): boolean => permission === 'clipboard-sanitized-write'

// How Claude may be started: only the four normal permission modes, never a flag that skips permission checks.
export const SAFE_MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const
const BANNED_ARGS = /^--(dangerously-skip-permissions|allow-dangerously-skip-permissions)$/
export function checkClaudeArgs(args: string[]): void {
  const bad = args.find((a) => BANNED_ARGS.test(a))
  if (bad) throw new Error(`refused to start claude with ${bad}: Signoff AI never skips permission checks`)
  const i = args.indexOf('--permission-mode')
  if (i >= 0 && !(SAFE_MODES as readonly string[]).includes(args[i + 1] ?? '')) throw new Error(`refused to start claude in permission mode ${args[i + 1]}`)
}
