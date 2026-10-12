// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import Database from 'better-sqlite3'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../../main/store'
import schema from '../../main/store/schema.sql?raw'
import m2 from '../../main/store/migrate-2.sql?raw'
import m3 from '../../main/store/migrate-3.sql?raw'
import m4 from '../../main/store/migrate-4.sql?raw'
import m5 from '../../main/store/migrate-5.sql?raw'
import m6 from '../../main/store/migrate-6.sql?raw'
import * as b from '../board'
import { ftsQuery, indexChatEvent, search } from '../memory'

const fresh = (): ReturnType<typeof openStore> => openStore(join(mkdtempSync(join(tmpdir(), 'mem-')), 'board.db'))

describe('memory', () => {
  it('finds decisions by question and answer, and follows later answers', () => {
    const db = fresh()
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's1', question: 'Retry policy for webhooks?', options: ['backoff', 'fixed'] })
    expect(search(db, 'retry').map((h) => [h.kind, h.ref, h.ticket])).toEqual([['decision', 'ABC-1/D1', 'ABC-1']])
    expect(search(db, 'exponential')).toEqual([])
    b.answer(db, 'ABC-1/D1', 'Exponential backoff, 5 tries', 'board')
    const [hit] = search(db, 'exponential')
    expect([hit.ref, hit.snippet]).toEqual(['ABC-1/D1', '[Exponential] backoff, 5 tries  ["backoff","fixed"]'])
    expect(search(db, 'retry', { ticket: 'ABC-2' })).toEqual([])
  })

  it('indexes reviews and chat text, not tool noise or handoff notes', () => {
    const db = fresh()
    b.touchSession(db, 's1', { ticket: 'ABC-3' })
    b.addReview(db, { ticket: 'ABC-3', session: 's1', title: 'Customer invoice filter', patch: '# a.rb  (new)\n+x\n' })
    indexChatEvent(db, 's1', '1', { type: 'prompt', text: 'Why does the VAT filter skip legacy invoices?' }, 't')
    indexChatEvent(db, 's1', '2', { type: 'prompt', kind: 'handoff', text: 'legacy handoff note' }, 't')
    indexChatEvent(db, 's1', '3', { type: 'assistant', message: { content: [{ type: 'tool_use' }, { type: 'text', text: 'Legacy invoices have no origin column.' }] } }, 't')
    indexChatEvent(db, 's1', '4', { type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'legacy subagent chatter' }] } }, 't')
    expect(search(db, 'legacy').every((h) => h.kind === 'chat' && h.ticket === 'ABC-3')).toBe(true)
    expect(search(db, 'legacy').map((h) => h.title).sort()).toEqual(['Claude replied', 'You asked'])
    expect(search(db, 'customer invoice').map((h) => [h.kind, h.ref])).toEqual([['review', 'R-1']])
  })

  it('turns any text into a safe query', () => {
    expect(ftsQuery('what "about" (ABC-1)* a')).toBe('"what"* "about"* "ABC-1"*')
    expect(search(fresh(), '"" ( * ^')).toEqual([])
  })

  it('the upgrade indexes what an existing store already holds', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mem-old-')), 'board.db')
    const old = new Database(path)
    for (const s of [schema, m2, m3, m4, m5, m6]) old.exec(s)
    old.prepare("INSERT INTO sessions (id, state, ticket, started_at, updated_at) VALUES ('s1', 'working', 'ABC-5', 't', 't')").run()
    old.prepare("INSERT INTO decisions (id, ticket, number, session_id, question, status, answer, created_at, updated_at) VALUES ('ABC-5/D1', 'ABC-5', 'D1', 's1', 'Store VAT or business id?', 'answered', 'The customer VAT', 't', 't')").run()
    old.prepare("INSERT INTO chat_events (session_id, seq, event, created_at) VALUES ('s1', 1, ?, 't')").run(JSON.stringify({ type: 'prompt', text: 'backfill the VAT for old invoices' }))
    old.prepare("INSERT INTO chat_events (session_id, seq, event, created_at) VALUES ('s1', 2, ?, 't')").run(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'The VAT backfill needs a rake task.' }] } }))
    old.close()
    const db = openStore(path)
    expect(search(db, 'vat').map((h) => [h.kind, h.title]).sort()).toEqual([['chat', 'Claude replied'], ['chat', 'You asked'], ['decision', 'Store VAT or business id?']])
  })
})
