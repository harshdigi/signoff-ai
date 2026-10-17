// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { addReview, answer, postDecision, touchSession } from '../../shared/board'
import { acceptByClaude } from '../../shared/autonomy'
import { diagramOf, parseStory, storyOf, storyPrompt, writeStory } from '../story'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'story-')), 'board.db'))
  touchSession(db, 's', {})
})

describe('story', () => {
  it('the diagram has a column per real choice; approvals, the plan card and reviews are only counted', () => {
    postDecision(db, { ticket: 'K-1', number: 'D1', session: 's', question: 'Refund to card or wallet?', options: ['Card :: back to the card', 'Wallet'], context: ['Refunds are manual today.'] })
    answer(db, 'K-1/D1', 'Card :: back to the card', 'you')
    postDecision(db, { ticket: 'K-1', number: 'D2', session: 's', question: 'Approve the plan?', action: 'consent', item: 'plan' })
    postDecision(db, { ticket: 'K-1', number: 'D3', session: 's', question: 'Commit it?', action: 'consent' })
    postDecision(db, { ticket: 'K-1', number: 'D4', session: 's', question: 'Helper name?', recommend: 'refund! :: one verb', byClaude: 'claude (Plan first, then run)' })
    postDecision(db, { ticket: 'K-1', number: 'D5', session: 's', question: 'Partial refunds?', options: ['Yes', 'No'] })
    const r = addReview(db, { ticket: 'K-1', session: 's', title: 'Refund flow', patch: '# a.rb  (new)\n+x\n' })
    acceptByClaude(db, r.id, 'claude (Plan first, then run)')
    expect(diagramOf(db, 'K-1')).toEqual({
      choices: [
        { id: 'K-1/D1', question: 'Refund to card or wallet?', options: ['Card', 'Wallet'], chosen: 'Card', by: 'you', context: ['Refunds are manual today.'] },
        { id: 'K-1/D5', question: 'Partial refunds?', options: ['Yes', 'No'], chosen: null, by: 'waiting for you', context: [] }
      ],
      approvals: 2,
      reviews: 1
    })
  })

  it('asks Claude read-only for a plain story and keeps it per ticket; a broken reply is an error', async () => {
    expect(storyPrompt('K-1', { choices: [], approvals: 0, reviews: 0 }, ' a.rb | 2 +')).toContain('READ-ONLY')
    let args: string[] = []
    const out = '<story>{"summary":"Refunds go back to the card.","context":{"title":"Manual refunds","lines":[]},"columns":[],"flow":[{"step":"Customer asks","detail":"From the order page."}],"technical":"`Refund#call`"}</story>'
    await writeStory(db, 'K-1', tmpdir(), async (a) => { args = a; return { code: 0, out } })
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash')
    expect(storyOf(db, 'K-1')?.story.summary).toBe('Refunds go back to the card.')
    expect(() => parseStory('done')).toThrow('the story run did not return a story')
    expect(() => parseStory('<story>{"summary":"x"}</story>')).toThrow('the story is incomplete')
  })
})
