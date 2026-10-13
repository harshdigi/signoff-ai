// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import * as b from '../board'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'board-ops-')), 'board.db'))
})
const status = (id: string): string => (db.prepare('SELECT status FROM decisions WHERE id = ?').get(id) as { status: string }).status

describe('decisions', () => {
  it('keeps the exact text to approve (draft) on the decision', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D2', session: 's', question: 'Post this reply?', draft: '  Removed. `a.rb` keeps a why-comment.\n' })
    expect(db.prepare('SELECT draft FROM decisions WHERE id = ?').get('ABC-1/D2')).toEqual({ draft: 'Removed. `a.rb` keeps a why-comment.' })
  })
  it('post, answer, ack', () => {
    expect(b.postDecision(db, { ticket: 'abc-1', number: 'd1', session: 's', question: 'Q?' })).toBe('ABC-1/D1')
    expect(() => b.ack(db, 'ABC-1/D1', 's')).toThrow('ABC-1/D1 is open, not answered')
    b.answer(db, 'ABC-1/D1', 'yes', 'board')
    b.ack(db, 'ABC-1/D1', 's')
    expect(status('ABC-1/D1')).toBe('applied')
  })

  it('an answered decision is reopened only with force', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'Q?' })
    b.answer(db, 'ABC-1/D1', 'yes', 'board')
    expect(() => b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'again' })).toThrow(/already answered/)
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'again', force: true })
    expect(status('ABC-1/D1')).toBe('open')
  })

  it('actions get default options; terminal needs a command', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D9', session: 's', question: 'Commit?', action: 'consent' })
    expect(() => b.postDecision(db, { ticket: 'ABC-1', number: 'D10', session: 's', question: 'Push', action: 'terminal' })).toThrow(/needs --command/)
    b.postDecision(db, { ticket: 'ABC-1', number: 'D10', session: 's', question: 'Push', action: 'terminal', command: 'git  push -u origin x' })
    const rows = db.prepare('SELECT options, command FROM decisions ORDER BY id DESC').all()
    expect(rows).toEqual([{ options: '["Approve","Decline"]', command: null }, { options: '["Done"]', command: 'git push -u origin x' }])
  })

  it('withdraw needs a reason and an open decision', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D51', session: 's', question: 'Name?' })
    expect(() => b.withdraw(db, 'ABC-1/D51', 's', ' ')).toThrow('say why it is withdrawn')
    b.withdraw(db, 'ABC-1/D51', 's', 'D48 chose metadata')
    expect(() => b.withdraw(db, 'ABC-1/D51', 's', 'again')).toThrow('ABC-1/D51 is withdrawn, not open')
  })
})

describe('message delivery', () => {
  it('an answer from the board tells its session; each way of handing it over is recorded; stuck ones can be resent', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'Retry?' })
    expect(b.answerFromBoard(db, 'ABC-1/D1', ' Yes ')).toBe('s')
    const row = (): Record<string, unknown> => db.prepare('SELECT decision_id, via, delivered_at IS NOT NULL AS delivered, submitted_at IS NOT NULL AS submitted, failed FROM messages').get() as never
    expect(row()).toEqual({ decision_id: 'ABC-1/D1', via: null, delivered: 0, submitted: 0, failed: null })
    // Typed into the terminal: delivered, not yet submitted; still in the input box: failed.
    const [m] = b.popMessages(db, 's', 'terminal')
    expect(m.text).toBe('The user answered ABC-1/D1 ("Retry?"): Yes\nAct on it now, then: signoff ack --ticket ABC-1 --id D1')
    expect(row()).toMatchObject({ via: 'terminal', delivered: 1, submitted: 0 })
    b.markFailed(db, [m.id], 'typed into the terminal but not submitted')
    expect(row()).toMatchObject({ failed: 'typed into the terminal but not submitted', submitted: 0 })
    // Resend: back in the queue; the Stop hook hands it to Claude directly, so it counts as submitted.
    expect(b.resendMessage(db, m.id)).toBe('s')
    expect(row()).toEqual({ decision_id: 'ABC-1/D1', via: null, delivered: 0, submitted: 0, failed: null })
    b.popMessages(db, 's', 'stop')
    expect(row()).toEqual({ decision_id: 'ABC-1/D1', via: 'stop', delivered: 1, submitted: 1, failed: null })
    expect(() => b.resendMessage(db, 'nope')).toThrow('no message nope')
  })
})

describe('open for product', () => {
  it('parks an open decision with your note, tells the session, and can be taken back', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'Show the amount on expired links?' })
    b.openForProduct(db, 'ABC-1/D1', '  Confirm with product: should expired links show the amount?  ')
    const row = (): { status: string; product_note: string | null; product_at: string | null } => db.prepare('SELECT status, product_note, product_at FROM decisions WHERE id = ?').get('ABC-1/D1') as never
    expect(row()).toMatchObject({ status: 'open', product_note: 'Confirm with product: should expired links show the amount?' })
    expect(row().product_at).not.toBeNull()
    expect((db.prepare('SELECT text FROM decision_thread WHERE decision_id = ?').all('ABC-1/D1') as { text: string }[]).map((t) => t.text)).toEqual(['Open for product: Confirm with product: should expired links show the amount?'])
    expect(b.popMessages(db, 's').map((m) => m.text)).toEqual(['The user sent ABC-1/D1 ("Show the amount on expired links?") to the product team: Confirm with product: should expired links show the amount?\nDo not wait for it and do not ask it again. Keep working on what does not depend on it; the answer comes as usual when product replies.'])
    b.backFromProduct(db, 'ABC-1/D1')
    expect(row()).toEqual({ status: 'open', product_note: null, product_at: null })
    expect(() => b.backFromProduct(db, 'ABC-1/D1')).toThrow('ABC-1/D1 is not open for product')
  })

  it('needs a note and an open decision', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D2', session: 's', question: 'Q?' })
    expect(() => b.openForProduct(db, 'ABC-1/D2', ' ')).toThrow('say what you need from product')
    b.answer(db, 'ABC-1/D2', 'Yes', 'board')
    expect(() => b.openForProduct(db, 'ABC-1/D2', 'x')).toThrow('ABC-1/D2 is answered; only an open decision can wait on product')
  })
})

describe('inbox', () => {
  it('pops each message exactly once', () => {
    b.touchSession(db, 's', { ticket: 'ABC-1' })
    b.queueMessage(db, 's', 'one', 'board')
    expect(b.popMessages(db, 's').map((m) => m.text)).toEqual(['one'])
    expect(b.popMessages(db, 's')).toEqual([])
    expect(() => b.queueMessage(db, 's', '  ', 'board')).toThrow('message is empty')
    expect(() => b.queueMessage(db, 'nobody', 'x', 'board')).toThrow('no session nobody')
  })
})

describe('reviews', () => {
  const PATCH = '# db/migrate/x_add_vat.rb  (new)\n+class AddVat\n+end\n\n# packs/billing/app/models/invoice.rb  (annotation)\n+#  customer_vat :string\n'

  it('splits hash headers and git diffs into files', () => {
    expect(b.splitPatch(PATCH).map((c) => c.file)).toEqual(['db/migrate/x_add_vat.rb', 'packs/billing/app/models/invoice.rb'])
    const git = 'diff --git a/a.rb b/a.rb\n--- a/a.rb\n+++ b/a.rb\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/b.rb b/b.rb\n--- a/b.rb\n+++ b/b.rb\n-p\n+q\n'
    expect(b.splitPatch(git).map((c) => c.file)).toEqual(['a.rb', 'b.rb'])
  })

  it('submit needs every file settled unless accept-all', () => {
    const r = b.addReview(db, { ticket: 'ABC-1', session: 's', title: 'PR 1', patch: PATCH })
    expect(r).toEqual({ id: 'R-1', changes: [{ id: 'C1', file: 'db/migrate/x_add_vat.rb' }, { id: 'C2', file: 'packs/billing/app/models/invoice.rb' }] })
    b.setVerdict(db, 'R-1', 'C1', 'reject', 'use a generator')
    expect(() => b.submitReview(db, 'R-1')).toThrow(/still pending: C2/)
    expect(() => b.setVerdict(db, 'R-1', 'C2', 'question', ' ')).toThrow('write the question')
    expect(b.submitReview(db, 'R-1', { acceptRest: true })).toBe('changes_requested')
    expect(() => b.setVerdict(db, 'R-1', 'C2', 'accept')).toThrow('R-1 is already changes_requested')
  })
})

describe('decision levels', () => {
  
  it('inform and auto are settled at once by Claude and need a decision plus evidence', () => {
    expect(() => b.postDecision(db, { ticket: 'K-1', number: 'D1', session: 's1', question: 'Which error?', level: 'inform', evidence: ['a.rb:3'] })).toThrow('--level inform needs --recommend: what you decided')
    expect(() => b.postDecision(db, { ticket: 'K-1', number: 'D1', session: 's1', question: 'Which error?', level: 'inform', recommend: 'x' })).toThrow('--level inform needs --evidence: the code or doc that already settles it')
    expect(() => b.postDecision(db, { ticket: 'K-1', number: 'D1', session: 's1', question: 'Push?', level: 'auto', recommend: 'x', evidence: ['e'], action: 'consent' })).toThrow('--level auto cannot be an action; actions always wait for the user')
    b.postDecision(db, { ticket: 'K-1', number: 'D1', session: 's1', question: 'Which error?', level: 'inform', recommend: 'Return the existing InvalidEmail error', evidence: ['app/errors.rb:12'] })
    expect(db.prepare('SELECT level, status, answer, answered_by FROM decisions').get()).toEqual({ level: 'inform', status: 'answered', answer: 'Return the existing InvalidEmail error', answered_by: 'claude (inform)' })
  })

  it('an objection reopens it as an ask and tells the session why', () => {
    b.touchSession(db, 's1', {})
    b.postDecision(db, { ticket: 'K-1', number: 'D1', session: 's1', question: 'Which error?', level: 'inform', recommend: 'Reuse InvalidEmail', evidence: ['app/errors.rb:12'] })
    expect(() => b.object(db, 'K-1/D1', ' ')).toThrow('say what you disagree with')
    b.object(db, 'K-1/D1', 'Customers need a field-level error')
    expect(db.prepare('SELECT level, status, answer FROM decisions').get()).toEqual({ level: 'ask', status: 'open', answer: null })
    expect(b.popMessages(db, 's1').map((m) => m.text)).toEqual([
      'The user objects to K-1/D1 ("Which error?"), which you settled as inform: Customers need a field-level error\nIt is an open ask decision now. Rework or re-propose, then wait for their answer.'
    ])
    expect(() => b.object(db, 'K-1/D1', 'again')).toThrow('K-1/D1 was asked, not decided by Claude; answer it instead')
  })
})

describe('typed messages', () => {
  it('are logged as delivered, so the Stop hook never hands them over again', () => {
    b.touchSession(db, 's1', {})
    expect(() => b.logTyped(db, 'nope', 'hi')).toThrow('no session nope')
    const m = b.logTyped(db, 's1', ' look at D2 ')
    expect([m.text, m.by]).toEqual(['look at D2', 'typed'])
    expect(b.pendingMessages(db, 's1')).toEqual([])
    expect(b.popMessages(db, 's1')).toEqual([])
    expect(db.prepare('SELECT delivered_at IS NOT NULL AS d FROM messages').get()).toEqual({ d: 1 })
  })
})

describe('timestamps', () => {
  it('use the local time and UTC offset of the machine, in the prototype format', () => {
    const s = b.now(new Date('2026-10-06T10:07:56Z'))
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(new Date(s).toISOString()).toBe('2026-10-06T10:07:56.000Z') // same instant, whatever the zone
  })
})

describe('rename and remove sessions', () => {
  it('renames with a trimmed name, and refuses empty or long names', () => {
    b.touchSession(db, 's1', { title: 'New chat' })
    b.renameSession(db, 's1', '  ABC-9015 invoice filter  ')
    expect(db.prepare('SELECT title FROM sessions').get()).toEqual({ title: 'ABC-9015 invoice filter' })
    expect(() => b.renameSession(db, 's1', '  ')).toThrow('the name is empty')
    expect(() => b.renameSession(db, 's1', 'x'.repeat(81))).toThrow('the name is 80 characters at most')
    expect(() => b.renameSession(db, 'nope', 'x')).toThrow('no session nope')
  })

  it('removing hides a session but keeps its decisions; restoring brings it back', () => {
    b.touchSession(db, 's1', {})
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's1', question: 'Q?' })
    b.setRemoved(db, 's1', true)
    expect(db.prepare('SELECT archived FROM sessions').get()).toEqual({ archived: 1 })
    expect(db.prepare('SELECT id FROM decisions').all()).toEqual([{ id: 'ABC-1/D1' }])
    b.setRemoved(db, 's1', false)
    expect(db.prepare('SELECT archived FROM sessions').get()).toEqual({ archived: 0 })
  })

  it('a question asked under a decision is kept in its thread and sent to the session that posted it', async () => {
    const { askAbout, pendingMessages, postDecision, touchSession } = await import('../board')
    const { openStore } = await import('../../main/store')
    const { mkdtempSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const db = openStore(join(mkdtempSync(join(tmpdir(), 'ask-')), 'b.db'))
    touchSession(db, 's1', {})
    postDecision(db, { ticket: 'ABC-1', number: 'D3', session: 's1', question: 'Which limit?' })
    askAbout(db, 'ABC-1/D3', 'Draft a Slack message for this')
    expect(db.prepare("SELECT who, text FROM decision_thread WHERE decision_id = 'ABC-1/D3'").all()).toEqual([{ who: 'you', text: 'Draft a Slack message for this' }])
    expect(pendingMessages(db, 's1').map((m) => m.text)).toEqual(['The user asks about ABC-1/D3 ("Which limit?"): Draft a Slack message for this\nAnswer under the decision as short points, one per line ("- ..."), written to a file: signoff reply --ticket ABC-1 --id D3 --text-file <file> (do not change the decision itself).'])
  })
})

