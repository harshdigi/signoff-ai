// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { agentEvents, chatPoints } from '../chat-digest'

const say = (text: string): { type: string; message: { content: unknown[] } } => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

describe('chat digests', () => {
  it('Agents tab: only agent calls and their results', () => {
    const call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent' }] } }
    const bash = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash' }] } }
    const done = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1' }] } }
    const other = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b1' }] } }
    expect(agentEvents([say('hi'), call, bash, done, other])).toEqual([call, done])
  })

  it('step links: "Point 7:" headings with their passage, newest wins', () => {
    expect(chatPoints([say('## Point 7: old\nwas this'), say('Plan\n**Point 7:** session status\nkeeps the line\n\nnot this')]))
      .toEqual([[7, { anchor: 'Point 7: session status', text: 'Point 7: session status\nkeeps the line' }]])
  })
})
