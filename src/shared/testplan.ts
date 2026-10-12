// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { BoardError, now } from './board'
import type { Store } from '../main/store'

// Test plans: the cases a change must pass before it ships. Drafted by Claude from the diff and the decisions;
// each case is verified by Claude (with evidence) or by you. One plan per ticket, else per session.
export const STATUSES = ['pending', 'pass', 'fail', 'blocked'] as const
export type CaseStatus = (typeof STATUSES)[number]
export type TestCase = {
  plan: string; idx: number; title: string; steps: string; expected: string; status: CaseStatus
  verified_by: 'claude' | 'you' | null; evidence: string | null; created_at: string; updated_at: string
}

const need = (cond: unknown, msg: string): void => {
  if (!cond) throw new BoardError(msg)
}

// A session's plan: its ticket's, or its own when it has no ticket.
export function planOf(db: Store, session: string): string {
  const s = db.prepare('SELECT ticket FROM sessions WHERE id = ?').get(session) as { ticket: string | null } | undefined
  need(s, `no session ${session}`)
  return s!.ticket ?? session
}

export const cases = (db: Store, plan: string): TestCase[] => db.prepare('SELECT * FROM test_cases WHERE plan = ? ORDER BY idx').all(plan) as TestCase[]

export function addCase(db: Store, plan: string, c: { title: string; steps?: string; expected?: string }): TestCase {
  need(c.title.trim(), 'a test case needs a title')
  const idx = ((db.prepare('SELECT MAX(idx) AS m FROM test_cases WHERE plan = ?').get(plan) as { m: number | null }).m ?? 0) + 1
  const t = now()
  db.prepare('INSERT INTO test_cases (plan, idx, title, steps, expected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(plan, idx, c.title.trim(), c.steps?.trim() ?? '', c.expected?.trim() ?? '', t, t)
  return cases(db, plan).find((x) => x.idx === idx)!
}

// Status changes record who verified it; evidence is what was run and what it showed.
export function setCase(db: Store, plan: string, idx: number, f: { status?: CaseStatus; by?: 'claude' | 'you'; evidence?: string | null; title?: string; steps?: string; expected?: string }): TestCase {
  const c = cases(db, plan).find((x) => x.idx === idx)
  need(c, `no test case ${idx} in ${plan}`)
  if (f.status) need(STATUSES.includes(f.status), `status is one of ${STATUSES.join(', ')}`)
  db.prepare(`UPDATE test_cases SET status = ?, verified_by = ?, evidence = ?, title = ?, steps = ?, expected = ?, updated_at = ? WHERE plan = ? AND idx = ?`).run(
    f.status ?? c!.status, f.status ? f.by ?? null : c!.verified_by, f.evidence !== undefined ? f.evidence : c!.evidence,
    f.title ?? c!.title, f.steps ?? c!.steps, f.expected ?? c!.expected, now(), plan, idx)
  return cases(db, plan).find((x) => x.idx === idx)!
}

export function removeCase(db: Store, plan: string, idx: number): void {
  db.prepare('DELETE FROM test_cases WHERE plan = ? AND idx = ?').run(plan, idx)
}
