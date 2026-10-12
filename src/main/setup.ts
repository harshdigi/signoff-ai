// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { promisify } from 'util'

// First-run setup (IDE/D16 H): Claude Code installed, signed in, git and tmux present (chats run in tmux).
// - The app never bundles Claude Code: it runs Anthropic's official installer, in a visible terminal, when you click.
// - Sign-in is Claude Code's own browser flow (`claude auth login`); the app never sees a token.

export type Check = { ok: boolean; detail: string }
export type SetupState = { platform: NodeJS.Platform; claude: Check & { version: string | null }; auth: Check & { method: string | null; plan: string | null }; git: Check; tmux: Check & { brew: boolean } }

const run = promisify(execFile)

// The native installer puts claude in ~/.local/bin, which a fresh shell may not have on PATH yet.
// When claude is not on PATH but is there, that folder is added to the app's PATH (said in the detail line).
export function ensureInstallDirOnPath(): boolean {
  const dir = join(homedir(), '.local', 'bin')
  const onPath = (process.env.PATH ?? '').split(delimiter).includes(dir)
  if (onPath || !existsSync(join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'))) return false
  process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`
  return true
}

// Homebrew's folders: an app opened from Finder does not get the PATH your shell profile sets, so brew and the tools it
// installs (tmux) may be missing from it. Each folder that exists and is not on PATH yet is added at the end.
export function ensureBrewDirsOnPath(): void {
  if (process.platform !== 'darwin') return
  const have = new Set((process.env.PATH ?? '').split(delimiter))
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) if (!have.has(dir) && existsSync(dir)) process.env.PATH = `${process.env.PATH ?? ''}${delimiter}${dir}`
}

async function version(cmd: string, args: string[]): Promise<string | null> {
  try {
    return (await run(cmd, args, { timeout: 15000 })).stdout.trim()
  } catch {
    return null // not installed, or not runnable
  }
}

// `claude auth status` prints JSON and exits 0 when signed in, 1 when not (Claude Code docs, CLI reference).
// Only loggedIn, authMethod and subscriptionType are read; the email and org in that output are never kept.
export function parseAuth(stdout: string, code: number): Check & { method: string | null; plan: string | null } {
  let j: { loggedIn?: boolean; authMethod?: string; subscriptionType?: string } = {}
  try {
    j = JSON.parse(stdout)
  } catch {
    j = {} // not JSON: an older Claude Code; rely on the exit code
  }
  const method = j.authMethod ?? null
  const ok = j.loggedIn ?? (code === 0 && method !== 'none')
  const plan = j.subscriptionType ?? null
  return { ok, method, plan, detail: ok ? `Signed in with ${method ?? 'an account'}${plan ? ` (${plan} plan)` : ''}` : 'Not signed in' }
}

export async function checkSetup(): Promise<SetupState> {
  const added = ensureInstallDirOnPath()
  const v = await version('claude', ['--version'])
  let auth: Check & { method: string | null; plan: string | null } = { ok: false, method: null, plan: null, detail: 'Install Claude Code first' }
  if (v) {
    try {
      const r = await run('claude', ['auth', 'status'], { timeout: 15000 })
      auth = parseAuth(r.stdout, 0)
    } catch (e) {
      const err = e as { stdout?: string; code?: number }
      auth = parseAuth(err.stdout ?? '', typeof err.code === 'number' ? err.code : 1)
    }
  }
  const g = await version('git', ['--version'])
  ensureBrewDirsOnPath()
  const [t, brew] = await Promise.all([version('tmux', ['-V']), version('brew', ['--version'])])
  return {
    platform: process.platform,
    claude: { ok: !!v, version: v, detail: v ? `${v}${added ? ' (found in ~/.local/bin, added to PATH)' : ''}` : 'Not installed' },
    auth,
    git: { ok: !!g, detail: g ?? 'Not installed' },
    tmux: { ok: !!t, brew: !!brew, detail: t ?? (brew ? 'Not installed (Homebrew found)' : 'Not installed') }
  }
}

// Anthropic's documented installer commands (code.claude.com/docs/en/setup).
export function installCommand(platform: NodeJS.Platform): { shell: string; args: string[]; command: string } {
  if (platform === 'win32') return { shell: 'powershell.exe', args: ['-NoProfile', '-Command', 'irm https://claude.ai/install.ps1 | iex'], command: 'irm https://claude.ai/install.ps1 | iex' }
  return { shell: process.env.SHELL || '/bin/bash', args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], command: 'curl -fsSL https://claude.ai/install.sh | bash' }
}

// git: on macOS the Command Line Tools installer (Apple's own dialog); elsewhere we point to git-scm.com.
export const gitInstall = (platform: NodeJS.Platform): { command: string | null; url: string } =>
  platform === 'darwin' ? { command: 'xcode-select --install', url: 'https://git-scm.com/download/mac' } : { command: null, url: 'https://git-scm.com/downloads' }

// tmux: chats run in tmux so the app and a Terminal window can share a session. On macOS it comes from Homebrew; with
// no Homebrew, its official installer runs first (it asks for your Mac password in the terminal). Elsewhere: the tmux wiki.
const BREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
export function tmuxInstall(platform: NodeJS.Platform, brew: boolean): { command: string | null; url: string } {
  const url = 'https://github.com/tmux/tmux/wiki/Installing'
  if (platform !== 'darwin') return { command: null, url }
  const brewBin = '"$(command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1)"'
  return { command: brew ? 'brew install tmux' : `${BREW_INSTALL} && ${brewBin} install tmux`, url }
}

