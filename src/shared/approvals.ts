// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { randomBytes } from 'crypto'
import { BoardError, now } from './board'
import { isOutward } from './outward'
import type { Store } from '../main/store'

// Permission prompts from chat sessions (IDE/D10).
// - signoff mcp files a request and waits; the window answers it.
// - The result is the JSON Claude Code expects back from a --permission-prompt-tool.

export interface Approval {
  id: string; session_id: string; tool_name: string; input: string; tool_use_id: string | null
  status: 'pending' | 'allowed' | 'denied' | 'terminal'; scope: 'once' | 'chat' | null; result: string | null
  created_at: string; answered_at: string | null
}

export type Answer =
  | { allow: true; scope?: 'once' | 'chat'; updatedInput?: Record<string, unknown> }
  | { allow: false; message: string }

// "Allow for this chat" covers the same tool, and for Bash the same command.
const sameKind = (a: Approval, tool: string, input: Record<string, unknown>): boolean =>
  a.tool_name === tool && (tool !== 'Bash' || (JSON.parse(a.input) as { command?: string }).command === input.command)

export function requestApproval(db: Store, session: string, tool: string, input: Record<string, unknown>, toolUseId?: string): Approval {
  const id = 'P-' + randomBytes(4).toString('hex')
  const t = now()
  // Outward calls (messages, tickets, pushes) are never covered by an earlier "allow for this chat".
  const standing = !isOutward(tool, input) && (db.prepare("SELECT * FROM approvals WHERE session_id = ? AND status = 'allowed' AND scope = 'chat'").all(session) as Approval[])
    .some((a) => sameKind(a, tool, input))
  db.prepare('INSERT INTO approvals (id, session_id, tool_name, input, tool_use_id, status, scope, result, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, session, tool, JSON.stringify(input), toolUseId ?? null,
      standing ? 'allowed' : 'pending', standing ? 'chat' : null,
      standing ? JSON.stringify({ behavior: 'allow', updatedInput: input }) : null, t, standing ? t : null)
  return getApproval(db, id)
}

export function getApproval(db: Store, id: string): Approval {
  const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Approval | undefined
  if (!a) throw new BoardError(`no approval ${id}`)
  return a
}

export function answerApproval(db: Store, id: string, ans: Answer): Approval {
  const a = getApproval(db, id)
  if (a.status !== 'pending') throw new BoardError(`${id} is already ${a.status}`)
  if (!ans.allow && !ans.message.trim()) throw new BoardError('a denial needs a reason for Claude')
  if (ans.allow && ans.scope === 'chat' && isOutward(a.tool_name, JSON.parse(a.input))) throw new BoardError('something sent outside is approved one at a time')
  const result = ans.allow
    ? { behavior: 'allow', updatedInput: ans.updatedInput ?? JSON.parse(a.input) }
    : { behavior: 'deny', message: ans.message.trim() }
  db.prepare('UPDATE approvals SET status = ?, scope = ?, result = ?, answered_at = ? WHERE id = ?')
    .run(ans.allow ? 'allowed' : 'denied', ans.allow ? ans.scope ?? 'once' : null, JSON.stringify(result), now(), id)
  return getApproval(db, id)
}

// The user answers this one in the terminal instead (or nobody answered in time): the hook steps aside and
// Claude Code shows its normal prompt there.
export function leaveToTerminal(db: Store, id: string): Approval {
  const a = getApproval(db, id)
  if (a.status !== 'pending') throw new BoardError(`${id} is already ${a.status}`)
  db.prepare("UPDATE approvals SET status = 'terminal', answered_at = ? WHERE id = ?").run(now(), id)
  return getApproval(db, id)
}

// The permission hook gives up after 600 s (hooks.json) and Claude Code then asks in the terminal. A prompt still
// pending after that lost its hook (the app quit, the session ended) and cannot be answered here any more.
export const PERMISSION_HOOK_MS = 600_000

// Prompts nobody can answer from the app any more go to the terminal, so they stop counting as waiting on you.
export function expireStaleApprovals(db: Store, at = Date.now()): number {
  const stale = pendingApprovals(db).filter((a) => at - Date.parse(a.created_at) > PERMISSION_HOOK_MS)
  for (const a of stale) leaveToTerminal(db, a.id)
  return stale.length
}

export const pendingApprovals = (db: Store): Approval[] =>
  db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at, rowid").all() as Approval[]
