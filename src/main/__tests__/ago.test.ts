// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { ago } from '../../renderer/src/board/types'

describe('ago', () => {
  it('says how long ago, short, and falls back to the date after a week', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')
    const t = (ms: number): string => new Date(now - ms).toISOString()
    expect([ago(t(20_000), now), ago(t(5 * 60_000), now), ago(t(3 * 3600_000), now), ago(t(26 * 3600_000), now), ago(t(4 * 86400_000), now), ago(null, now)])
      .toEqual(['just now', '5 min ago', '3 h ago', 'yesterday', '4 days ago', ''])
    expect(ago(t(30 * 86400_000), now)).not.toMatch(/ago|yesterday/)
  })
})
