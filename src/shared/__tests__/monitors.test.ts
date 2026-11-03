// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import { touchSession } from '../board'
import * as m from '../monitors'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'monitors-')), 'board.db'))
  touchSession(db, 'lead', {})
  touchSession(db, 'impl', {})
})
const base = { repo: 'glomopay/glomopay_service', pr: 5152, windowMinutes: 60, checkMinutes: 15 }

describe('monitors', () => {
  it('a change watch has no PR, starts watching at the change time, and needs a description', () => {
    const w = m.startChange(db, { session: 'impl', repo: base.repo, subject: 'merchant X: instant payout on', focus: 'merchant X', since: '2026-10-01T09:00:00Z', windowMinutes: 60, checkMinutes: 15 })
    expect([w.kind, w.pr, w.stage, w.deployed_at, w.subject, w.focus]).toEqual(['change', null, 'stable', '2026-10-01T09:00:00.000Z', 'merchant X: instant payout on', 'merchant X'])
    expect(m.monitorEvents(db, w.id).map((e) => e.text)).toEqual(['Watching a change: merchant X: instant payout on (focus: merchant X); errors every 15 min for 60 min from 2026-10-01T09:00:00.000Z'])
    expect(() => m.startChange(db, { session: 'impl', repo: base.repo, subject: '  ', since: '2026-10-01T09:00:00Z', windowMinutes: 60, checkMinutes: 15 })).toThrow('say what changed')
    // Two change watches in one repo are fine; a PR monitor alongside them too.
    m.startChange(db, { session: 'impl', repo: base.repo, subject: 'merchant Y', since: '2026-10-01T09:00:00Z', windowMinutes: 60, checkMinutes: 15 })
    m.startMonitor(db, { ...base, session: 'impl' })
    expect(m.changeWatches(db, 'impl').map((x) => x.subject)).toEqual(['merchant Y', 'merchant X: instant payout on'])
  })

  it('extend adds time to a live watch, up to 7 days; a finished one is refused', () => {
    const a = m.startMonitor(db, { ...base, session: 'impl' })
    expect(m.extendMonitor(db, a.id, 240).window_minutes).toBe(300)
    expect(m.monitorEvents(db, a.id).at(-1)!.text).toBe('Window extended by 240 min; now 300 min')
    expect(() => m.extendMonitor(db, a.id, 7 * 24 * 60)).toThrow('the window is at most 7 days')
    m.stopMonitor(db, a.id, 'done here')
    expect(() => m.extendMonitor(db, a.id, 60)).toThrow(`${a.id} is stopped`)
  })

  it('one live monitor per pull request; a stopped one frees it', () => {
    const a = m.startMonitor(db, { ...base, session: 'impl', ticket: 'KAN-9321' })
    expect([a.id, a.stage, a.notify, a.recipients]).toEqual(['M-1', 'ci', 0, null])
    expect(() => m.startMonitor(db, { ...base, session: 'lead' })).toThrow('glomopay/glomopay_service#5152 is already watched by M-1 (session impl)')
    // Another pull request is fine.
    expect(m.startMonitor(db, { ...base, pr: 5153, session: 'lead' }).id).toBe('M-2')
    m.stopMonitor(db, 'M-1', 'merged elsewhere')
    expect(m.startMonitor(db, { ...base, session: 'lead' }).id).toBe('M-3')
    expect(m.liveMonitors(db).map((x) => x.id)).toEqual(['M-2', 'M-3'])
  })

  it('moves through the stages with a timeline, and a stopped monitor does not move again', () => {
    m.startMonitor(db, { ...base, session: 'impl' })
    m.setStage(db, 'M-1', 'merge', 'CI passed')
    m.setStage(db, 'M-1', 'deploy', 'Merged', { merge_sha: 'abc123' })
    const s = m.setStage(db, 'M-1', 'stable', 'Deployed to production', { deployed_at: '2026-10-17T10:00:00Z' })
    expect([s.stage, s.merge_sha, s.deployed_at]).toEqual(['stable', 'abc123', '2026-10-17T10:00:00Z'])
    expect(m.monitorEvents(db, 'M-1').map((e) => [e.kind, e.text])).toEqual([
      ['started', 'Watching glomopay/glomopay_service#5152: CI, merge, production deploy, then 60 min of stability'],
      ['merge', 'CI passed'], ['deploy', 'Merged'], ['stable', 'Deployed to production']
    ])
    m.stopMonitor(db, 'M-1', 'not needed')
    expect(() => m.setStage(db, 'M-1', 'done', 'x')).toThrow('M-1 is stopped')
    expect(() => m.stopMonitor(db, 'M-1', ' ')).toThrow('say why it stops')
  })

  it('checks its settings: repo form, pull request, window, interval, and recipients when notifying', () => {
    expect(() => m.startMonitor(db, { ...base, repo: 'just-a-name', session: 'impl' })).toThrow('repo must be owner/name: just-a-name')
    expect(() => m.startMonitor(db, { ...base, pr: 0, session: 'impl' })).toThrow('not a pull request number: 0')
    expect(() => m.startMonitor(db, { ...base, windowMinutes: 2, session: 'impl' })).toThrow('the stability window is 5 minutes to 7 days')
    expect(() => m.startMonitor(db, { ...base, checkMinutes: 90, session: 'impl' })).toThrow('the check interval is at least 5 minutes and no longer than the window')
    expect(() => m.startMonitor(db, { ...base, notify: true, session: 'impl' })).toThrow('pick at least one recipient for the review request')
    const r = m.startMonitor(db, { ...base, notify: true, recipients: [{ app: 'slack', where: '#lrs-reviews', tags: ['@lrs-team'] }], session: 'impl' })
    expect([r.notify, JSON.parse(r.recipients!)]).toEqual([1, [{ app: 'slack', where: '#lrs-reviews', tags: ['@lrs-team'] }]])
  })

  it('keeps each repo\'s monitoring setup', () => {
    expect(m.getSetup(db, base.repo)).toBeNull()
    m.saveSetup(db, base.repo, { messaging: [{ app: 'slack' }], errors: { app: 'scout' } })
    m.saveSetup(db, base.repo, { messaging: [{ app: 'teams' }], errors: { app: 'scout' } })
    expect(m.getSetup(db, base.repo)).toEqual({ messaging: [{ app: 'teams' }], errors: { app: 'scout' } })
  })

  it('the database itself refuses a second live monitor on one pull request', () => {
    m.startMonitor(db, { ...base, session: 'impl' })
    expect(() => db.prepare("INSERT INTO monitors (id, repo, pr, stage, window_minutes, check_minutes, created_at, updated_at) VALUES ('M-9', ?, ?, 'ci', 60, 15, 't', 't')").run(base.repo, base.pr)).toThrow(/UNIQUE/)
  })
})
