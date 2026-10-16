// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import * as b from '../board'
import { ASKED_NOTE, askToSettle, lastPromptAt, lastPromptAtFile, settle, staleDecisions } from '../stale'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'stale-')), 'board.db'))
})
const line = (o: object): string => JSON.stringify(o)
const at = (id: string, iso: string): void => void db.prepare('UPDATE decisions SET created_at = ? WHERE id = ?').run(iso, id)

describe('decisions the chat moved past', () => {
  it('finds your last message in the transcript, skipping tool results and meta lines', () => {
    const t = [
      line({ type: 'user', timestamp: '2026-10-14T10:00:00Z', message: { content: 'first' } }),
      line({ type: 'assistant', timestamp: '2026-10-14T10:01:00Z', message: { content: [{ type: 'text', text: 'ok' }] } }),
      line({ type: 'user', timestamp: '2026-10-14T10:05:00Z', message: { content: [{ type: 'text', text: 'go with B' }] } }),
      line({ type: 'user', timestamp: '2026-10-14T10:06:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'done' }] } }),
      line({ type: 'user', timestamp: '2026-10-14T10:07:00Z', isMeta: true, message: { content: 'caveat' } }),
      'not json'
    ].join('\n')
    expect([lastPromptAt(t), lastPromptAt('')]).toEqual(['2026-10-14T10:05:00Z', null])
  })

  it('counts open asks posted before your last message; not parked ones, actions, informs, or ones already asked about', () => {
    for (const n of ['D1', 'D2', 'D3', 'D4', 'D5']) b.postDecision(db, { ticket: 'ABC-1', number: n, session: 's', question: `${n}?` })
    b.postDecision(db, { ticket: 'ABC-1', number: 'D6', session: 's', question: 'Commit?', action: 'consent' })
    for (const n of ['D1', 'D2', 'D3', 'D4', 'D6']) at(`ABC-1/${n}`, '2026-10-14T09:00:00Z')
    at('ABC-1/D5', '2026-10-14T11:00:00Z') // posted after your message
    b.openForProduct(db, 'ABC-1/D2', 'needs copy')
    b.setAside(db, 'ABC-1/D3')
    b.addToThread(db, 'ABC-1/D4', 'board', ASKED_NOTE)
    expect(staleDecisions(db, 's', '2026-10-14T10:00:00Z')).toEqual([{ id: 'ABC-1/D1', ticket: 'ABC-1', number: 'D1', question: 'D1?' }])
    expect(staleDecisions(db, 's', null)).toEqual([])
  })

  it('asks once: the note on the card stops a second ask', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'Which limit?' })
    at('ABC-1/D1', '2026-10-14T09:00:00Z')
    const stale = staleDecisions(db, 's', '2026-10-14T10:00:00Z')
    expect(askToSettle(db, stale)).toContain('- ABC-1/D1: Which limit?')
    expect(staleDecisions(db, 's', '2026-10-14T10:00:00Z')).toEqual([])
  })

  it('settle records what the chat decided, and with done that it is implemented; only open decisions', () => {
    b.postDecision(db, { ticket: 'ABC-1', number: 'D1', session: 's', question: 'Which limit?' })
    settle(db, 'ABC-1/D1', 's', 'Use 5,000 per day, as said in the chat', true)
    expect(db.prepare("SELECT status, answer, answered_by FROM decisions WHERE id = 'ABC-1/D1'").get())
      .toEqual({ status: 'applied', answer: 'Use 5,000 per day, as said in the chat', answered_by: 'chat' })
    expect(() => settle(db, 'ABC-1/D1', 's', 'x', false)).toThrow('ABC-1/D1 is applied; only an open or answered decision can be settled')
    // Answered but not implemented: the chat can change it, and the card keeps saying it was decided in the chat.
    b.postDecision(db, { ticket: 'ABC-1', number: 'D2', session: 's', question: 'How many copies?' })
    settle(db, 'ABC-1/D2', 's', '6', false)
    settle(db, 'ABC-1/D2', 's', '7', false)
    expect(db.prepare("SELECT status, answer, answered_by FROM decisions WHERE id = 'ABC-1/D2'").get()).toEqual({ status: 'answered', answer: '7', answered_by: 'chat' })
    expect((db.prepare("SELECT text FROM decision_thread WHERE decision_id = 'ABC-1/D2' ORDER BY id").all() as { text: string }[]).map((t) => t.text)).toEqual(['Settled in the chat: 6', 'Changed in the chat: 6 → 7'])
  })
})

describe('lastPromptAtFile', () => {
  it('finds the last prompt from the end of a large transcript, past a cut-off first line', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'lp-')), 't.jsonl')
    const prompt = JSON.stringify({ type: 'user', timestamp: '2026-10-16T09:00:00Z', message: { content: 'hello' } })
    const filler = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(4000) }] } })
    writeFileSync(f, prompt + '\n' + Array(700).fill(filler).join('\n') + '\n') // about 2.8 MB: needs the doubling
    expect(lastPromptAtFile(f)).toBe('2026-10-16T09:00:00Z')
    expect(lastPromptAtFile(join(tmpdir(), 'no-such-transcript.jsonl'))).toBeNull()
  })
})
