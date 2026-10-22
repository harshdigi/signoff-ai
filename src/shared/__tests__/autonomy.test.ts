// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import { answer, postDecision, touchSession } from '../board'
import { getSettings, saveSettings } from '../../main/settings'
import { allows, ASK, delegate, getAutonomy, getDiscuss, ITEMS, MODES, modeOf, normalize, PLAN_ITEM, planApproved, setAutonomy, setDiscuss } from '../autonomy'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'autonomy-')), 'board.db'))
  touchSession(db, 's', {})
})

describe('autonomy', () => {
  it('modes are presets: Plan first ticks all of Implementing plus commit and branch; Full ticks everything not locked', () => {
    expect(normalize({ mode: 'ask' })).toEqual({ mode: 'ask', items: [], plan: false })
    expect(normalize({ mode: 'planFirst' }).plan).toBe(true)
    expect(normalize({ mode: 'planFirst' }).items).toEqual(['impl.reviews', 'impl.details', 'impl.fixes', 'impl.patterns', 'impl.surprise', 'ship.commit', 'ship.branch'])
    expect(normalize({ mode: 'full' }).items).toEqual(ITEMS)
    expect(ITEMS.some((i) => i.startsWith('lock.'))).toBe(false)
  })

  it('changing one box makes it custom; ticking a preset\'s boxes again finds the preset', () => {
    const plan = [...MODES.planFirst.items]
    expect(normalize({ items: [...plan, 'ship.push'] }).mode).toBe('custom')
    expect(normalize({ items: [...plan].reverse(), plan: true }).mode).toBe('planFirst')
    expect(normalize({ items: [...plan] }).mode).toBe('custom') // same boxes without the plan switch
    expect(modeOf([])).toBe('ask')
  })

  it('Discuss or Decide: the default from Settings until switched; the switch survives a checklist change', () => {
    touchSession(db, 'd1', {})
    expect(getDiscuss(db, 'd1', false)).toBe(false)
    expect(getDiscuss(db, 'd1', true)).toBe(true)
    setDiscuss(db, 'd1', true, ASK)
    expect(getDiscuss(db, 'd1', false)).toBe(true)
    setAutonomy(db, 'd1', { mode: 'full' })
    expect(getDiscuss(db, 'd1', false)).toBe(true)
    expect(getAutonomy(db, 'd1').mode).toBe('full')
    setDiscuss(db, 'd1', false, ASK)
    expect(getDiscuss(db, 'd1', true)).toBe(false)
  })

  it('refuses locked and unknown items, and unknown modes', () => {
    expect(() => normalize({ items: ['impl.fixes', 'lock.deploy'] })).toThrow('always asks, cannot be handed to Claude: lock.deploy')
    expect(() => normalize({ items: ['impl.nope'] })).toThrow('unknown autonomy item: impl.nope')
    expect(() => normalize({ mode: 'yolo' })).toThrow('unknown autonomy mode yolo')
    expect(allows({ mode: 'custom', items: ['lock.deploy'], plan: false }, 'lock.deploy')).toBe(false)
  })

  it('a session uses its own choice, else the Settings default, else ask everything', () => {
    expect(getAutonomy(db, 's')).toEqual(ASK)
    saveSettings(db, { autonomy: normalize({ mode: 'planFirst' }) })
    expect(() => saveSettings(db, { autonomy: { mode: 'custom', items: ['lock.money'], plan: false } })).toThrow('always asks')
    expect(getAutonomy(db, 's', getSettings(db).autonomy).mode).toBe('planFirst')
    setAutonomy(db, 's', { items: ['impl.fixes'] })
    expect(getAutonomy(db, 's', getSettings(db).autonomy)).toEqual({ mode: 'custom', items: ['impl.fixes'], plan: false })
    expect(() => setAutonomy(db, 'nobody', { mode: 'ask' })).toThrow('no session nobody')
  })

  it('plan first: nothing is settled by Claude until the user approves its plan card', () => {
    setAutonomy(db, 's', { mode: 'planFirst' })
    db.prepare("UPDATE sessions SET mode = 'default' WHERE id = 's'").run()
    expect(delegate(db, 's', 'impl.details')).toEqual({ reason: 'Claude Code is in default mode, not Auto: autonomy is paused' })
    db.prepare("UPDATE sessions SET mode = 'auto' WHERE id = 's'").run()
    expect(delegate(db, 's', 'impl.details')).toEqual({ reason: 'Plan first: the plan is not approved yet; post it with signoff plan and wait for the answer' })
    postDecision(db, { ticket: 'K-1', number: 'D1', session: 's', question: 'Approve the plan?', action: 'consent', item: PLAN_ITEM })
    expect(planApproved(db, 's')).toBe(false)
    answer(db, 'K-1/D1', 'Approve', 'you')
    expect(delegate(db, 's', 'impl.details')).toEqual({ by: 'claude (Plan first, then run)' })
    // A new plan card (a changed plan) needs approving again.
    postDecision(db, { ticket: 'K-1', number: 'D2', session: 's', question: 'Approve the new plan?', action: 'consent', item: PLAN_ITEM })
    expect(planApproved(db, 's')).toBe(false)
  })
})
