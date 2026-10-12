// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from '../main/store'

// Project memory (IDE/D16 G): everything decided, reviewed and said, searchable later.
// Decisions and reviews are indexed by triggers (migrate-7.sql); chat text is added as it is recorded.
export type Hit = { kind: 'decision' | 'review' | 'chat'; ref: string; session: string | null; ticket: string | null; at: string; title: string; snippet: string }

// Words become quoted prefix terms, so any text is a valid query (no FTS syntax errors).
export const ftsQuery = (q: string): string =>
  q.split(/\s+/).map((w) => w.replace(/["*^:()]/g, '')).filter((w) => w.length > 1).map((w) => `"${w}"*`).join(' ')

export function search(db: Store, q: string, o: { ticket?: string; limit?: number } = {}): Hit[] {
  const fts = ftsQuery(q)
  if (!fts) return []
  return db.prepare(`SELECT kind, ref, session, ticket, at, title, snippet(memory, 6, '[', ']', '…', 14) AS snippet
    FROM memory WHERE memory MATCH @fts ${o.ticket ? 'AND ticket = @ticket' : ''} ORDER BY rank LIMIT @limit`)
    .all({ fts, ticket: o.ticket?.toUpperCase(), limit: o.limit ?? 20 }) as Hit[]
}

type Ev = { type?: string; kind?: string; text?: string; parent_tool_use_id?: string | null; message?: { content?: { type: string; text?: string }[] } }

// ref: a stable id for the message (the transcript line's uuid), so it is indexed once.
export function indexChatEvent(db: Store, session: string, ref: string, ev: Ev, at: string): void {
  const texts = ev.type === 'prompt' && !ev.kind ? [['You asked', ev.text ?? '']]
    : ev.type === 'assistant' && !ev.parent_tool_use_id ? (ev.message?.content ?? []).filter((c) => c.type === 'text' && c.text?.trim()).map((c) => ['Claude replied', c.text!])
    : []
  if (!texts.length) return
  const ticket = (db.prepare('SELECT ticket FROM sessions WHERE id = ?').get(session) as { ticket: string | null } | undefined)?.ticket ?? null
  const ins = db.prepare("INSERT INTO memory (kind, ref, session, ticket, at, title, body) VALUES ('chat', ?, ?, ?, ?, ?, ?)")
  for (const [title, body] of texts) ins.run(`${session}:${ref}`, session, ticket, at, title, body)
}
