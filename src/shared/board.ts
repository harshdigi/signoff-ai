// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { randomBytes } from 'crypto'
import type { Store } from '../main/store'

// Board operations shared by the app (main process) and the decide CLI.
// Ported from the prototype's store.py + decide; same rules, same IDs, same messages.

export const SESSION_STATES = ['starting', 'working', 'waiting', 'done'] as const
export const VERDICTS = ['pending', 'accept', 'reject', 'question'] as const
export type SessionState = (typeof SESSION_STATES)[number]
export type Verdict = (typeof VERDICTS)[number]

export class BoardError extends Error {}

// ISO-8601 in this machine's local time with its UTC offset, seconds precision ("2026-10-06T15:37:56+05:30" in India).
// Same shape as the prototype's IST stamps, so older rows read the same way.
export function now(date = new Date()): string {
  const off = -date.getTimezoneOffset()
  const local = new Date(date.getTime() + off * 60_000).toISOString().slice(0, 19)
  const a = Math.abs(off)
  return `${local}${off >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

export const decisionId = (ticket: string, number: string): string => `${ticket.toUpperCase()}/${number.toUpperCase()}`

const need = (cond: unknown, msg: string): void => {
  if (!cond) throw new BoardError(msg)
}

// ---- sessions ---------------------------------------------------------------

export interface SessionFields {
  title?: string | null; description?: string | null; note?: string | null; ticket?: string | null
  state?: SessionState; cwd?: string | null; branch?: string | null; tty?: string | null; pid?: number | null
  archived?: boolean; via?: string | null
}

// Create or update a session; fields left undefined are untouched (as touch_session did).
export function touchSession(db: Store, id: string, fields: SessionFields): void {
  const t = now()
  db.prepare(`INSERT INTO sessions (id, state, started_at, updated_at) VALUES (?, 'working', ?, ?) ON CONFLICT(id) DO NOTHING`).run(id, t, t)
  const sets = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (fields.state) need(SESSION_STATES.includes(fields.state), `bad state ${fields.state}`)
  const cols = sets.map(([k]) => `${k} = @${k}`).concat('updated_at = @updated_at').join(', ')
  const vals = Object.fromEntries(sets.map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v]))
  db.prepare(`UPDATE sessions SET ${cols} WHERE id = @id`).run({ ...vals, updated_at: t, id })
}

// The user's own name for a session or chat.
export function renameSession(db: Store, id: string, title: string): void {
  need(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id), `no session ${id}`)
  const t = title.trim()
  need(t, 'the name is empty')
  need(t.length <= 80, 'the name is 80 characters at most')
  touchSession(db, id, { title: t })
}

// Removing hides a session or chat from the lists; its decisions, reviews and messages stay in history.
// A terminal session that registers again (it was resumed) shows up again by itself.
export function setRemoved(db: Store, id: string, removed: boolean): void {
  need(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id), `no session ${id}`)
  touchSession(db, id, { archived: removed })
}

// ---- decisions --------------------------------------------------------------

export interface PostDecision {
  ticket: string; number: string; session: string; question: string
  options?: string[]; recommend?: string | null; evidence?: string[]; refs?: string[]
  action?: 'consent' | 'terminal' | null; command?: string | null; force?: boolean
  level?: Level
  context?: string[]; ifWrong?: string | null  // what's going on, and what a wrong choice costs
  draft?: string | null  // the exact text you approve (a reply, a commit message), shown as is
}

export const LEVELS = ['ask', 'inform', 'auto'] as const
export type Level = (typeof LEVELS)[number]

export function postDecision(db: Store, p: PostDecision): string {
  const id = decisionId(p.ticket, p.number)
  const old = db.prepare('SELECT status, created_at FROM decisions WHERE id = ?').get(id) as { status: string; created_at: string } | undefined
  need(!old || old.status === 'open' || p.force, `${id} is already ${old?.status}; pass force to reopen it`)
  need(p.action !== 'terminal' || (p.command || '').trim(), '--action terminal needs --command')
  const level = p.level ?? 'ask'
  need(LEVELS.includes(level), `--level is ask, inform or auto`)
  // inform/auto are settled by Claude: they must say what was decided and what in the code settles it.
  if (level !== 'ask') {
    need(!p.action, `--level ${level} cannot be an action; actions always wait for the user`)
    need((p.recommend || '').trim(), `--level ${level} needs --recommend: what you decided`)
    need(p.evidence?.length, `--level ${level} needs --evidence: the code or doc that already settles it`)
  }
  const options = p.options?.length ? p.options : p.action === 'consent' ? ['Approve', 'Decline'] : p.action === 'terminal' ? ['Done'] : []
  const t = now()
  const settled = level !== 'ask'
  db.transaction(() => {
    touchSession(db, p.session, { ticket: p.ticket.toUpperCase() })
    db.prepare(`INSERT INTO decisions (id, ticket, number, session_id, question, options, recommend, evidence, refs, action, command, level, status, answer, answered_by, answered_at, context, if_wrong, draft, created_at, updated_at)
      VALUES (@id, @ticket, @number, @session, @question, @options, @recommend, @evidence, @refs, @action, @command, @level, @status, @answer, @answered_by, @answered_at, @context, @if_wrong, @draft, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, question = excluded.question, options = excluded.options, context = excluded.context, if_wrong = excluded.if_wrong, draft = excluded.draft,
        recommend = excluded.recommend, evidence = excluded.evidence, refs = excluded.refs, action = excluded.action,
        command = excluded.command, level = excluded.level, status = excluded.status, answer = excluded.answer,
        answered_by = excluded.answered_by, answered_at = excluded.answered_at, updated_at = excluded.updated_at`).run({
      id, ticket: p.ticket.toUpperCase(), number: p.number.toUpperCase(), session: p.session, question: p.question,
      options: JSON.stringify(options), recommend: p.recommend ?? null, evidence: JSON.stringify(p.evidence ?? []),
      refs: JSON.stringify((p.refs ?? []).map((r) => r.toUpperCase())), action: p.action ?? null,
      command: p.command ? p.command.split(/\s+/).join(' ') : null, created_at: old?.created_at ?? t, updated_at: t,
      level, status: settled ? 'answered' : 'open', answer: settled ? p.recommend!.trim() : null,
      answered_by: settled ? `claude (${level})` : null, answered_at: settled ? t : null,
      context: JSON.stringify((p.context ?? []).map((c) => c.trim()).filter(Boolean)), if_wrong: p.ifWrong?.trim() || null,
      draft: p.draft?.trim() || null
    })
  })()
  return id
}

export function answer(db: Store, id: string, text: string, by: string): void {
  need(text.trim(), 'answer is empty')
  const r = db.prepare(`UPDATE decisions SET status = 'answered', answer = ?, answered_by = ?, answered_at = ?, updated_at = ? WHERE id = ?`)
    .run(text.trim(), by, now(), now(), id)
  need(r.changes === 1, `no decision ${id}`)
}

export function ack(db: Store, id: string, by: string): void {
  const d = db.prepare('SELECT status FROM decisions WHERE id = ?').get(id) as { status: string } | undefined
  need(d, `no decision ${id}`)
  need(d!.status === 'answered', `${id} is ${d!.status}, not answered`)
  db.prepare(`UPDATE decisions SET status = 'applied', applied_by = ?, applied_at = ?, updated_at = ? WHERE id = ?`).run(by, now(), now(), id)
}

export function withdraw(db: Store, id: string, by: string, reason: string): void {
  need(reason.trim(), 'say why it is withdrawn')
  const d = db.prepare('SELECT status FROM decisions WHERE id = ?').get(id) as { status: string } | undefined
  need(d, `no decision ${id}`)
  need(d!.status === 'open', `${id} is ${d!.status}, not open`)
  db.prepare(`UPDATE decisions SET status = 'withdrawn', withdrawn_reason = ?, withdrawn_by = ?, withdrawn_at = ?, updated_at = ? WHERE id = ?`)
    .run(reason.trim(), by, now(), now(), id)
}

// The user disagrees with something Claude settled (inform/auto): it becomes an open ask again,
// and the session hears why through its board messages.
export function object(db: Store, id: string, reason: string): void {
  need(reason.trim(), 'say what you disagree with')
  const d = db.prepare('SELECT session_id, level, status, question, answer FROM decisions WHERE id = ?').get(id) as { session_id: string | null; level: Level; status: string; question: string; answer: string } | undefined
  need(d, `no decision ${id}`)
  need(d!.level !== 'ask', `${id} was asked, not decided by Claude; answer it instead`)
  need(d!.status === 'answered' || d!.status === 'applied', `${id} is ${d!.status}`)
  db.transaction(() => {
    db.prepare(`UPDATE decisions SET level = 'ask', status = 'open', answer = NULL, answered_by = NULL, answered_at = NULL, applied_by = NULL, applied_at = NULL, updated_at = ? WHERE id = ?`).run(now(), id)
    addToThread(db, id, 'you', `Objected to "${d!.answer}": ${reason.trim()}`)
    if (d!.session_id && db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(d!.session_id))
      queueMessage(db, d!.session_id, `The user objects to ${id} ("${d!.question}"), which you settled as ${d!.level}: ${reason.trim()}\nIt is an open ask decision now. Rework or re-propose, then wait for their answer.`, 'board')
  })()
}

export function addToThread(db: Store, id: string, who: string, text: string): void {
  need(text.trim(), 'text is empty')
  need(db.prepare('SELECT 1 FROM decisions WHERE id = ?').get(id), `no decision ${id}`)
  db.prepare('INSERT INTO decision_thread (decision_id, who, text, at) VALUES (?, ?, ?, ?)').run(id, who, text.trim(), now())
}

// A question you ask under a decision: kept in its thread, and sent to the session that posted it, which answers in
// the thread (signoff reply) so the answer shows under the decision.
export function askAbout(db: Store, id: string, text: string): void {
  const d = db.prepare('SELECT session_id, ticket, number, question FROM decisions WHERE id = ?').get(id) as { session_id: string | null; ticket: string; number: string; question: string } | undefined
  need(d, `no decision ${id}`)
  need(d!.session_id && db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(d!.session_id), `${id} has no session to answer it`)
  db.transaction(() => {
    addToThread(db, id, 'you', text)
    queueMessage(db, d!.session_id!, `The user asks about ${id} ("${d!.question}"): ${text.trim()}\nAnswer under the decision as short points, one per line ("- ..."), written to a file: signoff reply --ticket ${d!.ticket} --id ${d!.number} --text-file <file> (do not change the decision itself).`, 'board', id)
  })()
}

// Open for product: you need the product team's answer before deciding. The decision stays open, stops counting
// as waiting on you, and the session is told to park it and keep going. Answering it later works as usual.
export function openForProduct(db: Store, id: string, note: string): void {
  need(note.trim(), 'say what you need from product')
  const d = db.prepare('SELECT session_id, status, question FROM decisions WHERE id = ?').get(id) as { session_id: string | null; status: string; question: string } | undefined
  need(d, `no decision ${id}`)
  need(d!.status === 'open', `${id} is ${d!.status}; only an open decision can wait on product`)
  db.transaction(() => {
    db.prepare('UPDATE decisions SET product_note = ?, product_at = ?, updated_at = ? WHERE id = ?').run(note.trim(), now(), now(), id)
    addToThread(db, id, 'you', `Open for product: ${note.trim()}`)
    tellSession(db, d!.session_id, `The user sent ${id} ("${d!.question}") to the product team: ${note.trim()}\nDo not wait for it and do not ask it again. Keep working on what does not depend on it; the answer comes as usual when product replies.`)
  })()
}

// Back with you: product answered elsewhere, or it no longer needs them.
export function backFromProduct(db: Store, id: string): void {
  const d = db.prepare('SELECT product_at FROM decisions WHERE id = ?').get(id) as { product_at: string | null } | undefined
  need(d, `no decision ${id}`)
  need(d!.product_at, `${id} is not open for product`)
  db.transaction(() => {
    db.prepare('UPDATE decisions SET product_note = NULL, product_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
    addToThread(db, id, 'you', 'No longer waiting on product')
  })()
}

// Later: you put a decision aside. It stays open but leaves "Waiting on you"; its session stops waiting for it.
export function setAside(db: Store, id: string): void {
  const d = db.prepare('SELECT session_id, status, question, product_at, later_at FROM decisions WHERE id = ?').get(id) as
    { session_id: string | null; status: string; question: string; product_at: string | null; later_at: string | null } | undefined
  need(d, `no decision ${id}`)
  need(d!.status === 'open', `${id} is ${d!.status}; only an open decision can be set aside`)
  need(!d!.product_at, `${id} is waiting on product; bring it back first`)
  need(!d!.later_at, `${id} is already set aside`)
  db.transaction(() => {
    db.prepare('UPDATE decisions SET later_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
    addToThread(db, id, 'you', 'Set aside for later')
    tellSession(db, d!.session_id, `The user set ${id} ("${d!.question}") aside for later.\nDo not wait for it and do not ask it again. Keep working on what does not depend on it; the answer comes as usual when they pick it up.`)
  })()
}

// Bring back: a decision set aside is waiting on you again.
export function bringBack(db: Store, id: string): void {
  const d = db.prepare('SELECT later_at FROM decisions WHERE id = ?').get(id) as { later_at: string | null } | undefined
  need(d, `no decision ${id}`)
  need(d!.later_at, `${id} is not set aside`)
  db.transaction(() => {
    db.prepare('UPDATE decisions SET later_at = NULL, updated_at = ? WHERE id = ?').run(now(), id)
    addToThread(db, id, 'you', 'Brought back from later')
  })()
}

// Reopen: undo a dismiss (or a session's withdraw). The decision is open again and its session hears so.
export function reopen(db: Store, id: string): void {
  const d = db.prepare('SELECT session_id, status, question, ticket, number, withdrawn_reason FROM decisions WHERE id = ?').get(id) as
    { session_id: string | null; status: string; question: string; ticket: string; number: string; withdrawn_reason: string | null } | undefined
  need(d, `no decision ${id}`)
  need(d!.status === 'withdrawn', `${id} is ${d!.status}; only a dismissed decision can be reopened`)
  db.transaction(() => {
    db.prepare(`UPDATE decisions SET status = 'open', withdrawn_reason = NULL, withdrawn_by = NULL, withdrawn_at = NULL, updated_at = ? WHERE id = ?`).run(now(), id)
    addToThread(db, id, 'you', `Reopened (it was withdrawn: ${d!.withdrawn_reason ?? 'no reason given'})`)
    tellSession(db, d!.session_id, `The user reopened ${id} ("${d!.question}"); it was withdrawn earlier. It is open again: wait for the answer as usual (signoff wait --ticket ${d!.ticket} --id ${d!.number}).`)
  })()
}

// A board message to a decision's session, when that session is still on the board.
function tellSession(db: Store, session: string | null, text: string): void {
  if (session && db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(session)) queueMessage(db, session, text, 'board')
}

// ---- inbox ------------------------------------------------------------------

export interface Message { id: string; text: string; by: string; created_at: string }

// decision: the decision the message is about, so its card can show whether it reached the session.
export function queueMessage(db: Store, session: string, text: string, by: string, decision: string | null = null): Message {
  need(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(session), `no session ${session}`)
  need(text.trim(), 'message is empty')
  const m = { id: randomBytes(4).toString('hex'), text: text.trim(), by, created_at: now() }
  db.prepare('INSERT INTO messages (id, session_id, text, by, created_at, decision_id) VALUES (?, ?, ?, ?, ?, ?)').run(m.id, session, m.text, by, m.created_at, decision)
  return m
}

// A message the user typed straight into the session's own terminal (the app owns that terminal).
// Logged as already delivered, so the Stop hook never hands it over a second time.
export function logTyped(db: Store, session: string, text: string): Message {
  need(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(session), `no session ${session}`)
  need(text.trim(), 'message is empty')
  const t = now()
  const m = { id: randomBytes(4).toString('hex'), text: text.trim(), by: 'typed', created_at: t }
  db.prepare('INSERT INTO messages (id, session_id, text, by, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.id, session, m.text, m.by, t, t)
  return m
}

export function pendingMessages(db: Store, session: string): Message[] {
  return db.prepare('SELECT id, text, by, created_at FROM messages WHERE session_id = ? AND delivered_at IS NULL ORDER BY created_at, rowid').all(session) as Message[]
}

// Marks every undelivered message delivered and returns them, in one transaction (two readers never both get one).
// - via 'terminal': typed into the session's terminal; submitted only once the app sees the input box empty
//   (markSubmitted / markFailed). Every other way (Stop hook, signoff wait, inbox) hands it to Claude directly.
export function popMessages(db: Store, session: string, via: string | null = null): Message[] {
  return db.transaction(() => {
    const msgs = pendingMessages(db, session)
    const t = now()
    const upd = db.prepare('UPDATE messages SET delivered_at = ?, via = ?, submitted_at = ?, failed = NULL WHERE id = ?')
    for (const m of msgs) upd.run(t, via, via === 'terminal' ? null : t, m.id)
    return msgs
  })()
}

export function markSubmitted(db: Store, ids: string[]): void {
  const upd = db.prepare('UPDATE messages SET submitted_at = ?, failed = NULL WHERE id = ?')
  for (const id of ids) upd.run(now(), id)
}

export function markFailed(db: Store, ids: string[], reason: string): void {
  const upd = db.prepare('UPDATE messages SET failed = ? WHERE id = ? AND submitted_at IS NULL')
  for (const id of ids) upd.run(reason, id)
}

// Resend: back in the queue as if new; returns the session it goes to.
export function resendMessage(db: Store, id: string): string {
  const m = db.prepare('SELECT session_id FROM messages WHERE id = ?').get(id) as { session_id: string } | undefined
  need(m, `no message ${id}`)
  db.prepare('UPDATE messages SET delivered_at = NULL, via = NULL, submitted_at = NULL, failed = NULL WHERE id = ?').run(id)
  return m!.session_id
}

// Your answer on the board, and a message telling its session, linked to the decision so the card shows delivery.
// Returns the session to wake, or null when the decision has no live session.
export function answerFromBoard(db: Store, id: string, text: string): string | null {
  const d = db.prepare('SELECT session_id, ticket, number, question FROM decisions WHERE id = ?').get(id) as { session_id: string | null; ticket: string; number: string; question: string } | undefined
  need(d, `no decision ${id}`)
  const live = d!.session_id && db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(d!.session_id) ? d!.session_id : null
  db.transaction(() => {
    answer(db, id, text, 'board')
    if (live) queueMessage(db, live, `The user answered ${id} ("${d!.question}"): ${text.trim()}\nAct on it now, then: signoff ack --ticket ${d!.ticket} --id ${d!.number}`, 'board', id)
  })()
  return live
}

// ---- reviews ----------------------------------------------------------------

const DIFF_GIT = /^diff --git a\/(\S+) b\/(\S+)/
const PLUS_FILE = /^\+\+\+ (?:b\/)?(\S+)/
const HASH_FILE = /^#\s+(\S+\.\w+|\S+\/\S+)/

// Splits a proposed diff into one change per file (`diff --git`, `+++ b/<file>`, or `# path  (note)` headers).
export function splitPatch(text: string, defaultFile = 'proposal'): { file: string; diff: string }[] {
  type Part = { file: string; lines: string[] }
  const out: Part[] = []
  let cur: Part | null = null
  const start = (file: string): Part => {
    const part: Part = { file, lines: [] }
    out.push(part)
    return part
  }
  for (const line of text.split('\n')) {
    let m = DIFF_GIT.exec(line)
    if (m) { cur = start(m[2]); cur.lines.push(line); continue }
    // A "--- a/…" line after a hunk starts the next file (plain diffs of several files, no "diff --git" lines);
    // its "+++ b/…" line then names it.
    if (/^--- \S/.test(line) && cur?.lines.some((l) => l.startsWith('@@'))) { cur = start(defaultFile); cur.lines.push(line); continue }
    m = PLUS_FILE.exec(line)
    if (m && (cur === null || !cur.lines.some((l) => l.startsWith('+++')))) {
      const onlyHeaders = cur !== null && cur.lines.every((l) => /^(diff|---|index)/.test(l))
      if (cur === null || (cur.file !== m[1] && !onlyHeaders)) cur = start(m[1])
      else if (onlyHeaders) cur.file = m[1] // a "--- a/…" line came first: the "+++ b/…" line names this file
      cur.lines.push(line); continue
    }
    m = HASH_FILE.exec(line)
    if (m && !line.startsWith('#!')) { cur = start(m[1]); cur.lines.push(line); continue }
    if (cur === null) cur = start(defaultFile)
    cur.lines.push(line)
  }
  return out.filter((c) => c.lines.join('').trim()).map((c) => ({ file: c.file, diff: c.lines.join('\n').replace(/^\n+|\n+$/g, '') }))
}

const nextId = (db: Store, table: 'reviews' | 'backlog' | 'runs', prefix: string): string => {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(prefix + '-%') as { id: string }[]
  return `${prefix}-${1 + Math.max(0, ...rows.map((r) => Number(r.id.split('-')[1]) || 0))}`
}

// A new review replaces the session's older open reviews for the same ticket (SIGNOFF-10/D2): they are closed as
// "replaced", and a file whose diff is unchanged from one you accepted there stays accepted (SIGNOFF-10/D1).
export function addReview(db: Store, p: { ticket: string; session: string; title: string; summary?: string; patch: string; defaultFile?: string }):
  { id: string; changes: { id: string; file: string }[]; replaced: string[]; kept: string[] } {
  const parts = splitPatch(p.patch, p.defaultFile)
  need(parts.length, 'the patch is empty')
  return db.transaction(() => {
    const id = nextId(db, 'reviews', 'R')
    const t = now()
    const ticket = p.ticket.toUpperCase()
    touchSession(db, p.session, { ticket })
    const replaced = (db.prepare("SELECT id FROM reviews WHERE session_id = ? AND ticket = ? AND status = 'open' ORDER BY rowid").all(p.session, ticket) as { id: string }[]).map((r) => r.id)
    const accepted = replaced.length
      ? db.prepare(`SELECT review_id, file, diff FROM review_changes WHERE verdict = 'accept' AND review_id IN (${replaced.map(() => '?').join(', ')})`).all(...replaced) as { review_id: string; file: string; diff: string }[]
      : []
    for (const r of replaced) db.prepare("UPDATE reviews SET status = 'replaced', note = ?, updated_at = ? WHERE id = ?").run(`Replaced by ${id}`, t, r)
    db.prepare(`INSERT INTO reviews (id, ticket, session_id, title, summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
      .run(id, ticket, p.session, p.title.trim(), (p.summary ?? '').trim(), t, t)
    const ins = db.prepare(`INSERT INTO review_changes (review_id, change_id, file, diff, verdict) VALUES (?, ?, ?, ?, ?)`)
    const kept: string[] = []
    const changes = parts.map((c, i) => {
      const cid = `C${i + 1}`
      const same = accepted.find((a) => a.file === c.file && a.diff === c.diff)
      ins.run(id, cid, c.file, c.diff, same ? 'accept' : 'pending')
      if (same) {
        kept.push(cid)
        db.prepare('INSERT INTO review_thread (review_id, change_id, who, text, verdict, at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, cid, 'board', `You accepted this in ${same.review_id}; the diff is unchanged.`, 'accept', t)
      }
      return { id: cid, file: c.file }
    })
    return { id, changes, replaced, kept }
  })()
}

// You close an open review without submitting it (stale or unwanted). Its session is told not to apply it.
// Returns the session to wake.
export function dismissReview(db: Store, rid: string): string | null {
  need(reviewStatus(db, rid) === 'open', `${rid} is already ${reviewStatus(db, rid)}`)
  return db.transaction(() => {
    const rv = db.prepare('SELECT session_id, title FROM reviews WHERE id = ?').get(rid) as { session_id: string | null; title: string }
    closeReview(db, rid, 'Dismissed on the board')
    if (!rv.session_id || !db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(rv.session_id)) return null
    queueMessage(db, rv.session_id, `The user dismissed ${rid} ("${rv.title}"). Do not apply it; stop waiting for it.`, 'board')
    return rv.session_id
  })()
}

// The session that posted a review closes it because it no longer applies (replaced some other way, or dropped).
export function withdrawReview(db: Store, rid: string, session: string, reason: string): void {
  need(reason.trim(), 'say why it is withdrawn')
  need(reviewStatus(db, rid) === 'open', `${rid} is already ${reviewStatus(db, rid)}`)
  const rv = db.prepare('SELECT session_id FROM reviews WHERE id = ?').get(rid) as { session_id: string | null }
  need(rv.session_id === session, `${rid} was posted by another session; the user can Dismiss it on the board`)
  closeReview(db, rid, `Withdrawn by its session: ${reason.trim()}`)
}

const closeReview = (db: Store, rid: string, note: string): void => {
  db.prepare("UPDATE reviews SET status = 'dismissed', note = ?, updated_at = ? WHERE id = ?").run(note, now(), rid)
}

const reviewStatus = (db: Store, id: string): string => {
  const r = db.prepare('SELECT status FROM reviews WHERE id = ?').get(id) as { status: string } | undefined
  need(r, `no review ${id}`)
  return r!.status
}

// A question on a file is also sent to the review's session, which answers in the file's thread (signoff review-reply).
// Returns the session to wake when a message was queued for it.
export function setVerdict(db: Store, rid: string, cid: string, verdict: Verdict, comment?: string | null): string | null {
  need(reviewStatus(db, rid) === 'open', `${rid} is already ${reviewStatus(db, rid)}`)
  need(VERDICTS.includes(verdict), `bad verdict ${verdict}`)
  need(verdict !== 'question' || (comment || '').trim(), 'write the question')
  const c = (comment || '').trim() || null
  const rv = db.prepare('SELECT session_id, title FROM reviews WHERE id = ?').get(rid) as { session_id: string | null; title: string }
  need(verdict !== 'question' || (rv.session_id && db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(rv.session_id)), `${rid} has no session to answer it`)
  return db.transaction(() => {
    const r = db.prepare('UPDATE review_changes SET verdict = ?, comment = ? WHERE review_id = ? AND change_id = ?').run(verdict, c, rid, cid)
    need(r.changes === 1, `no change ${cid} in ${rid}`)
    if (c) db.prepare('INSERT INTO review_thread (review_id, change_id, who, text, verdict, at) VALUES (?, ?, ?, ?, ?, ?)').run(rid, cid, 'you', c, verdict, now())
    db.prepare('UPDATE reviews SET updated_at = ? WHERE id = ?').run(now(), rid)
    if (verdict !== 'question') return null
    const f = db.prepare('SELECT file FROM review_changes WHERE review_id = ? AND change_id = ?').get(rid, cid) as { file: string }
    queueMessage(db, rv.session_id!, `The user asks about ${rid} ${cid} (${f.file}, in "${rv.title}"): ${c}\nAnswer in the file's thread as short points, one per line ("- ..."), written to a file: signoff review-reply --id ${rid} --change ${cid} --text-file <file>. Do not apply the file until the review is submitted.`, 'board')
    return rv.session_id
  })()
}

export function submitReview(db: Store, rid: string, opts: { acceptRest?: boolean; note?: string | null } = {}): 'accepted' | 'changes_requested' {
  need(reviewStatus(db, rid) === 'open', `${rid} is already ${reviewStatus(db, rid)}`)
  return db.transaction(() => {
    if (opts.acceptRest) db.prepare(`UPDATE review_changes SET verdict = 'accept' WHERE review_id = ? AND verdict = 'pending'`).run(rid)
    const v = db.prepare('SELECT change_id, verdict FROM review_changes WHERE review_id = ?').all(rid) as { change_id: string; verdict: string }[]
    const pending = v.filter((x) => x.verdict === 'pending').map((x) => x.change_id)
    need(!pending.length, `still pending: ${pending.join(', ')} (accept, reject or ask about each, or Accept all)`)
    const status = v.every((x) => x.verdict === 'accept') ? 'accepted' : 'changes_requested'
    db.prepare('UPDATE reviews SET status = ?, note = ?, submitted_at = ?, updated_at = ? WHERE id = ?')
      .run(status, (opts.note || '').trim() || null, now(), now(), rid)
    // Also told to the session, so it arrives even when no `signoff wait --review` is running.
    const rv = db.prepare('SELECT session_id, title FROM reviews WHERE id = ?').get(rid) as { session_id: string | null; title: string }
    if (rv.session_id && db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(rv.session_id))
      queueMessage(db, rv.session_id, `The user submitted ${rid} ("${rv.title}"): ${status === 'accepted' ? 'all files accepted' : 'changes requested'}. See it with: signoff review --id ${rid}\nApply only the accepted files; rework the others from their comments and propose again.`, 'board')
    return status
  })()
}

export function reviewReply(db: Store, rid: string, cid: string, who: string, text: string): void {
  need(text.trim(), 'text is empty')
  need(db.prepare('SELECT 1 FROM review_changes WHERE review_id = ? AND change_id = ?').get(rid, cid), `no change ${cid} in ${rid}`)
  db.prepare('INSERT INTO review_thread (review_id, change_id, who, text, at) VALUES (?, ?, ?, ?, ?)').run(rid, cid, who, text.trim(), now())
}
