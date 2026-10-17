// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import { touchSession } from '../board'
import { getSettings, saveSettings } from '../../main/settings'
import { allows, ASK, getAutonomy, ITEMS, MODES, modeOf, normalize, setAutonomy } from '../autonomy'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'autonomy-')), 'board.db'))
  touchSession(db, 's', {})
})

describe('autonomy', () => {
  it('modes are presets: Plan first ticks all of Implementing plus commit and branch; Full ticks everything not locked', () => {
    expect(normalize({ mode: 'ask' })).toEqual({ mode: 'ask', items: [] })
    expect(normalize({ mode: 'planFirst' }).items).toEqual(['impl.reviews', 'impl.details', 'impl.fixes', 'impl.patterns', 'impl.surprise', 'ship.commit', 'ship.branch'])
    expect(normalize({ mode: 'full' }).items).toEqual(ITEMS)
    expect(ITEMS.some((i) => i.startsWith('lock.'))).toBe(false)
  })

  it('changing one box makes it custom; ticking a preset\'s boxes again finds the preset', () => {
    const plan = [...MODES.planFirst.items]
    expect(normalize({ items: [...plan, 'ship.push'] }).mode).toBe('custom')
    expect(normalize({ items: [...plan].reverse() }).mode).toBe('planFirst')
    expect(modeOf([])).toBe('ask')
  })

  it('refuses locked and unknown items, and unknown modes', () => {
    expect(() => normalize({ items: ['impl.fixes', 'lock.deploy'] })).toThrow('always asks, cannot be handed to Claude: lock.deploy')
    expect(() => normalize({ items: ['impl.nope'] })).toThrow('unknown autonomy item: impl.nope')
    expect(() => normalize({ mode: 'yolo' })).toThrow('unknown autonomy mode yolo')
    expect(allows({ mode: 'custom', items: ['lock.deploy'] }, 'lock.deploy')).toBe(false)
  })

  it('a session uses its own choice, else the Settings default, else ask everything', () => {
    expect(getAutonomy(db, 's')).toEqual(ASK)
    saveSettings(db, { autonomy: normalize({ mode: 'planFirst' }) })
    expect(() => saveSettings(db, { autonomy: { mode: 'custom', items: ['lock.money'] } })).toThrow('always asks')
    expect(getAutonomy(db, 's', getSettings(db).autonomy).mode).toBe('planFirst')
    setAutonomy(db, 's', { items: ['impl.fixes'] })
    expect(getAutonomy(db, 's', getSettings(db).autonomy)).toEqual({ mode: 'custom', items: ['impl.fixes'] })
    expect(() => setAutonomy(db, 'nobody', { mode: 'ask' })).toThrow('no session nobody')
  })
})
