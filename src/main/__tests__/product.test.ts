// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { productMarkdown } from '../../renderer/src/board/product'
import type { Decision } from '../../renderer/src/board/types'

const d = (o: Partial<Decision>): Decision => ({
  id: 'ABC-1/D1', ticket: 'ABC-1', number: 'D1', session: 's', question: 'Q?', options: [], recommend: null, evidence: [], refs: [], action: null, command: null,
  kind: null, item: null, context: [], if_wrong: null, draft: null, product_note: null, product_at: null, later_at: null, status: 'open', answer: null, answered_by: null,
  answered_at: null, withdrawn_reason: null, withdrawn_by: null, withdrawn_at: null, created_at: '', thread: [], level: 'ask', ...o
})

describe('product questions as Markdown', () => {
  it('groups by ticket, oldest first, with what we need, context, options and the recommendation', () => {
    const md = productMarkdown([
      d({ id: 'ABC-2/D4', ticket: 'ABC-2', question: 'Later one?', product_note: 'Need a yes or no', product_at: '2026-10-12T11:00:00+05:30' }),
      d({ question: 'Show the amount on expired links?', product_note: 'Confirm the copy', product_at: '2026-10-12T10:00:00+05:30', context: ['Links expire after 24 h'], options: ['Show :: amount stays visible', 'Hide'], recommend: 'Show :: fewer support tickets' })
    ])
    expect(md).toBe([
      '# Open questions for product', '',
      '## ABC-1',
      '- **Show the amount on expired links?** (ABC-1/D1)',
      '  - What we need: Confirm the copy',
      '  - Links expire after 24 h',
      '  - Option Show: amount stays visible',
      '  - Option Hide',
      '  - Engineering recommends Show: fewer support tickets',
      '',
      '## ABC-2',
      '- **Later one?** (ABC-2/D4)',
      '  - What we need: Need a yes or no',
      ''
    ].join('\n'))
  })
})
