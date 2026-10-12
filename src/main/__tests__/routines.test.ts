// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { askArgs, findClaude } from '../../cli/ask'
import { frontmatter } from '../catalog'
import { parseDeepLink } from '../deeplink'
import { getSettings, saveSettings } from '../settings'
import { createSkill } from '../skillwriter'
import { openStore } from '../store'

describe('your own skills', () => {
  it('are written as Claude Code skills that read back the same, in your folder or the repo', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const file = createSkill({ name: 'start-my-day', description: 'When I say "start my day": check PRs, decisions & meetings', body: '1. Show open reviews.\n2. Standup points.', scope: 'user' }, home)
    expect(file).toBe(join(home, '.claude/skills/start-my-day/SKILL.md'))
    expect(frontmatter(readFileSync(file, 'utf8'))).toEqual({ name: 'start-my-day', description: 'When I say "start my day": check PRs, decisions & meetings', 'user-invocable': 'true' })
    expect(readFileSync(file, 'utf8')).toContain('\n---\n\n1. Show open reviews.\n2. Standup points.\n')
    expect(() => createSkill({ name: 'start-my-day', description: 'x', body: 'y', scope: 'user' }, home)).toThrow('a skill called start-my-day already exists there')
    expect(() => createSkill({ name: 'Start My Day', description: 'x', body: 'y', scope: 'user' }, home)).toThrow('name: lower-case letters, digits and dashes')
    expect(() => createSkill({ name: 'x', description: 'x', body: 'y', scope: 'project', folder: null }, home)).toThrow('open a folder to save a skill in it')
    const repo = mkdtempSync(join(tmpdir(), 'repo-'))
    expect(createSkill({ name: 'deploy-check', description: 'd', body: 'b', scope: 'project', folder: repo }, home)).toBe(join(repo, '.claude/skills/deploy-check/SKILL.md'))
  })

  it('pins and run-on-open are validated: only a pinned skill can run when the app opens', () => {
    const db = openStore(join(mkdtempSync(join(tmpdir(), 'pins-')), 'board.db'))
    expect(getSettings(db)).toMatchObject({ pins: [], onOpen: null })
    saveSettings(db, { pins: [{ key: 'skill:standup', label: 'Start my day' }], onOpen: 'skill:standup' })
    expect(getSettings(db)).toMatchObject({ pins: [{ key: 'skill:standup', label: 'Start my day' }], onOpen: 'skill:standup' })
    expect(() => saveSettings(db, { onOpen: 'skill:other' })).toThrow('only a pinned skill can run when the app opens')
    expect(() => saveSettings(db, { pins: [{ key: 'skill:x', label: ' ' }] })).toThrow('each pin needs a skill and a label')
  })
})

describe('Siri and Shortcuts', () => {
  it('reads decision-ide:// links and ignores anything else', () => {
    expect(parseDeepLink('decision-ide://run?skill=standup')).toEqual({ action: 'run', skill: 'standup' })
    expect(parseDeepLink('decision-ide://run?skill=tools:lint')).toEqual({ action: 'run', skill: 'tools:lint' })
    expect(parseDeepLink('decision-ide://ask?text=what%27s%20the%20update%20on%20ABC-9015')).toEqual({ action: 'ask', text: "what's the update on ABC-9015" })
    expect(parseDeepLink('decision-ide://run?skill=rm%20-rf')).toBeNull()
    expect(parseDeepLink('decision-ide://ask?text=')).toBeNull()
    expect(parseDeepLink('decision-ide://delete-everything')).toBeNull()
    expect(parseDeepLink('https://example.com/run?skill=standup')).toBeNull()
    expect(parseDeepLink('not a url')).toBeNull()
  })

  it('signoff ask runs claude headless with no permission prompts and a voice-style answer', () => {
    const a = askArgs("what's the update on ABC-9015", undefined, ['/p/svc'])
    expect(a.slice(0, 6)).toEqual(['-p', "what's the update on ABC-9015", '--output-format', 'text', '--permission-prompts', 'none'])
    expect(a.slice(6, 8)).toEqual(['--settings', '{"disableAllHooks":true}'])
    expect(a[9]).toContain('answering a question the user asked by voice')
    expect(a.slice(-2)).toEqual(['--add-dir', '/p/svc'])
    expect(askArgs('today', 'standup', [])[1]).toBe('/standup today')
  })

  it('finds claude where the official installer puts it, even with the short PATH Shortcuts uses', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    writeFileSync(join(home, '.local/bin/claude'), '')
    expect(findClaude('/usr/bin:/bin', home)).toBe(join(home, '.local/bin/claude'))
  })
})
