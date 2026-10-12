// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import * as pty from 'node-pty'

// Pseudo-terminals for the embedded terminal tabs. One per tab; output is kept so a reloaded window can replay it.

export interface SpawnOptions {
  command?: string        // default: the user's login shell
  args?: string[]
  cwd?: string            // default: home
  cols?: number
  rows?: number
  env?: Record<string, string>
  session?: string        // the Claude session this terminal belongs to; the window groups terminals by it
}

export interface TerminalInfo { id: string; command: string; args: string[]; cwd: string; pid: number; exited: boolean; exitCode: number | null; session: string | null }

const REPLAY_LIMIT = 256 * 1024  // keep the last 256 KB of output per terminal

// Variables a running Claude Code session sets for its own children.
// - If the app was started from inside a Claude Code session, a claude in our terminals inherits them,
//   acts as that session's child and saves no conversation file. So they are dropped.
// - Exact names (seen in Claude Code 2.1.291): your own settings such as CLAUDE_CODE_USE_BEDROCK must pass through.
export const SESSION_VARS = [
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT'
]
const INHERITED = new Set(SESSION_VARS)

export const terminalEnv = (base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(base).filter((e): e is [string, string] => e[1] !== undefined && !INHERITED.has(e[0]))),
  TERM: 'xterm-256color',
  ...extra
})

// A command run the way your Terminal runs it: login + interactive, so ~/.zshrc loads too.
// - rbenv, nvm and the like are often set up only in ~/.zshrc. Without it, `bundle` can pick the wrong Ruby.
export const inUserShell = (cmd: string): { command: string; args: string[] } => ({ command: process.env.SHELL || '/bin/zsh', args: ['-lic', cmd] })

type Listener<T> = (event: T) => void
type Entry = { proc: pty.IPty; info: TerminalInfo; buffer: string }

export class TerminalManager {
  private terms = new Map<string, Entry>()
  private dataListeners = new Set<Listener<{ id: string; data: string }>>()
  private exitListeners = new Set<Listener<{ id: string; exitCode: number }>>()

  spawn(opts: SpawnOptions = {}): TerminalInfo {
    const command = opts.command || process.env.SHELL || '/bin/zsh'
    const args = opts.args ?? (opts.command ? [] : ['-l'])
    const cwd = opts.cwd || homedir()
    const cols = opts.cols || 100
    const rows = opts.rows || 30
    const proc = pty.spawn(command, args, {
      name: 'xterm-256color', cols, rows, cwd,
      env: terminalEnv(process.env, opts.env)
    })
    const id = randomUUID()
    const entry: Entry = {
      proc, buffer: '', info: { id, command, args, cwd, pid: proc.pid, exited: false, exitCode: null, session: opts.session ?? null }
    }
    this.terms.set(id, entry)
    proc.onData((data) => {
      entry.buffer = (entry.buffer + data).slice(-REPLAY_LIMIT)
      this.dataListeners.forEach((l) => l({ id, data }))
    })
    proc.onExit(({ exitCode }) => {
      entry.info.exited = true
      entry.info.exitCode = exitCode
      this.exitListeners.forEach((l) => l({ id, exitCode }))
    })
    return { ...entry.info }
  }

  private get(id: string): Entry {
    const t = this.terms.get(id)
    if (!t) throw new Error(`no terminal ${id}`)
    return t
  }

  write(id: string, data: string): void {
    const t = this.get(id)
    if (!t.info.exited) t.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const t = this.get(id)
    if (t.info.exited || cols <= 0 || rows <= 0) return
    t.proc.resize(Math.floor(cols), Math.floor(rows))
  }

  replay(id: string): string {
    return this.get(id).buffer
  }

  list(): TerminalInfo[] {
    return [...this.terms.values()].map((t) => ({ ...t.info }))
  }

  // Closing a tab ends its process (SIGHUP, like closing a terminal window) and forgets it.
  // Closing one that is already closed (its tab was closed first) does nothing: quitting must never fail on it.
  close(id: string): void {
    const t = this.terms.get(id)
    if (!t) return
    if (!t.info.exited) t.proc.kill()
    this.terms.delete(id)
  }

  closeAll(): void {
    for (const id of [...this.terms.keys()]) this.close(id)
  }

  onData(l: Listener<{ id: string; data: string }>): () => void {
    this.dataListeners.add(l)
    return () => this.dataListeners.delete(l)
  }

  onExit(l: Listener<{ id: string; exitCode: number }>): () => void {
    this.exitListeners.add(l)
    return () => this.exitListeners.delete(l)
  }
}
