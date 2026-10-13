// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { foldTurns, stepsSummary, unwrapPasted, type Row } from '../../renderer/src/chat/transcript'

const tool = (name: string, id: string): Row => ({ kind: 'tool', id, name, input: {}, result: 'ok' })

describe("chat: one steps row per turn under your message; Claude's text below as it comes", () => {
  it("collects every tool of the turn in one row just under your message; texts keep their order", () => {
    const rows: Row[] = [
      { kind: 'prompt', text: 'fix the bug' },
      { kind: 'text', text: 'I will read the file first.' },
      tool('Read', 'a'), tool('Grep', 'b'),
      { kind: 'text', text: 'Found it. Running the specs.' },
      tool('Bash', 'c'),
      { kind: 'text', text: 'Fixed: the guard was inverted.' },
      { kind: 'result', text: 'Done in 3.0s', isError: false },
      { kind: 'prompt', text: 'thanks' },
      { kind: 'text', text: 'You are welcome.' }
    ]
    expect(foldTurns(rows)).toEqual([
      rows[0],
      { kind: 'steps', live: false, steps: [rows[2], rows[3], rows[5]] },
      rows[1], rows[4], rows[6], rows[7],
      rows[8], rows[9]
    ])
  })

  it('the row is live until the turn ends; notices keep their place; a plain answer has no row', () => {
    const rows: Row[] = [{ kind: 'prompt', text: 'go' }, { kind: 'text', text: 'Now the tests.' }, tool('Bash', 'a'), { kind: 'notice', text: 'Background task finished' }, tool('Read', 'b')]
    expect(foldTurns(rows)).toEqual([rows[0], { kind: 'steps', live: true, steps: [rows[2], rows[4]] }, rows[1], rows[3]])
    const plain: Row[] = [{ kind: 'prompt', text: 'hi' }, { kind: 'text', text: 'Hello.' }, { kind: 'result', text: 'Done', isError: false }]
    expect(foldTurns(plain)).toEqual(plain)
  })

  it('summarises a run by kind', () => {
    expect(stepsSummary([tool('Bash', 'a'), tool('Bash', 'b'), tool('Read', 'c'), tool('Grep', 'd'), tool('Edit', 'e'), tool('Agent', 'f')] as never)).toBe('6 steps · 2 commands · 2 reads · 1 edit · 1 other')
  })

  it('shows pasted text without its <pasted_content> wrapper', () => {
    expect(unwrapPasted('see:\n<pasted_content id="0e33">\nline one\nline two\n</pasted_content id="0e33">\nthanks')).toBe('see:\nline one\nline two\nthanks')
  })
})
