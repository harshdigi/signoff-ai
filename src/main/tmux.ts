// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'

// Every Claude session runs in tmux, so the app and any Terminal window can show and type into the same session.
// - The app's own socket and config: your own tmux sessions and ~/.tmux.conf are separate.
// - The socket folder is private to your macOS user (/tmp/tmux-<uid>, mode 700).
export const SOCKET = 'decision-ide'

export class Tmux {
  constructor(private conf: string, private socket = SOCKET) {}

  private run(args: string[], input?: string): string {
    try {
      return execFileSync('tmux', ['-L', this.socket, '-f', this.conf, ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      // Said plainly instead of "spawnSync tmux ENOENT".
      if ((e as { code?: string }).code === 'ENOENT') throw new Error('tmux is not installed. Chats run in tmux: open Setup (⇧⌘P → Setup) and install it.')
      throw e
    }
  }

  // The arguments a terminal runs to show a session (tmux attach), for the app's Terminals tab or a Terminal window.
  attachArgs(name: string): string[] {
    return ['-L', this.socket, '-f', this.conf, 'attach', '-t', `=${name}`]
  }

  // Starts `command` detached. env: set for the session; unset: names cleared first (env -u), since the tmux server
  // passes on the environment of whoever started it.
  start(name: string, o: { cwd: string; command: string[]; env: Record<string, string>; unset: string[]; cols: number; rows: number }): void {
    this.run([
      'new-session', '-d', '-s', name, '-x', String(o.cols), '-y', String(o.rows), '-c', o.cwd,
      ...Object.entries(o.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      '--', 'env', ...o.unset.flatMap((k) => ['-u', k]), ...o.command
    ])
  }

  has(name: string): boolean {
    try {
      this.run(['has-session', '-t', `=${name}`])
      return true
    } catch (e) {
      // tmux exits 1 when there is no such session (or no server yet); anything else, e.g. tmux missing, is an error.
      if ((e as { status?: number }).status === 1) return false
      throw e
    }
  }

  // Text as typed. Multi-line text is pasted (bracketed, when the program asks for it) so line breaks do not send early.
  type(name: string, text: string): void {
    if (!text.includes('\n')) return void this.run(['send-keys', '-t', `=${name}:`, '-l', text])
    this.run(['load-buffer', '-b', `in-${name}`, '-'], text)
    this.run(['paste-buffer', '-p', '-d', '-b', `in-${name}`, '-t', `=${name}:`])
  }

  // tmux key names: Enter, Escape, BTab (Shift+Tab), Down.
  key(name: string, key: 'Enter' | 'Escape' | 'BTab' | 'Down'): void {
    this.run(['send-keys', '-t', `=${name}:`, key])
  }

  // The visible screen, one string per line.
  screen(name: string): string[] {
    return this.run(['capture-pane', '-p', '-t', `=${name}:`]).split('\n')
  }

  // The screen without dimmed text: Claude Code shows suggestions (e.g. "continue") dimmed in its input box.
  screenWithoutDim(name: string): string[] {
    const raw = this.run(['capture-pane', '-p', '-e', '-t', `=${name}:`])
    return raw.replace(/\x1b\[2m[\s\S]*?(?=\x1b\[(?:0|22)?m)/g, '').replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '').split('\n')
  }

  stop(name: string): void {
    if (this.has(name)) this.run(['kill-session', '-t', `=${name}`])
  }
}
