// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { addReview, answer, postDecision, touchSession } from '../../shared/board'
import { acceptByClaude } from '../../shared/autonomy'
import { chartOf, parseStory, storyOf, storyPrompt, writeStory } from '../story'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'story-')), 'board.db'))
  touchSession(db, 's', {})
})

describe('story', () => {
  it('the chart lists decisions, the plan card and reviews in order, with who settled each', () => {
    postDecision(db, { ticket: 'K-1', number: 'D1', session: 's', question: 'Refund to card or wallet?', options: ['Card', 'Wallet'] })
    answer(db, 'K-1/D1', 'Card', 'you')
    postDecision(db, { ticket: 'K-1', number: 'D2', session: 's', question: 'Approve the plan?', action: 'consent', item: 'plan' })
    postDecision(db, { ticket: 'K-1', number: 'D3', session: 's', question: 'Helper name?', recommend: 'refund! :: one verb', byClaude: 'claude (Plan first, then run)' })
    const r = addReview(db, { ticket: 'K-1', session: 's', title: 'Refund flow', patch: '# a.rb  (new)\n+x\n' })
    acceptByClaude(db, r.id, 'claude (Plan first, then run)')
    expect(chartOf(db, 'K-1').map((n) => [n.id, n.kind, n.answer, n.by])).toEqual([
      ['K-1/D1', 'decision', 'Card', 'you'],
      ['K-1/D2', 'plan', null, 'waiting for you'],
      ['K-1/D3', 'decision', 'refund!', 'claude (Plan first, then run)'],
      ['R-1', 'review', 'accepted', 'claude (Plan first, then run)']
    ])
  })

  it('asks Claude read-only for a plain story and keeps it per ticket; a broken reply is an error', async () => {
    expect(storyPrompt('K-1', [], ' a.rb | 2 +')).toContain('READ-ONLY')
    let args: string[] = []
    const out = '<story>{"summary":["Refunds go back to the card."],"flow":[{"step":"Customer asks","detail":"From the order page."}],"technical":"`Refund#call`"}</story>'
    await writeStory(db, 'K-1', tmpdir(), async (a) => { args = a; return { code: 0, out } })
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash')
    expect(storyOf(db, 'K-1')?.story.summary).toEqual(['Refunds go back to the card.'])
    expect(() => parseStory('done')).toThrow('the story run did not return a story')
    expect(() => parseStory('<story>{"summary":"x"}</story>')).toThrow('the story is incomplete')
  })
})
