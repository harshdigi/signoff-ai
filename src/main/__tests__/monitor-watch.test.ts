// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { touchSession } from '../../shared/board'
import { getMonitor, monitorEvents, saveSetup, startChange, startMonitor, stopMonitor } from '../../shared/monitors'
import { deployWorkflowOf, MonitorWatcher, THREAD_EVERY_MS, type Gh } from '../monitor-watch'
import { recordRequest, requestsOf } from '../../shared/review-requests'

const REPO = 'acme/shop'
let db: Store
let calls: string[][]
let said: string[]
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'watch-')), 'board.db'))
  touchSession(db, 'impl', {})
  startMonitor(db, { session: 'impl', repo: REPO, pr: 7, windowMinutes: 60, checkMinutes: 15 })
  calls = []
  said = []
})
// A fake gh: answers by the command's first words; compare answers by the head commit.
const fake = (r: { pr?: object; runs?: object[]; main?: object[]; compare?: Record<string, string> }): Gh => async (args) => {
  calls.push(args)
  if (args[0] === 'pr') return JSON.stringify(r.pr)
  if (args[0] === 'run' && args.includes('--workflow')) return JSON.stringify(r.runs ?? [])
  if (args[0] === 'run') return JSON.stringify(r.main ?? [])
  if (args[0] === 'api') return (r.compare ?? {})[args[1].split('...')[1]] ?? 'behind'
  throw new Error('unexpected gh call ' + args.join(' '))
}
const watcher = (g: Gh, now = Date.parse('2026-10-17T10:30:00Z'), wf: string | null = 'deploy.yml'): MonitorWatcher =>
  new MonitorWatcher(db, g, { ciGreen: (m) => said.push(`green ${m.id}`), ciRed: (_m, f) => said.push(`red ${f.join(',')}`), incident: (_m, w) => said.push(`incident ${w}`) }, () => wf, () => now)
const check = (name: string, status: string, conclusion: string | null): object => ({ name, status, conclusion })
const run = (id: number, workflowName: string, headSha: string, createdAt: string, conclusion: string): object => ({ databaseId: id, workflowName, headSha, createdAt, status: 'completed', conclusion })

describe('monitor watcher', () => {
  it('ci: waits while checks run, tells the session once about a failure, and moves on when all are green', async () => {
    await watcher(fake({ pr: { state: 'OPEN', mergeCommit: null, statusCheckRollup: [check('lint', 'IN_PROGRESS', null)] } })).tick()
    expect(getMonitor(db, 'M-1').stage).toBe('ci')
    const red = fake({ pr: { state: 'OPEN', mergeCommit: null, statusCheckRollup: [check('lint', 'COMPLETED', 'FAILURE'), check('tests', 'COMPLETED', 'SUCCESS')] } })
    await watcher(red).tick(); await watcher(red).tick()
    expect(said).toEqual(['red lint'])
    await watcher(fake({ pr: { state: 'OPEN', mergeCommit: null, statusCheckRollup: [check('lint', 'COMPLETED', 'SUCCESS'), check('claude', 'COMPLETED', 'SKIPPED')] } })).tick()
    expect([getMonitor(db, 'M-1').stage, said.at(-1)]).toEqual(['merge', 'green M-1'])
  })

  it('merge: records the merge commit; a close without merging ends it', async () => {
    await watcher(fake({ pr: { state: 'MERGED', mergeCommit: { oid: 'm1' }, statusCheckRollup: [] } })).tick()
    expect([getMonitor(db, 'M-1').stage, getMonitor(db, 'M-1').merge_sha]).toEqual(['deploy', 'm1'])
    startMonitor(db, { session: 'impl', repo: REPO, pr: 8, windowMinutes: 60, checkMinutes: 15 })
    await watcher(fake({ pr: { state: 'CLOSED', mergeCommit: null, statusCheckRollup: [] } })).tick()
    expect(getMonitor(db, 'M-2').stage).toBe('done')
  })

  it('deploy: the first successful production run that contains the merge starts the window; a failed one is an incident', async () => {
    await watcher(fake({ pr: { state: 'MERGED', mergeCommit: { oid: 'm1' }, statusCheckRollup: [] } })).tick()
    await watcher(fake({ runs: [run(1, 'Deploy', 'old', '2026-10-17T09:00:00Z', 'success')], compare: {} })).tick()
    expect(getMonitor(db, 'M-1').stage).toBe('deploy') // that run does not contain the merge
    await watcher(fake({ runs: [run(2, 'Deploy', 'tag1', '2026-10-17T10:00:00Z', 'success')], compare: { tag1: 'ahead' } })).tick()
    expect([getMonitor(db, 'M-1').stage, getMonitor(db, 'M-1').deployed_at]).toEqual(['stable', '2026-10-17T10:00:00Z'])
    startMonitor(db, { session: 'impl', repo: REPO, pr: 9, windowMinutes: 60, checkMinutes: 15 })
    db.prepare("UPDATE monitors SET stage = 'deploy', merge_sha = 'm2' WHERE id = 'M-2'").run()
    await watcher(fake({ runs: [run(3, 'Deploy', 'm2', '2026-10-17T10:05:00Z', 'failure')] })).tick()
    expect([getMonitor(db, 'M-2').stage, said.at(-1)]).toEqual(['incident', 'incident The production deploy that contains this change failed (run 3: failure)'])
  })

  it('stable: only a workflow that was green before the deploy and fails after it is an incident; then the window ends', async () => {
    db.prepare("UPDATE monitors SET stage = 'stable', merge_sha = 'm1', deployed_at = '2026-10-17T10:00:00Z' WHERE id = 'M-1'").run()
    const main = [
      run(10, 'Cucumber', 'x', '2026-10-17T09:00:00Z', 'failure'), run(11, 'Cucumber', 'h2', '2026-10-17T10:10:00Z', 'failure'), // failing before too: not new
      run(12, 'Specs', 'y', '2026-10-17T09:30:00Z', 'success')
    ]
    await watcher(fake({ main, compare: { h2: 'ahead' } })).tick()
    expect([getMonitor(db, 'M-1').stage, said]).toEqual(['stable', []])
    await watcher(fake({ main: [...main, run(13, 'Specs', 'h3', '2026-10-17T10:20:00Z', 'failure')], compare: { h2: 'ahead', h3: 'ahead' } })).tick()
    expect([getMonitor(db, 'M-1').stage, said]).toEqual(['incident', ['incident Specs started failing after the deploy (run 13)']])
    startMonitor(db, { session: 'impl', repo: REPO, pr: 10, windowMinutes: 60, checkMinutes: 15 })
    db.prepare("UPDATE monitors SET stage = 'stable', merge_sha = 'm3', deployed_at = '2026-10-17T09:00:00Z' WHERE id = 'M-2'").run()
    await watcher(fake({ main: [] }), Date.parse('2026-10-17T10:01:00Z')).tick()
    expect(getMonitor(db, 'M-2').stage).toBe('done')
  })

  it('no deploy workflow ends the watch at merge; a GitHub error is logged and the stage kept', async () => {
    db.prepare("UPDATE monitors SET stage = 'deploy', merge_sha = 'm1' WHERE id = 'M-1'").run()
    await watcher(async () => { throw new Error('HTTP 502') }).tick()
    expect([getMonitor(db, 'M-1').stage, monitorEvents(db, 'M-1').at(-1)?.text]).toEqual(['deploy', 'Could not check GitHub: HTTP 502'])
    await watcher(fake({}), Date.now(), null).tick()
    expect(getMonitor(db, 'M-1').stage).toBe('done')
  })

  it('takes the deploy workflow file from the setup check, or your choice', () => {
    expect(deployWorkflowOf(db, REPO)).toBeNull()
    const found = { messaging: [], errors: [], ci: { provider: 'GitHub Actions', prChecks: [], mainWorkflows: [] }, deploy: { workflow: 'Deploy to Sandbox/Production (.github/workflows/deploy-sandbox-production.yml)', trigger: 'manual', postDeploy: null }, notes: [] }
    saveSetup(db, REPO, { found, foundAt: 't', chosen: null })
    expect(deployWorkflowOf(db, REPO)).toBe('deploy-sandbox-production.yml')
    saveSetup(db, REPO, { found, foundAt: 't', chosen: { deployWorkflow: 'release.yml' } })
    expect(deployWorkflowOf(db, REPO)).toBe('release.yml')
  })

  it('error checks: first one interval after the deploy, then each interval; new errors are an incident', async () => {
    db.prepare("UPDATE monitors SET stage = 'stable', merge_sha = 'm1', deployed_at = '2026-10-17T10:00:00Z' WHERE id = 'M-1'").run()
    const verdicts = [{ newErrors: false, summary: 'no new errors' }, { newErrors: true, summary: 'NoMethodError in EscrowRouter (42 since 10:02)' }]
    let ran = 0
    const w = (now: string): MonitorWatcher => new MonitorWatcher(db, fake({ main: [] }), { ciGreen: () => {}, ciRed: () => {}, incident: (_m, x) => said.push(`incident ${x}`), checkErrors: async () => verdicts[ran++] }, () => 'deploy.yml', () => Date.parse(now))
    const a = w('2026-10-17T10:10:00Z'); await a.tick(); await a.idle()
    expect(ran).toBe(0) // the interval is 15 min: not due yet
    const b = w('2026-10-17T10:16:00Z'); await b.tick(); await b.idle()
    expect([ran, monitorEvents(db, 'M-1').at(-1)?.text]).toEqual([1, 'Errors checked: no new errors'])
    db.prepare("UPDATE monitor_events SET at = '2026-10-17T10:16:00Z' WHERE kind = 'error-check'").run()
    const c = w('2026-10-17T10:32:00Z'); await c.tick(); await c.idle()
    expect([getMonitor(db, 'M-1').stage, said]).toEqual(['incident', ['incident New production errors after the deploy: NoMethodError in EscrowRouter (42 since 10:02)']])
  })

  it('a failed error check is logged and the watch goes on', async () => {
    db.prepare("UPDATE monitors SET stage = 'stable', merge_sha = 'm1', deployed_at = '2026-10-17T10:00:00Z' WHERE id = 'M-1'").run()
    const w = new MonitorWatcher(db, fake({ main: [] }), { ciGreen: () => {}, ciRed: () => {}, incident: () => {}, checkErrors: async () => { throw new Error('Scout timed out') } }, () => 'deploy.yml', () => Date.parse('2026-10-17T10:20:00Z'))
    await w.tick(); await w.idle()
    expect([getMonitor(db, 'M-1').stage, monitorEvents(db, 'M-1').at(-1)?.text]).toEqual(['stable', 'Error check failed: Scout timed out'])
  })

  it('approval: a GitHub approval is recorded once; review threads are read every 15 min while open and unapproved', async () => {
    let reads = 0
    let now = Date.parse('2026-10-17T10:00:00Z')
    const open = { state: 'OPEN', mergeCommit: null, statusCheckRollup: [check('rspec', 'IN_PROGRESS', null)] }
    const w = (pr: object): MonitorWatcher => new MonitorWatcher(db, fake({ pr }), { ciGreen: () => {}, ciRed: () => {}, incident: () => {}, checkApproval: async () => { reads++ } }, () => 'deploy.yml', () => now)
    const one = w(open)
    await one.tick(); await one.idle()
    expect(reads).toBe(0) // no request recorded yet: nothing to read
    recordRequest(db, { repo: REPO, pr: 7, app: 'Slack', place: '#reviews', state: 'sent' })
    await one.tick(); await one.idle()
    now += 60_000; await one.tick(); await one.idle()
    expect(reads).toBe(1)
    now += THREAD_EVERY_MS; await one.tick(); await one.idle()
    expect(reads).toBe(2)
    const approved = w({ ...open, reviewDecision: 'APPROVED', latestReviews: [{ author: { login: 'asha' }, state: 'APPROVED' }, { author: { login: 'ravi' }, state: 'COMMENTED' }] })
    await approved.tick(); await approved.tick(); await approved.idle()
    expect(monitorEvents(db, 'M-1').filter((e) => e.kind === 'approved').map((e) => e.text)).toEqual(['Approved on GitHub by asha'])
    expect(requestsOf(db, REPO, 7).find((r) => r.app === 'GitHub')).toMatchObject({ state: 'approved', by: 'asha' })
    now += THREAD_EVERY_MS; await one.tick(); await one.idle()
    expect(reads).toBe(2) // approved: the threads are not read any more
  })

  it('a change watch: error checks each interval from the change time, no GitHub calls, done after its window; a problem is an incident', async () => {
    // Timeline entries use the real clock, so times here are relative to now.
    stopMonitor(db, 'M-1', 'only the change watch here') // the PR monitor every test starts with
    const t0 = Date.now() - 40 * 60_000
    const iso = (min: number): string => new Date(t0 + min * 60_000).toISOString()
    const w = startChange(db, { session: 'impl', repo: REPO, subject: 'merchant X: instant payout on', since: iso(0), windowMinutes: 60, checkMinutes: 15 })
    const verdicts = [{ newErrors: true, summary: 'payout 500s for merchant X' }]
    let ran = 0
    const at = (min: number): MonitorWatcher => new MonitorWatcher(db, fake({}), { ciGreen: () => {}, ciRed: () => {}, incident: (_m, x) => said.push(`incident ${x}`), checkErrors: async () => verdicts[ran++] }, () => 'deploy.yml', () => t0 + min * 60_000)
    const early = at(10); await early.tick(); await early.idle()
    expect(ran).toBe(0) // not one interval after the change yet
    const later = at(16); await later.tick(); await later.idle()
    expect(said).toEqual(['incident New production errors after the change: payout 500s for merchant X'])
    expect(calls).toEqual([]) // no GitHub calls for a change watch
    const old = startChange(db, { session: 'impl', repo: REPO, subject: 'merchant Y', since: new Date(Date.now() - 90 * 60_000).toISOString(), windowMinutes: 30, checkMinutes: 15 })
    const now = new MonitorWatcher(db, fake({}), { ciGreen: () => {}, ciRed: () => {}, incident: () => {} }, () => 'deploy.yml')
    await now.tick()
    expect(getMonitor(db, old.id).stage).toBe('done')
    expect(getMonitor(db, w.id).stage).toBe('incident')
  })

  it('Check now runs one error check at once, shares a running one, and refuses before production', async () => {
    const w = startChange(db, { session: 'impl', repo: REPO, subject: 'merchant X', since: new Date().toISOString(), windowMinutes: 60, checkMinutes: 15 })
    let ran = 0
    let release = (): void => {}
    const gate = new Promise<void>((r) => { release = r })
    const watcher = new MonitorWatcher(db, fake({}), { ciGreen: () => {}, ciRed: () => {}, incident: () => {}, checkErrors: async () => { ran++; await gate; return { newErrors: false, summary: 'nothing new' } } }, () => 'deploy.yml')
    const one = watcher.checkNow(getMonitor(db, w.id))
    const two = watcher.checkNow(getMonitor(db, w.id))
    expect(two).toBe(one) // one at a time per monitor
    release(); await one
    expect(ran).toBe(1)
    expect(monitorEvents(db, w.id).at(-1)!.text).toBe('Errors checked: nothing new')
    expect(() => watcher.checkNow(getMonitor(db, 'M-1'))).toThrow('M-1 is not watching production (ci)')
  })

  it('started fires once per monitor (the Story is written then)', async () => {
    const seen: string[] = []
    const w = new MonitorWatcher(db, fake({ pr: { state: 'OPEN', mergeCommit: null, statusCheckRollup: [] } }), { ciGreen: () => {}, ciRed: () => {}, incident: () => {}, started: (m) => seen.push(m.id) }, () => 'deploy.yml')
    await w.tick(); await w.tick()
    expect(seen).toEqual(['M-1'])
  })
})
