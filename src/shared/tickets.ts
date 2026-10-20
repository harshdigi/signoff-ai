// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { BoardError, now, setRemoved } from './board'
import type { Store } from '../main/store'

// Tickets and their subtasks (IDE/D16 C). Shared by the app and decide (sessions record the plan with it).
export type Strategy = 'main' | 'stacked'
export const SUBTASK_STATES = ['planned', 'in_progress', 'review', 'done'] as const
export type SubtaskState = (typeof SUBTASK_STATES)[number]
export type Ticket = { key: string; title: string | null; folder: string; strategy: Strategy; plan_session: string | null; closed_at: string | null; created_at: string; updated_at: string }
export type Subtask = {
  ticket: string; idx: number; title: string; decisions: string[]; jira_key: string | null; branch: string | null
  worktree: string | null; session_id: string | null; status: SubtaskState; created_at: string; updated_at: string
}

const need = (c: unknown, m: string): void => {
  if (!c) throw new BoardError(m)
}

export function createTicket(db: Store, t: { key: string; title?: string | null; folder: string; strategy: Strategy }): Ticket {
  const key = t.key.toUpperCase()
  need(/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(key), `not an issue key: ${t.key}`)
  need(!db.prepare('SELECT 1 FROM tickets WHERE key = ?').get(key), `${key} is already started`)
  const at = now()
  db.prepare('INSERT INTO tickets (key, title, folder, strategy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(key, t.title ?? null, t.folder, t.strategy, at, at)
  return getTicket(db, key)
}

export function getTicket(db: Store, key: string): Ticket {
  const t = db.prepare('SELECT * FROM tickets WHERE key = ?').get(key.toUpperCase()) as Ticket | undefined
  need(t, `no ticket ${key}`)
  return t!
}

export function setPlanSession(db: Store, key: string, session: string): void {
  db.prepare('UPDATE tickets SET plan_session = ?, updated_at = ? WHERE key = ?').run(session, now(), key.toUpperCase())
}

// Close ticket (SIGNOFF-28/D1, D4): the ticket and its plan and subtask sessions leave the list.
// - Branches and worktrees stay on disk.
// - Returns those sessions, so the app can stop their Claude processes.
// - Reopen restores the ticket and the same sessions.
const sessionsOf = (db: Store, key: string): string[] =>
  (db.prepare('SELECT id FROM sessions WHERE id IN (SELECT plan_session FROM tickets WHERE key = ? UNION SELECT session_id FROM subtasks WHERE ticket = ?)').all(key, key) as { id: string }[]).map((r) => r.id)

export function closeTicket(db: Store, key: string): string[] {
  const t = getTicket(db, key)
  const ids = sessionsOf(db, t.key)
  db.transaction(() => {
    db.prepare('UPDATE tickets SET closed_at = ?, updated_at = ? WHERE key = ?').run(now(), now(), t.key)
    for (const id of ids) setRemoved(db, id, true)
  })()
  return ids
}

export function reopenTicket(db: Store, key: string): void {
  const t = getTicket(db, key)
  db.transaction(() => {
    db.prepare('UPDATE tickets SET closed_at = NULL, updated_at = ? WHERE key = ?').run(now(), t.key)
    for (const id of sessionsOf(db, t.key)) setRemoved(db, id, false)
  })()
}

const row = (r: Record<string, unknown>): Subtask => ({ ...(r as unknown as Subtask), decisions: JSON.parse(String(r.decisions)) })

export const subtasks = (db: Store, key: string): Subtask[] =>
  (db.prepare('SELECT * FROM subtasks WHERE ticket = ? ORDER BY idx').all(key.toUpperCase()) as Record<string, unknown>[]).map(row)

export function getSubtask(db: Store, key: string, idx: number): Subtask {
  const r = db.prepare('SELECT * FROM subtasks WHERE ticket = ? AND idx = ?').get(key.toUpperCase(), idx) as Record<string, unknown> | undefined
  need(r, `no subtask ${idx} on ${key}`)
  return row(r!)
}

export function addSubtask(db: Store, key: string, s: { title: string; decisions?: string[]; jira?: string | null }): Subtask {
  const t = getTicket(db, key)
  need(s.title.trim(), 'a subtask needs a title')
  const idx = ((db.prepare('SELECT MAX(idx) AS m FROM subtasks WHERE ticket = ?').get(t.key) as { m: number | null }).m ?? 0) + 1
  const ids = (s.decisions ?? []).map((d) => (d.includes('/') ? d : `${t.key}/${d}`).toUpperCase())
  const at = now()
  db.prepare("INSERT INTO subtasks (ticket, idx, title, decisions, jira_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?)")
    .run(t.key, idx, s.title.trim(), JSON.stringify(ids), s.jira?.toUpperCase() ?? null, at, at)
  return getSubtask(db, t.key, idx)
}

export function updateSubtask(db: Store, key: string, idx: number, f: Partial<Pick<Subtask, 'status' | 'jira_key' | 'branch' | 'worktree' | 'session_id' | 'title'>>): Subtask {
  getSubtask(db, key, idx)
  if (f.status) need(SUBTASK_STATES.includes(f.status), `status is one of ${SUBTASK_STATES.join(', ')}`)
  const sets = Object.entries(f).filter(([, v]) => v !== undefined)
  if (sets.length) db.prepare(`UPDATE subtasks SET ${sets.map(([k]) => `${k} = @${k}`).join(', ')}, updated_at = @at WHERE ticket = @key AND idx = @idx`)
    .run({ ...Object.fromEntries(sets.map(([k, v]) => [k, k === 'jira_key' && v ? String(v).toUpperCase() : v])), at: now(), key: key.toUpperCase(), idx })
  return getSubtask(db, key, idx)
}

// Branch name from the template: {KEY} = the subtask's Jira key (else the ticket's), {TICKET}, {n}, {slug}.
export function branchName(template: string, t: Ticket, s: Subtask): string {
  const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 6).join('-')
  return template.replace(/\{KEY\}/g, s.jira_key ?? t.key).replace(/\{TICKET\}/g, t.key).replace(/\{n\}/g, String(s.idx)).replace(/\{slug\}/g, slug)
    .replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/-+/g, '-')
}
