// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from 'fs'
import type { Store } from './index'

type Row = Record<string, unknown>
type Board = Record<string, Record<string, Row> | Row | undefined>

export type ImportCounts = Record<string, number>

const json = (v: unknown, empty: string): string => (v === undefined || v === null ? empty : JSON.stringify(v))
const rows = (b: Board, key: string): Row[] => Object.values((b[key] as Record<string, Row>) || {})

// Row shapes shared by the one-time import and the catch-up sync.
const sessionRow = (s: Row): Row => ({
  id: s.id, title: s.title ?? null, description: s.description ?? null, note: s.note ?? null,
  ticket: s.ticket ?? null, state: s.state, cwd: s.cwd ?? null, branch: s.branch ?? null,
  tty: s.tty ?? null, pid: s.pid ?? null, archived: s.archived ? 1 : 0, via: s.via ?? null,
  started_at: s.started_at, updated_at: s.updated_at
})
const messageRow = (s: Row, m: Row): Row => ({ id: m.id, session_id: s.id, text: m.text, by: m.by, created_at: m.created_at, delivered_at: m.delivered_at ?? null, via: m.via ?? null })
const decisionRow = (d: Row): Row => ({
  id: d.id, ticket: d.ticket, number: d.number, session_id: d.session ?? null, question: d.question,
  options: json(d.options, '[]'), recommend: d.recommend ?? null, evidence: json(d.evidence, '[]'), refs: json(d.refs, '[]'),
  action: d.action ?? null, command: d.command ?? null, kind: d.kind ?? null, item: d.item ?? null, status: d.status,
  answer: d.answer ?? null, answered_by: d.answered_by ?? null, answered_at: d.answered_at ?? null,
  applied_by: d.applied_by ?? null, applied_at: d.applied_at ?? null,
  withdrawn_reason: d.withdrawn_reason ?? null, withdrawn_by: d.withdrawn_by ?? null, withdrawn_at: d.withdrawn_at ?? null,
  created_at: d.created_at, updated_at: d.updated_at
})
const reviewRow = (r: Row): Row => ({
  id: r.id, ticket: r.ticket, session_id: r.session ?? null, title: r.title, summary: r.summary ?? null, status: r.status,
  note: r.note ?? null, created_at: r.created_at, submitted_at: r.submitted_at ?? null, updated_at: r.updated_at
})
const changeRow = (r: Row, c: Row): Row => ({ review_id: r.id, change_id: c.id, file: c.file, diff: c.diff, verdict: c.verdict, comment: c.comment ?? null })

// One-time import of the prototype's board.json, in a single transaction.
// - Only when the sessions table is empty; never writes back to board.json.
// - Fields with no column go to backlog.extra; any row that fails a constraint aborts the whole import.
export function importBoard(db: Store, boardPath: string): ImportCounts | null {
  const existing = db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }
  if (existing.n > 0) return null
  const board = JSON.parse(readFileSync(boardPath, 'utf8')) as Board
  const counts: ImportCounts = {}
  const bump = (t: string): void => {
    counts[t] = (counts[t] || 0) + 1
  }

  const insSession = db.prepare(`INSERT INTO sessions (id, title, description, note, ticket, state, cwd, branch, tty, pid, archived, via, started_at, updated_at)
    VALUES (@id, @title, @description, @note, @ticket, @state, @cwd, @branch, @tty, @pid, @archived, @via, @started_at, @updated_at)`)
  const insMessage = db.prepare(`INSERT INTO messages (id, session_id, text, by, created_at, delivered_at, via)
    VALUES (@id, @session_id, @text, @by, @created_at, @delivered_at, @via)`)
  const insDecision = db.prepare(`INSERT INTO decisions (id, ticket, number, session_id, question, options, recommend, evidence, refs, action, command, kind, item, status,
    answer, answered_by, answered_at, applied_by, applied_at, withdrawn_reason, withdrawn_by, withdrawn_at, created_at, updated_at)
    VALUES (@id, @ticket, @number, @session_id, @question, @options, @recommend, @evidence, @refs, @action, @command, @kind, @item, @status,
    @answer, @answered_by, @answered_at, @applied_by, @applied_at, @withdrawn_reason, @withdrawn_by, @withdrawn_at, @created_at, @updated_at)`)
  const insDThread = db.prepare('INSERT INTO decision_thread (decision_id, who, text, at) VALUES (?, ?, ?, ?)')
  const insReview = db.prepare(`INSERT INTO reviews (id, ticket, session_id, title, summary, status, note, created_at, submitted_at, updated_at)
    VALUES (@id, @ticket, @session_id, @title, @summary, @status, @note, @created_at, @submitted_at, @updated_at)`)
  const insChange = db.prepare(`INSERT INTO review_changes (review_id, change_id, file, diff, verdict, comment)
    VALUES (@review_id, @change_id, @file, @diff, @verdict, @comment)`)
  const insRThread = db.prepare('INSERT INTO review_thread (review_id, change_id, who, text, verdict, at) VALUES (?, ?, ?, ?, ?, ?)')
  const insBacklog = db.prepare(`INSERT INTO backlog (id, title, problem, evidence, status, extra, created_by, created_at, updated_at)
    VALUES (@id, @title, @problem, @evidence, @status, @extra, @created_by, @created_at, @updated_at)`)
  const insRun = db.prepare(`INSERT INTO runs (id, role, item, status, cap_usd, cost_usd, denied, exit_code, summary, started_at, finished_at)
    VALUES (@id, @role, @item, @status, @cap_usd, @cost_usd, @denied, @exit_code, @summary, @started_at, @finished_at)`)
  const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')

  db.transaction(() => {
    for (const s of rows(board, 'sessions')) {
      insSession.run(sessionRow(s))
      bump('sessions')
      for (const m of (s.inbox as Row[]) || []) {
        insMessage.run(messageRow(s, m))
        bump('messages')
      }
    }
    for (const d of rows(board, 'decisions')) {
      insDecision.run(decisionRow(d))
      bump('decisions')
      for (const t of (d.thread as Row[]) || []) {
        insDThread.run(d.id, t.who, t.text, t.at)
        bump('decision_thread')
      }
    }
    for (const r of rows(board, 'reviews')) {
      insReview.run(reviewRow(r))
      bump('reviews')
      for (const c of (r.changes as Row[]) || []) {
        insChange.run(changeRow(r, c))
        bump('review_changes')
        for (const t of (c.thread as Row[]) || []) {
          insRThread.run(r.id, c.id, t.who, t.text, t.verdict ?? null, t.at)
          bump('review_thread')
        }
      }
    }
    const backlogCols = new Set(['id', 'title', 'problem', 'evidence', 'status', 'created_by', 'created_at', 'updated_at'])
    for (const b of rows(board, 'backlog')) {
      const extra = Object.fromEntries(Object.entries(b).filter(([k]) => !backlogCols.has(k)))
      insBacklog.run({
        id: b.id, title: b.title, problem: b.problem, evidence: json(b.evidence, '[]'), status: b.status,
        extra: JSON.stringify(extra), created_by: b.created_by ?? null, created_at: b.created_at, updated_at: b.updated_at
      })
      bump('backlog')
    }
    for (const r of rows(board, 'runs')) {
      insRun.run({
        id: r.id, role: r.role, item: r.item ?? null, status: r.status, cap_usd: r.cap_usd ?? null, cost_usd: r.cost ?? null,
        denied: r.denied ?? null, exit_code: r.exit ?? null, summary: r.summary ?? null, started_at: r.started_at, finished_at: r.finished_at ?? null
      })
      bump('runs')
    }
    if (board.company) {
      insSetting.run('company', JSON.stringify(board.company))
      bump('settings')
    }
  })()
  return counts
}

// Catch-up at the switch-over (IDE/D6): copy the prototype's sessions, decisions and reviews into a store that
// already has data. The prototype is the source of truth until then, so its version replaces the app's for the
// same id (with its threads, messages and review files); rows only the app has are kept. Backlog, runs and the
// company settings stay in the prototype (IDE/D17). One transaction: all or nothing.
export function syncBoard(db: Store, boardPath: string): ImportCounts {
  const board = JSON.parse(readFileSync(boardPath, 'utf8')) as Board
  const counts: ImportCounts = {}
  const bump = (t: string, n = 1): void => {
    counts[t] = (counts[t] || 0) + n
  }
  const upsert = (table: string, row: Row, key: string): void => {
    const cols = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})
      ON CONFLICT(${key}) DO UPDATE SET ${cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`).join(', ')}`).run(row)
  }
  db.transaction(() => {
    for (const s of rows(board, 'sessions')) {
      upsert('sessions', sessionRow(s), 'id')
      bump('sessions')
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.id)
      for (const m of (s.inbox as Row[]) || []) {
        upsert('messages', messageRow(s, m), 'id')
        bump('messages')
      }
    }
    for (const d of rows(board, 'decisions')) {
      upsert('decisions', decisionRow(d), 'id') // memory triggers keep search current
      bump('decisions')
      db.prepare('DELETE FROM decision_thread WHERE decision_id = ?').run(d.id)
      for (const t of (d.thread as Row[]) || []) db.prepare('INSERT INTO decision_thread (decision_id, who, text, at) VALUES (?, ?, ?, ?)').run(d.id, t.who, t.text, t.at)
    }
    for (const r of rows(board, 'reviews')) {
      upsert('reviews', reviewRow(r), 'id')
      bump('reviews')
      // Reviews have an insert-only memory trigger: refresh their search row here.
      db.prepare("DELETE FROM memory WHERE kind = 'review' AND ref = ?").run(r.id)
      db.prepare("INSERT INTO memory (kind, ref, session, ticket, at, title, body) VALUES ('review', ?, ?, ?, ?, ?, ?)").run(r.id, r.session ?? null, r.ticket, r.created_at, r.title, r.summary ?? '')
      db.prepare('DELETE FROM review_thread WHERE review_id = ?').run(r.id)
      db.prepare('DELETE FROM review_changes WHERE review_id = ?').run(r.id)
      for (const c of (r.changes as Row[]) || []) {
        db.prepare('INSERT INTO review_changes (review_id, change_id, file, diff, verdict, comment) VALUES (@review_id, @change_id, @file, @diff, @verdict, @comment)').run(changeRow(r, c))
        for (const t of (c.thread as Row[]) || []) db.prepare('INSERT INTO review_thread (review_id, change_id, who, text, verdict, at) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, c.id, t.who, t.text, t.verdict ?? null, t.at)
      }
    }
  })()
  return counts
}
