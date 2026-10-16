// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'fs'
import type { Store } from '../main/store'
import { addToThread, answer, ack } from './board'

// Decisions the chat has moved past: you kept talking in the chat (or typing in the terminal) instead of answering
// the card, so the decision may already be settled there, or no longer matter.

// The same, read from the end of the transcript file: the last prompt is near the end, and reading a 100 MB transcript
// whole made every end of turn wait over a second. Reads 1 MB, then twice as much, until a prompt or the start.
export function lastPromptAtFile(path: string): string | null {
  if (!existsSync(path)) return null
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    for (let n = 1 << 20; ; n *= 2) {
      const len = Math.min(n, size)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, size - len)
      let text = buf.toString('utf8')
      if (len < size) text = text.slice(text.indexOf('\n') + 1) // the first line is cut off: drop it
      const at = lastPromptAt(text)
      if (at || len === size) return at
    }
  } finally {
    closeSync(fd)
  }
}

// When you last wrote to Claude, from its transcript (JSON lines): the newest user message that is your text,
// not a tool result or Claude Code's own meta line. Null when there is none.
export function lastPromptAt(transcript: string): string | null {
  const lines = transcript.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue
    let e: { type?: string; isMeta?: boolean; timestamp?: string; message?: { content?: unknown } }
    try { e = JSON.parse(lines[i]) } catch { continue }
    if (e.type !== 'user' || e.isMeta || !e.timestamp) continue
    const c = e.message?.content
    const mine = typeof c === 'string' ? c.trim() !== '' : Array.isArray(c) && c.some((b: { type?: string }) => b.type === 'text')
    if (mine) return e.timestamp
  }
  return null
}

// What the app noted on a decision when it asked the session to check it; also how it knows it asked once already.
export const ASKED_NOTE = 'Signoff AI asked the session to close this if the chat settled it'

// Open "ask" decisions of this session that you have written to Claude since they were posted, and that the app has
// not asked about yet. Parked ones (waiting on product, set aside for later) are not counted: you parked them.
export function staleDecisions(db: Store, session: string, promptAt: string | null): { id: string; ticket: string; number: string; question: string }[] {
  if (!promptAt) return []
  const at = Date.parse(promptAt)
  const open = db.prepare(`SELECT id, ticket, number, question, created_at FROM decisions
    WHERE session_id = ? AND status = 'open' AND level = 'ask' AND action IS NULL AND product_at IS NULL AND later_at IS NULL`).all(session) as
    { id: string; ticket: string; number: string; question: string; created_at: string }[]
  const asked = new Set((db.prepare('SELECT decision_id FROM decision_thread WHERE who = ? AND text = ?').all('board', ASKED_NOTE) as { decision_id: string }[]).map((r) => r.decision_id))
  return open.filter((d) => Date.parse(d.created_at) < at && !asked.has(d.id)).map(({ id, ticket, number, question }) => ({ id, ticket, number, question }))
}

// The Stop hook's message for them; each is noted on its card, so it is asked about once.
export function askToSettle(db: Store, stale: { id: string; ticket: string; number: string; question: string }[]): string {
  for (const d of stale) addToThread(db, d.id, 'board', ASKED_NOTE)
  return [
    'These decisions are still open, but the user has written to you since you posted them:',
    ...stale.map((d) => `- ${d.id}: ${d.question}`),
    '',
    'For each one:',
    '- If the chat settled it (the user picked an option or asked for something else): signoff settle --ticket <KEY> --id D<n> --text "<what was decided>" (add --done if you already implemented it).',
    '- If it no longer applies: signoff withdraw --ticket <KEY> --id D<n> --reason "<why>".',
    '- If you still need the answer: leave it open and say nothing about it.',
    'Then stop.'
  ].join('\n')
}

// Settled in the chat: the decision records what was decided there (by the session that posted it), and with done,
// that it is already implemented. An answered one can be settled again when the chat changes its mind; one already
// implemented (applied) cannot, since changing it then means redoing work: post a new decision instead.
export function settle(db: Store, id: string, session: string, text: string, done: boolean): void {
  const d = db.prepare('SELECT status, answer FROM decisions WHERE id = ?').get(id) as { status: string; answer: string | null } | undefined
  if (!d) throw new Error(`no decision ${id}`)
  if (d.status !== 'open' && d.status !== 'answered') throw new Error(`${id} is ${d.status}; only an open or answered decision can be settled`)
  db.transaction(() => {
    answer(db, id, text, 'chat')
    addToThread(db, id, session, d.status === 'answered' ? `Changed in the chat: ${d.answer ?? ''} → ${text.trim()}` : `Settled in the chat: ${text.trim()}`)
    if (done) ack(db, id, session)
  })()
}
