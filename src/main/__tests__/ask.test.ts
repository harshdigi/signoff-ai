// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { answerAfter } from '../../renderer/src/ide/answer'

const said = (text: string): object => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

describe("reading Claude's answer to a panel's request", () => {
  it('is the text after our prompt up to the end of that turn; null while the turn is still going', () => {
    const events = [{ type: 'prompt', text: 'earlier' }, said('old'), { type: 'turn_end' }, { type: 'prompt', text: 'Draft the test plan for this change: ...' }, said('Added 3 cases.')]
    expect(answerAfter(events, 'Draft the test plan for this change: ...')).toBeNull()
    expect(answerAfter([...events, said('#1 covers creation.'), { type: 'turn_end' }], 'Draft the test plan for this change: ...')).toBe('Added 3 cases.\n\n#1 covers creation.')
    expect(answerAfter(events, 'never sent')).toBeNull()
  })
})
