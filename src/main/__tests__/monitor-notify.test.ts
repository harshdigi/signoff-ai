// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { touchSession } from '../../shared/board'
import { monitorEvents, saveSetup, startMonitor, type Monitor } from '../../shared/monitors'
import { checkApprovals, checkAsked, notifyPrompt, reviewLine, sendReviewRequest } from '../monitor-notify'
import { recordRequest, requestsOf } from '../../shared/review-requests'

const REPO = 'acme/shop'
let db: Store
let m: Monitor
const found = {
  messaging: [{ app: 'Slack', mcp: 'slack', sendTool: 'mcp__slack__send_message', searchTool: 'mcp__slack__search', threadTool: 'mcp__slack__read_thread', destinations: [], needs: [] }, { app: 'Teams', mcp: 'teams', sendTool: 'mcp__teams__post', destinations: [], needs: [] }],
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
    expect(p).toContain(`1. First, with mcp__slack__search, search for a message that contains u: first in #reviews, then in the other channels you can search. If one exists, do not post; report it as found, with where it is. Otherwise, with mcp__slack__send_message (Slack), post to #reviews: "${line}", mentioning @team at the end in Slack's mention format.`)
    expect(p).toContain(`2. With mcp__teams__post (Teams), post to Releases: "${line}".`)
    expect(p).toContain('Do not reword, translate or add to the text.')
  })

  it('sends with only the send tools allowed, and records each result; an app not in the setup is reported', async () => {
    let args: string[] = []
    await sendReviewRequest(db, m, { pr, run: async (a) => { args = a; return { code: 0, out: 'done <sent>[{"app":"Slack","where":"#reviews","ok":true,"message":"12:18"},{"app":"Teams","where":"Releases","ok":false,"error":"no access"}]</sent>' } } })
    expect(requestsOf(db, REPO, 7).map((r) => [r.app, r.place, r.state, r.message])).toEqual([['Slack', '#reviews', 'sent', '12:18']])
    expect(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 2)).toEqual(['--allowedTools', 'mcp__slack__send_message,mcp__slack__search,mcp__teams__post'])
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash')
    expect(texts()).toEqual([
      'Review request not sent to dev: Zoho is not in this repo\'s setup (Re-scan in the Monitor tab)',
      'Releases (Teams) was not searched for an earlier request: no search tool in this repo\'s setup (Re-scan in the Monitor tab)',
      'Review request sent to #reviews (Slack)',
      'Review request not sent to Releases (Teams): no access'
    ])
  })

  it('never raised twice: a recorded destination is skipped, and one found elsewhere is recorded as found with where it is', async () => {
    recordRequest(db, { repo: REPO, pr: 7, app: 'Slack', place: '#reviews', state: 'sent' })
    let prompt = ''
    await sendReviewRequest(db, m, { pr, run: async (a) => { prompt = a.join(' '); return { code: 0, out: '<sent>[{"app":"Teams","where":"Releases","ok":false,"found":"10:40","in":"General"}]</sent>' } } })
    expect(prompt).not.toContain('#reviews')
    expect(texts()).toContain('Review request already in General (Teams), not sent again: 10:40')
    expect(requestsOf(db, REPO, 7).find((r) => r.app === 'Teams')?.message).toBe('in General · 10:40')
    expect(texts().some((t) => /^Review request already raised in #reviews \(Slack\) at .+; not sent again$/.test(t))).toBe(true)
  })

  it('Check Slack searches with only the search tools, posts nothing, records what it found, and says which rows it could not check', async () => {
    let args: string[] = []
    const out = await checkAsked(db, REPO, [{ app: 'Slack', where: '#reviews', tags: [] }, { app: 'Teams', where: 'Releases', tags: [] }, { app: 'Zoho', where: 'dev', tags: [] }], { number: 7, url: 'https://x/pull/7' },
      async (a) => { args = a; return { code: 0, out: '<asked>[{"app":"Slack","where":"#reviews","found":true,"when":"10:40"}]</asked>' } })
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__slack__search')
    expect(args.join(' ')).toContain('READ-ONLY')
    expect(out).toEqual([
      { app: 'Slack', where: '#reviews', found: true, when: '10:40' },
      { app: 'Zoho', where: 'dev', found: false, error: "Zoho is not in this repo's setup (Re-scan apps)" },
      { app: 'Teams', where: 'Releases', found: false, error: "no search tool in this repo's setup (Re-scan apps)" }
    ])
    expect(texts()).toEqual([])
    expect(requestsOf(db, REPO, 7).map((r) => [r.app, r.place, r.state, r.message])).toEqual([['Slack', '#reviews', 'found', '10:40']])
  })

  it('reads the threads of sent or found requests read-only, records an approval once, and keeps it approved', async () => {
    recordRequest(db, { repo: REPO, pr: 7, app: 'Slack', place: '#reviews', state: 'sent', message: '12:18' })
    recordRequest(db, { repo: REPO, pr: 7, app: 'Teams', place: 'Releases', state: 'found' })
    let args: string[] = []
    await checkApprovals(db, m, async (a) => { args = a; return { code: 0, out: '<approvals>[{"app":"Slack","place":"#reviews","approved":true,"by":"Asha","when":"12:40"}]</approvals>' } }, 'https://x/pull/7')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__slack__read_thread,mcp__slack__search')
    expect(args.join(' ')).toContain('A question or a request for changes is not an approval.')
    expect(texts()).toEqual([
      "Releases (Teams): its thread is not checked for approval: no thread tool in this repo's setup (Re-scan in the Monitor tab)"
    ])
    expect(monitorEvents(db, m.id).filter((e) => e.kind === 'approved').map((e) => e.text)).toEqual(['Approved in #reviews (Slack) by Asha · 12:40'])
    recordRequest(db, { repo: REPO, pr: 7, app: 'Slack', place: '#reviews', state: 'sent' })
    expect(requestsOf(db, REPO, 7).find((r) => r.app === 'Slack')).toMatchObject({ state: 'approved', by: 'Asha', message: '12:18' })
  })

  it('a run that does not report what it sent is recorded as unconfirmed, not as sent', async () => {
    await sendReviewRequest(db, m, { pr, run: async () => ({ code: 0, out: 'I posted it.' }) })
    expect(texts().at(-1)).toMatch(/^Review request: could not confirm it was sent/)
  })
})
