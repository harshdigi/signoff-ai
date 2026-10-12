// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { flowSteps, recommend, sessionsLine, warnings } from '../../renderer/src/ide/workflow-guide'

const builder = { role: 'implementer', count: 1, does: 'builds' }
const reviewer = { role: 'reviewer', count: 1, does: 'reviews' }

describe('workflow guide', () => {
  it('recommends a built-in from three answers', () => {
    expect(recommend({ size: 'small', parts: 'one', risk: 'low' }).id).toBe('solo')
    expect(recommend({ size: 'small', parts: 'independent', risk: 'low' }).id).toBe('solo')
    expect(recommend({ size: 'small', parts: 'one', risk: 'high' }).id).toBe('implement-review')
    expect(recommend({ size: 'large', parts: 'one', risk: 'low' }).id).toBe('implement-review')
    expect(recommend({ size: 'feature', parts: 'independent', risk: 'high' }).id).toBe('parallel')
  })

  it('counts sessions, the lead included', () => {
    expect(sessionsLine([])).toBe('1 session')
    expect(sessionsLine([builder, reviewer])).toBe('1 lead + 1 implementer + 1 reviewer')
    expect(sessionsLine([{ ...builder, count: null }, reviewer])).toBe('1 lead + 1 implementer per piece + 1 reviewer')
  })

  it('describes the flow, with or without a reviewer', () => {
    expect(flowSteps([])).toEqual(['One session does the whole task. No split, no extra sessions.'])
    expect(flowSteps([builder]).join(' ')).toContain('There is no reviewer')
    expect(flowSteps([builder, reviewer]).join(' ')).toContain('The reviewer reads each finished piece')
  })

  it('warns about setups that will not run the way they read', () => {
    expect(warnings([], 3)).toEqual([])
    expect(warnings([builder, reviewer], 3)).toEqual([])
    expect(warnings([builder], 3)).toEqual(['No reviewer: nobody reads the diffs before you do.'])
    expect(warnings([builder, { ...reviewer, role: 'code reviewer' }], 3)).toEqual([
      'No reviewer: nobody reads the diffs before you do.',
      'Only a role named exactly "reviewer" gets the implementers\' reports and works without its own worktree. "code reviewer" will act as an implementer.'
    ])
    expect(warnings([{ ...builder, count: 3 }, reviewer], 3)).toEqual(['This starts at least 4 sessions under the lead, but Settings allows 3. The start will be refused: lower the counts or raise the cap.'])
    expect(warnings([reviewer, builder], 3)).toContain('The reviewer is the first role, so the lead would give each piece to a reviewer, which never edits code. Put the builders first.')
  })
})
