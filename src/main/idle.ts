// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Row } from './processes'

// Idle sessions are suspended to free memory (SIGNOFF-42-IDLE):
// - Claude and its tools (MCP servers) stop; the transcript stays;
// - the next message, answer or opened terminal resumes it (claude --resume).

// A Bash tool command Claude runs: zsh -c "source <snapshot> ... eval '<command>' < /dev/null ...".
const EVAL = /\beval '((?:[^']|'\\'')*)'/
const SHELL = /^\S*\b(zsh|bash|sh) -c /
// Waiting on the board is not work: an answer wakes the session again (ipc-board.ts).
const BOARD_WAIT = /^(signoff|decide)\s+wait\b/
// A tool this big (KB) gets a session suspended sooner (D7): an idle funes that ran a search holds 2.3 GB.
export const BLOATED_KB = 1024 * 1024
export const BLOATED_MINUTES = 5

// Whether a process under this Claude (its tools, not Claude itself) passes BLOATED_KB.
// rows: with footprints (processes.withFootprint); rss alone misses compressed memory.
export function bloated(rows: Row[], claudePid: number): boolean {
  const kids = new Map<number, Row[]>()
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r])
  const walk = (pid: number): boolean => (kids.get(pid) ?? []).some((r) => r.mem >= BLOATED_KB || walk(r.pid))
  return walk(claudePid)
}

// Shell commands Claude is running now (a background build, a test run), board waits left out.
// - A shell whose command cannot be read counts as running: when unsure, keep the session.
export function runningShells(rows: Row[], claudePid: number): number {
  return rows.filter((r) => r.ppid === claudePid && SHELL.test(r.command) && !BOARD_WAIT.test(EVAL.exec(r.command)?.[1] ?? '')).length
}

export type IdleFacts = {
  owned: boolean       // the app started it (a Terminal-started session is never stopped by the app)
  busy: boolean        // a turn is running
  queued: number       // messages waiting to be typed in
  menu: boolean        // a permission prompt or menu is open in its terminal
  shown: boolean       // open on screen right now
  shells: number       // runningShells
  lastActive: number   // ms: last transcript write, or when the app started it
  bloated: boolean     // a tool passes BLOATED_KB: suspended after BLOATED_MINUTES instead (D7)
}

export type Verdict = { suspend: true } | { suspend: false; why: string }

// minutes: Settings idleSuspendMinutes (D1); 0 = never.
export function idleVerdict(f: IdleFacts, now: number, minutes: number): Verdict {
  const keep = (why: string): Verdict => ({ suspend: false, why })
  if (minutes <= 0) return keep('suspending is off')
  if (!f.owned) return keep('started in a Terminal window')
  if (f.busy) return keep('a turn is running')
  if (f.queued) return keep('a message is waiting to be typed in')
  if (f.menu) return keep('its terminal shows a question')
  if (f.shown) return keep('open on screen')
  if (f.shells) return keep('a shell command is running')
  const window = f.bloated ? Math.min(minutes, BLOATED_MINUTES) : minutes
  if (now - f.lastActive < window * 60_000) return keep('active recently')
  return { suspend: true }
}
