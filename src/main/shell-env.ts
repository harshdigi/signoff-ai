// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'

// Apps started from the Dock get a bare PATH, so `claude`, git and project tools would not be found.
// Read PATH from the user's login shell once at startup, as VS Code does.
// - On failure PATH stays as it is and the reason is logged; `claude` may then fail to start, and the chat shows that error.
export function loadShellPath(): void {
  if (process.platform === 'win32') return
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s" "$PATH"'], { encoding: 'utf8', timeout: 5000 })
    const path = out.split('__PATH__').pop()
    if (path) process.env.PATH = path
  } catch (e) {
    console.error('could not read PATH from the login shell:', (e as Error).message)
  }
}

// Apps started from the Dock or Finder get no locale. Ruby, Python and others then read text as US-ASCII and crash on
// any non-ASCII byte: a git hook reading a config file with an emoji fails, and `git worktree add` reports failure.
// - Only when none of LC_ALL, LC_CTYPE or LANG is set: LANG becomes en_US.UTF-8 for the app and all it starts.
// - A locale you set yourself is never changed.
export function ensureUtf8Locale(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.LC_ALL && !env.LC_CTYPE && !env.LANG) env.LANG = 'en_US.UTF-8'
}
