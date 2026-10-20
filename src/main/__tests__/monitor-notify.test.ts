// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { touchSession } from '../../shared/board'
import { addEvent, monitorEvents, saveSetup, startMonitor, type Monitor } from '../../shared/monitors'
import { notifyPrompt, reviewLine, sendReviewRequest } from '../monitor-notify'

const REPO = 'acme/shop'
let db: Store
let m: Monitor
const found = {
  messaging: [{ app: 'Slack', mcp: 'slack', sendTool: 'mcp__slack__send_message', searchTool: 'mcp__slack__search', destinations: [], needs: [] }, { app: 'Teams', mcp: 'teams', sendTool: 'mcp__teams__post', destinations: [], needs: [] }],
  errors: [], ci: { provider: 'GitHub Actions', prChecks: [], mainWorkflows: [] }, deploy: { workflow: null, trigger: 'manual', postDeploy: null }, notes: []
}
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'notify-')), 'board.db'))
  touchSession(db, 's', {})
  saveSetup(db, REPO, { found, foundAt: 't', chosen: null })
  m = startMonitor(db, { session: 's', repo: REPO, pr: 7, ticket: 'KAN-1', windowMinutes: 60, checkMinutes: 15, notify: true,
    recipients: [{ app: 'Slack', where: '#reviews', tags: ['@team'] }, { app: 'Teams', where: 'Releases', tags: [] }, { app: 'Zoho', where: 'dev', tags: [] }] })
})
const pr = async (): Promise<{ title: string; url: string }> => ({ title: 'Pin escrow per payment', url: 'https://github.com/acme/shop/pull/7' })
const texts = (): string[] => monitorEvents(db, m.id).filter((e) => e.kind.startsWith('notif')).map((e) => e.text)

describe('review request', () => {
  it('builds one fixed line, and a prompt that names each app\'s send tool, destination and mentions', () => {
    const line = reviewLine(m, { title: 'Pin escrow per payment', url: 'u' })
    expect(line).toBe('PR up for review: KAN-1 Pin escrow per payment — u')
    const p = notifyPrompt(line, 'u', [{ app: 'Slack', where: '#reviews', tags: ['@team'], sendTool: 'mcp__slack__send_message', searchTool: 'mcp__slack__search' }, { app: 'Teams', where: 'Releases', tags: [], sendTool: 'mcp__teams__post' }])
    expect(p).toContain(`1. First, with mcp__slack__search, search #reviews for a message that contains u. If one exists, do not post there; report it as found. Otherwise, with mcp__slack__send_message (Slack), post to #reviews: "${line}", mentioning @team at the end in Slack's mention format.`)
    expect(p).toContain(`2. With mcp__teams__post (Teams), post to Releases: "${line}".`)
    expect(p).toContain('Do not reword, translate or add to the text.')
  })

  it('sends with only the send tools allowed, and records each result; an app not in the setup is reported', async () => {
    let args: string[] = []
    await sendReviewRequest(db, m, { pr, run: async (a) => { args = a; return { code: 0, out: 'done <sent>[{"app":"Slack","where":"#reviews","ok":true},{"app":"Teams","where":"Releases","ok":false,"error":"no access"}]</sent>' } } })
    expect(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 2)).toEqual(['--allowedTools', 'mcp__slack__send_message,mcp__slack__search,mcp__teams__post'])
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash')
    expect(texts()).toEqual([
      'Review request not sent to dev: Zoho is not in this repo\'s setup (Check again in Ship)',
      'Releases (Teams) was not searched for an earlier request: no search tool in this repo\'s setup (Check again in Ship)',
      'Review request sent to #reviews (Slack)',
      'Review request not sent to Releases (Teams): no access'
    ])
  })

  it('never raised twice: a destination already sent to is skipped, and one found in the channel is recorded as found', async () => {
    addEvent(db, m.id, 'notified', 'Review request sent to #reviews (Slack)')
    let prompt = ''
    await sendReviewRequest(db, m, { pr, run: async (a) => { prompt = a.join(' '); return { code: 0, out: '<sent>[{"app":"Teams","where":"Releases","ok":false,"found":"10:40, by Asha"}]</sent>' } } })
    expect(prompt).not.toContain('#reviews')
    expect(texts()).toContain('Review request already in Releases (Teams), not sent again: 10:40, by Asha')
    expect(texts().some((t) => /^Review request already raised in #reviews \(Slack\) at .+; not sent again$/.test(t))).toBe(true)
  })

  it('a run that does not report what it sent is recorded as unconfirmed, not as sent', async () => {
    await sendReviewRequest(db, m, { pr, run: async () => ({ code: 0, out: 'I posted it.' }) })
    expect(texts().at(-1)).toMatch(/^Review request: could not confirm it was sent/)
  })
})
