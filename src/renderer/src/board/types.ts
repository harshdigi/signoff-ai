// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Mirrors src/main/board-state.ts (the renderer can't import main-process code).
export interface ThreadEntry { who: string; text: string; at: string; verdict?: string | null }
export interface Decision {
  id: string; ticket: string; number: string; session: string | null; question: string; options: string[]; recommend: string | null
  evidence: string[]; refs: string[]; action: 'consent' | 'terminal' | null; command: string | null; kind: string | null; item: string | null
  context: string[]; if_wrong: string | null; draft: string | null
  product_note: string | null; product_at: string | null; later_at: string | null
  status: 'open' | 'answered' | 'applied' | 'withdrawn'; answer: string | null; answered_by: string | null; answered_at: string | null
  withdrawn_reason: string | null; withdrawn_by: string | null; withdrawn_at: string | null; created_at: string; thread: ThreadEntry[]
  level: 'ask' | 'inform' | 'auto'
}
// diff: null for closed reviews (fetched when opened: board:reviewDiff), so the board stays small; lines: its size.
export interface Change { id: string; file: string; diff: string | null; lines: number; verdict: 'pending' | 'accept' | 'reject' | 'question'; comment: string | null; thread: ThreadEntry[] }
export interface Review {
  id: string; ticket: string; session: string | null; title: string; summary: string | null
  status: 'open' | 'accepted' | 'changes_requested'; note: string | null; created_at: string; submitted_at: string | null; changes: Change[]
}
export interface Session {
  id: string; title: string | null; description: string | null; note: string | null; ticket: string | null
  state: 'starting' | 'working' | 'waiting' | 'done'; branch: string | null; cwd: string | null; archived: boolean
  started_at: string; updated_at: string; pending: number
  via: string | null; mode: string | null; model: string | null; effort: string | null
  parent_id: string | null; context_used: number | null; context_window: number | null; workflow: string | null; role: string | null; tmux: string | null
}
export interface Approval {
  id: string; session_id: string; tool_name: string; input: string; tool_use_id: string | null
  status: 'pending' | 'allowed' | 'denied'; created_at: string
  outward: boolean; service: string
}
export interface Message { id: string; session: string; text: string; by: string; created_at: string; delivered_at: string | null; via: string | null; decision_id: string | null; submitted_at: string | null; failed: string | null }
export interface Subtask {
  ticket: string; idx: number; title: string; decisions: string[]; jira_key: string | null; branch: string | null
  worktree: string | null; session_id: string | null; status: 'planned' | 'in_progress' | 'review' | 'done'
}
export interface Ticket { key: string; title: string | null; folder: string; strategy: 'main' | 'stacked'; plan_session: string | null; created_at: string; subtasks: Subtask[] }
export type TestCase = {
  plan: string; idx: number; title: string; steps: string; expected: string; status: 'pending' | 'pass' | 'fail' | 'blocked'
  verified_by: 'claude' | 'you' | null; evidence: string | null; created_at: string; updated_at: string
}
export type Comment = {
  id: number; session_id: string; root: string; path: string; start_line: number; end_line: number
  code: string; text: string; status: 'draft' | 'sent' | 'answered'; reply: string | null; created_at: string; updated_at: string
}
export interface BoardState { comments: Comment[]; tests: TestCase[]; sessions: Session[]; decisions: Decision[]; reviews: Review[]; approvals: Approval[]; messages: Message[]; tickets: Ticket[] }

// A stored timestamp (it carries its UTC offset) shown in the viewer's own time zone, e.g. "2026-10-06 15:37 GMT+5:30".
const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
export const time = (s: string | null | undefined): string => {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const p = (n: number): string => String(n).padStart(2, '0')
  const tz = zone.formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? ''
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${tz ? ' ' + tz : ''}`
}
export const label = (s: Session | undefined): string => (s ? s.title || s.ticket || s.id.slice(0, 8) : 'unknown session')
// Open decisions split two ways: sent to the product team, or waiting on you.
export const forProduct = (d: Decision): boolean => d.status === 'open' && !!d.product_at
export const onYou = (d: Decision): boolean => d.status === 'open' && !d.product_at && !d.later_at
export const forLater = (d: Decision): boolean => d.status === 'open' && !!d.later_at
// What a session waits on you for: open decisions (not those sent to product) and reviews, and permission prompts.
export const waitingOn = (b: BoardState, sid: string): number =>
  b.decisions.filter((d) => d.session === sid && onYou(d)).length + b.reviews.filter((r) => r.session === sid && r.status === 'open').length + b.approvals.filter((a) => a.session_id === sid).length

// How long ago, short: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago"; older: the date (time()).
export const ago = (s: string | null | undefined, now = Date.now()): string => {
  if (!s) return ''
  const t = new Date(s).getTime()
  if (isNaN(t)) return s
  const min = Math.round((now - t) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`
  const days = Math.round(min / (24 * 60))
  return days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : time(s)
}
