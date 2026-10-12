// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { BoardError, now } from './board'
import type { Store } from '../main/store'

// Code comments from review: select lines in a diff, comment, send to the session's chat (one by one or as a batch).
// Claude answers in the chat and records each answer here (signoff comment reply), so it also shows by the code.
export type Comment = {
  id: number; session_id: string; root: string; path: string; start_line: number; end_line: number
  code: string; text: string; status: 'draft' | 'sent' | 'answered'; reply: string | null; created_at: string; updated_at: string
}
const need = (cond: unknown, msg: string): void => {
  if (!cond) throw new BoardError(msg)
}
const get = (db: Store, id: number): Comment => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Comment | undefined
  need(c, `no comment #c${id}`)
  return c!
}
const MAX_CODE = 4000 // characters of selected code kept with a comment

export function addComment(db: Store, c: { session: string; root: string; path: string; start: number; end: number; code: string; text: string }): Comment {
  need(c.text.trim(), 'the comment is empty')
  need(c.start >= 1 && c.end >= c.start, 'pick the lines to comment on')
  const t = now()
  const r = db.prepare('INSERT INTO comments (session_id, root, path, start_line, end_line, code, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.session, c.root, c.path, c.start, c.end, c.code.slice(0, MAX_CODE), c.text.trim(), t, t)
  return get(db, Number(r.lastInsertRowid))
}

export function editComment(db: Store, id: number, text: string): Comment {
  need(get(db, id).status === 'draft', 'only a comment not sent yet can be edited')
  need(text.trim(), 'the comment is empty')
  db.prepare('UPDATE comments SET text = ?, updated_at = ? WHERE id = ?').run(text.trim(), now(), id)
  return get(db, id)
}

export function removeComment(db: Store, id: number): void {
  db.prepare('DELETE FROM comments WHERE id = ?').run(id)
}

const fence = (path: string): string => (/\.(\w+)$/.exec(path)?.[1] ?? '')

// The chat message for a batch of drafts, and marks them sent. One message, numbered by comment id.
export function sendComments(db: Store, session: string, ids: number[]): string {
  const list = ids.map((id) => get(db, id))
  need(list.length, 'no comments to send')
  need(list.every((c) => c.session_id === session && c.status === 'draft'), 'only this session\'s unsent comments can be sent')
  const body = list.map((c) => [
    `#c${c.id} ${c.root}/${c.path}:${c.start_line}${c.end_line > c.start_line ? `-${c.end_line}` : ''}`,
    '```' + fence(c.path), c.code, '```',
    c.text
  ].join('\n'))
  const t = now()
  db.transaction(() => { for (const c of list) db.prepare("UPDATE comments SET status = 'sent', updated_at = ? WHERE id = ?").run(t, c.id) })()
  return [
    `Review comments (${list.length}). Answer each one here, and record each answer with: signoff comment reply --id <n> --text "..." (n is the number after #c).`,
    '',
    body.join('\n\n')
  ].join('\n')
}

export function replyComment(db: Store, id: number, text: string): Comment {
  need(text.trim(), 'the reply is empty')
  get(db, id)
  db.prepare("UPDATE comments SET status = 'answered', reply = ?, updated_at = ? WHERE id = ?").run(text.trim(), now(), id)
  return get(db, id)
}

export const openComments = (db: Store, session: string): Comment[] =>
  db.prepare("SELECT * FROM comments WHERE session_id = ? AND status = 'sent' ORDER BY id").all(session) as Comment[]
