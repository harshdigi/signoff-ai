// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { expireStaleApprovals, type Approval } from '../shared/approvals'
import { isOutward, serviceOf } from '../shared/outward'
import type { Subtask, Ticket } from '../shared/tickets'
import type { Store } from './store'
import type { TestCase } from '../shared/testplan'
import type { Comment } from '../shared/comments'

// The board as the window sees it: one snapshot read in a single transaction, so it is never half-updated.
export interface ThreadEntry { who: string; text: string; at: string; verdict?: string | null }
export interface Decision {
  id: string; ticket: string; number: string; session: string | null; question: string; options: string[]; recommend: string | null
  evidence: string[]; refs: string[]; action: 'consent' | 'terminal' | null; command: string | null; kind: string | null; item: string | null
  context: string[]; if_wrong: string | null; draft: string | null
  product_note: string | null; product_at: string | null  // open for product (shared/board.ts openForProduct)
  later_at: string | null                                 // set aside for later (shared/board.ts setAside)
  status: 'open' | 'answered' | 'applied' | 'withdrawn'; answer: string | null; answered_by: string | null; answered_at: string | null
  withdrawn_reason: string | null; withdrawn_by: string | null; withdrawn_at: string | null; created_at: string; updated_at: string
  // Only how many: the messages are fetched when the thread is opened (board:thread), so the board stays small.
  thread_count: number
}
// diff: null for closed reviews (fetched when opened: board:reviewDiff), so the board stays small; lines: its size.
export interface Change { id: string; file: string; diff: string | null; lines: number; verdict: 'pending' | 'accept' | 'reject' | 'question'; comment: string | null; thread: ThreadEntry[] }
export interface Review {
  id: string; ticket: string; session: string | null; title: string; summary: string | null
  status: 'open' | 'accepted' | 'changes_requested' | 'replaced' | 'dismissed'; note: string | null; created_at: string; submitted_at: string | null; updated_at: string
  changes: Change[]
}
export interface Session {
  id: string; title: string | null; description: string | null; note: string | null; ticket: string | null
  state: 'starting' | 'working' | 'waiting' | 'done'; cwd: string | null; branch: string | null; tty: string | null
  pid: number | null; archived: boolean; started_at: string; updated_at: string
  via: string | null; mode: string | null; model: string | null   // via 'chat' = an IDE chat
  effort: string | null                                            // last /effort set from the composer
  parent_id: string | null; context_used: number | null; context_window: number | null; workflow: string | null; role: string | null; tmux: string | null
  pending: number                    // undelivered board messages
}
export interface Message { id: string; session: string; text: string; by: string; created_at: string; delivered_at: string | null; via: string | null; decision_id: string | null; submitted_at: string | null; failed: string | null }
export interface BoardState { comments: Comment[]; tests: TestCase[]; sessions: Session[]; decisions: Decision[]; reviews: Review[]; approvals: (Approval & { outward: boolean; service: string })[]; messages: Message[]; tickets: (Ticket & { subtasks: Subtask[] })[] }

type Row = Record<string, unknown>
const parse = (v: unknown): string[] => (typeof v === 'string' ? (JSON.parse(v) as string[]) : [])
const group = <T extends Row>(rows: T[], key: string): Map<string, T[]> => {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(String(r[key]), [...(m.get(String(r[key])) || []), r])
  return m
}

// Changes when the store changed: data_version for other connections' commits, total_changes for this connection's writes.
export const changeStamp = (db: Store): string =>
  `${db.pragma('data_version', { simple: true })}:${(db.prepare('SELECT total_changes() AS n').get() as { n: number }).n}`

// A decision's messages (questions you asked under it and the session's answers), for its opened thread.
export const decisionThread = (db: Store, id: string): ThreadEntry[] =>
  db.prepare('SELECT who, text, at FROM decision_thread WHERE decision_id = ? ORDER BY id').all(id) as ThreadEntry[]

export function readBoard(db: Store): BoardState {
  return db.transaction((): BoardState => {
    const pending = new Map((db.prepare('SELECT session_id, count(*) AS n FROM messages WHERE delivered_at IS NULL GROUP BY session_id').all() as { session_id: string; n: number }[]).map((r) => [r.session_id, r.n]))
    const sessions = (db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Row[]).map((s) => ({
      ...(s as unknown as Session), archived: Boolean(s.archived), pending: pending.get(String(s.id)) || 0
    }))
    const dThreads = new Map((db.prepare('SELECT decision_id, count(*) AS n FROM decision_thread GROUP BY decision_id').all() as { decision_id: string; n: number }[]).map((r) => [r.decision_id, r.n]))
    const decisions = (db.prepare('SELECT * FROM decisions ORDER BY created_at, rowid').all() as Row[]).map((d) => ({
      ...(d as unknown as Decision), session: (d.session_id as string) ?? null,
      options: parse(d.options), evidence: parse(d.evidence), refs: parse(d.refs), context: parse(d.context),
      thread_count: dThreads.get(String(d.id)) ?? 0
    }))
    const rThreads = group(db.prepare("SELECT review_id || '/' || change_id AS k, who, text, verdict, at FROM review_thread ORDER BY id").all() as Row[], 'k')
    const changes = group(db.prepare('SELECT * FROM review_changes ORDER BY rowid').all() as Row[], 'review_id')
    const reviews = (db.prepare('SELECT * FROM reviews ORDER BY created_at, rowid').all() as Row[]).map((r) => ({
      ...(r as unknown as Review), session: (r.session_id as string) ?? null,
      changes: (changes.get(String(r.id)) || []).map((c) => ({
        id: String(c.change_id), file: String(c.file), diff: r.status === 'open' ? String(c.diff) : null, lines: String(c.diff).split('\n').length, verdict: c.verdict as Change['verdict'], comment: (c.comment as string) ?? null,
        thread: (rThreads.get(`${r.id}/${c.change_id}`) || []).map(({ who, text, verdict, at }) => ({ who, text, verdict, at }) as ThreadEntry)
      }))
    }))
    expireStaleApprovals(db)
    const approvals = (db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at, rowid").all() as Approval[])
      .map((a) => ({ ...a, outward: isOutward(a.tool_name, JSON.parse(a.input)), service: serviceOf(a.tool_name) }))
    const messages = db.prepare('SELECT id, session_id AS session, text, by, created_at, delivered_at, via, decision_id, submitted_at, failed FROM messages ORDER BY created_at, rowid').all() as Message[]
    const subs = group(db.prepare('SELECT * FROM subtasks ORDER BY idx').all() as Row[], 'ticket')
    const tickets = (db.prepare('SELECT * FROM tickets ORDER BY updated_at DESC').all() as Ticket[]).map((t) => ({
      ...t, subtasks: (subs.get(t.key) || []).map((s) => ({ ...(s as unknown as Subtask), decisions: parse(s.decisions) }))
    }))
    const tests = db.prepare('SELECT * FROM test_cases ORDER BY plan, idx').all() as TestCase[]
    const comments = db.prepare('SELECT * FROM comments ORDER BY id').all() as Comment[]
    return { comments, tests, sessions, decisions, reviews, approvals, messages, tickets }
  })()
}
