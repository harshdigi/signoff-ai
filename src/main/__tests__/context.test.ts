// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as b from '../../shared/board'
import { contextUsed, contextWindow, handoffNote, issueKeys, route } from '../context'
import { openStore, type Store } from '../store'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'ctx-')), 'board.db'))
})
const chat = (id: string, ticket: string | null, cwd = '/w'): void => {
  b.touchSession(db, id, { via: 'chat', cwd, ticket })
}

describe('context', () => {
  it('reads tokens in context from main-thread messages and the window from the result', () => {
    expect(contextUsed({ type: 'assistant', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 8295, cache_read_input_tokens: 16076 } } })).toBe(24381)
    expect(contextUsed({ type: 'assistant', parent_tool_use_id: 't1', message: { usage: { input_tokens: 5 } } })).toBeNull()
    expect(contextWindow({ type: 'result', modelUsage: { 'claude-haiku-4-5': { contextWindow: 200000 }, other: { contextWindow: 1000000 } } })).toBe(1000000)
    expect(contextWindow({ type: 'result' })).toBeNull()
  })

  it('finds upper-case issue keys only', () => {
    expect(issueKeys('fix ABC-8977 and ABC-8977, not utf-8 or sha-256; also ABC-1')).toEqual(['ABC-8977', 'ABC-1'])
  })

  it('routes: same ticket stays, a chat without a ticket adopts it, another ticket asks you where it goes', () => {
    chat('a', 'KA-1')
    chat('b', 'KA-2')
    chat('c', null)
    expect(route(db, 'a', 'no key here', '/w')).toEqual({ session: 'a' })
    expect(route(db, 'a', 'KA-1 again, see KA-9', '/w')).toEqual({ session: 'a' })
    expect(route(db, 'c', 'start KA-5', '/w')).toEqual({ session: 'c', ticket: 'KA-5' })
    // Another ticket: nothing moves until you choose.
    expect(route(db, 'a', 'switch to KA-2', '/w')).toEqual({ session: 'a', ask: { key: 'KA-2', current: 'KA-1', existing: 'b' } })
    expect(route(db, 'a', 'now KA-3', '/w')).toEqual({ session: 'a', ask: { key: 'KA-3', current: 'KA-1', existing: null } })
    expect(route(db, 'a', 'now KA-3', '/w', 'here')).toEqual({ session: 'a' })
    expect(route(db, 'a', 'switch to KA-2', '/w', 'existing')).toEqual({ session: 'b', notice: 'Moved here from the KA-1 chat: you chose the chat already working on KA-2.' })
    expect(route(db, 'a', 'now KA-3', '/w', 'new')).toEqual({ session: null, ticket: 'KA-3', notice: 'You started a new chat for KA-3 (from the KA-1 chat).' })
    // A new chat: asks only when a chat on that ticket already exists.
    expect(route(db, null, 'KA-2 status?', '/w')).toEqual({ session: null, ask: { key: 'KA-2', current: null, existing: 'b' } })
    expect(route(db, null, 'KA-2 status?', '/w', 'existing')).toEqual({ session: 'b', notice: 'Moved here from a new chat: you chose the chat already working on KA-2.' })
    expect(route(db, null, 'KA-2 status?', '/other')).toEqual({ session: null, ticket: 'KA-2' })
  })

  it('builds the handoff note from the board', () => {
    chat('a', 'KA-1')
    b.postDecision(db, { ticket: 'KA-1', number: 'D1', session: 'a', question: 'Retry policy?' })
    b.answer(db, 'KA-1/D1', 'Backoff, 5 tries', 'board')
    b.postDecision(db, { ticket: 'KA-1', number: 'D2', session: 'a', question: 'Which error?', level: 'inform', recommend: 'Reuse Timeout', evidence: ['e.rb:1'] })
    b.postDecision(db, { ticket: 'KA-1', number: 'D3', session: 'a', question: 'Alert on-call?' })
    const note = handoffNote(db, { id: 'a', title: 'Retries', ticket: 'KA-1', branch: 'k-1-retry', cwd: '/w' }, ['app/job.rb'], { prompts: ['add retries'], lastReply: 'Posted D3.' })
    expect(note).toBe([
      'You are continuing the work of the chat "Retries" (a), whose context was nearly full.',
      'Everything below comes from the decision board, so it is complete. Settled decisions stay settled: do not re-ask them.',
      'Re-read any file you need before changing it.',
      '', 'Folder: /w', 'Branch: k-1-retry', 'Ticket: KA-1', '',
      '## Decisions on this ticket',
      '- KA-1/D1 [answered] Retry policy? -> Backoff, 5 tries',
      '- KA-1/D2 [answered · inform] Which error? -> Reuse Timeout',
      '- KA-1/D3 [open] Alert on-call?',
      '', '## Waiting on the user', '- decision KA-1/D3',
      '', '## Uncommitted files', '- app/job.rb',
      '', '## The last requests from the user', '- add retries',
      '', '## Your last reply in the old chat', 'Posted D3.',
      '', 'Carry on from there. Start by saying in one or two lines where things stand.'
    ].join('\n'))
  })
})
