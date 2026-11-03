// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { describeChange, parseDescribed } from '../monitor-describe'

const NOW = Date.parse('2026-10-23T12:00:00+05:30')
const out = (o: unknown): string => `Here you go <watch>${JSON.stringify(o)}</watch>`

describe('describe a change watch', () => {
  it('fills the fields from Claude\'s reply', () => {
    expect(parseDescribed(out({ subject: ' merchant X: instant payout on ', focus: 'merchant X', since: '2026-10-23T15:00:00+05:30', windowMinutes: 240 }), Date.parse('2026-10-23T16:00:00+05:30')))
      .toEqual({ subject: 'merchant X: instant payout on', focus: 'merchant X', since: '2026-10-23T09:30:00.000Z', windowMinutes: 240 })
  })

  it('drops a field it cannot trust instead of guessing: a future time, a window that is not a choice, an empty focus', () => {
    expect(parseDescribed(out({ subject: 'x', focus: ' ', since: '2026-10-24T10:00:00+05:30', windowMinutes: 90 }), NOW)).toEqual({ subject: 'x', focus: null, since: null, windowMinutes: null })
    expect(parseDescribed(out({ subject: 'x', since: 'yesterday' }), NOW).since).toBeNull()
  })

  it('refuses a reply without a subject or without the block', () => {
    expect(() => parseDescribed(out({ subject: '' }), NOW)).toThrow('could not tell what changed')
    expect(() => parseDescribed('no idea', NOW)).toThrow('did not fill the form')
  })

  it('runs Claude with no tools and refuses empty text', async () => {
    let args: string[] = []
    const r = await describeChange('enabled payouts', async (a) => { args = a; return { code: 0, out: out({ subject: 'payouts on' }) } }, new Date(NOW))
    expect(r.subject).toBe('payouts on')
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash')
    expect(args).not.toContain('--allowedTools')
    await expect(describeChange('  ', async () => ({ code: 0, out: '' }))).rejects.toThrow('say what you changed')
  })
})
