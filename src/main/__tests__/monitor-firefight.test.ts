// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../store'
import { touchSession } from '../../shared/board'
import { getMonitor, setStage, startMonitor } from '../../shared/monitors'
import { startFirefight, type Chats } from '../monitor-firefight'

let db: Store
let created: { cwd: string; o: object }[]
let sent: [string, string][]
const chats: Chats = { create: (cwd, o) => { created.push({ cwd, o }); touchSession(db, 'ff-session-1', {}); return 'ff-session-1' }, send: (s, t) => { sent.push([s, t]) } }
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'ff-')), 'board.db'))
  touchSession(db, 'owner', { cwd: '/work/shop' })
  startMonitor(db, { session: 'owner', repo: 'acme/shop', pr: 7, ticket: 'KAN-1', windowMinutes: 60, checkMinutes: 15 })
  setStage(db, 'M-1', 'deploy', 'Merged', { merge_sha: 'abcdef1234567890' })
  setStage(db, 'M-1', 'incident', 'Specs started failing after the deploy (run 13)', { deployed_at: '2026-10-17T10:00:00Z' })
  created = []
  sent = []
})

describe('fire fighting', () => {
  it('starts one session under the owner, in its folder, with the evidence and the "prepare, do not ship" rules', () => {
    expect(startFirefight(db, chats, getMonitor(db, 'M-1'), 'Specs started failing after the deploy (run 13)')).toBe('ff-session-1')
    expect(created).toEqual([{ cwd: '/work/shop', o: { ticket: 'KAN-1', title: 'Fire fighting: shop#7', parent: 'owner' } }])
    expect(getMonitor(db, 'M-1').firefight_session).toBe('ff-session-1')
    const brief = sent[0][1]
    expect(brief).toContain('Production incident on acme/shop#7 (KAN-1), found by monitor M-1: Specs started failing after the deploy (run 13)')
    expect(brief).toContain('   - revert-7: git revert -m 1 abcdef123456')
    expect(brief).toContain('git worktree add ../shop-firefight-M-1 origin/main')
    expect(brief).toContain("Never push, merge, deploy or roll back without the user's approval.")
  })

  it('a second incident on the same monitor goes to the same session, not a new one', () => {
    startFirefight(db, chats, getMonitor(db, 'M-1'), 'first')
    expect(startFirefight(db, chats, getMonitor(db, 'M-1'), 'New production errors after the deploy: timeouts')).toBe('ff-session-1')
    expect([created.length, sent.at(-1)]).toEqual([1, ['ff-session-1', 'Monitor M-1 saw another problem: New production errors after the deploy: timeouts']])
  })
})
