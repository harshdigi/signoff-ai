// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../store'
import { deleteWorkflow, getWorkflow, listWorkflows, saveWorkflow, teamLine } from '../workflows'

const store = () => openStore(join(mkdtempSync(join(tmpdir(), 'wf-')), 'b.db'))

describe('workflows', () => {
  it('lists the built-in team setups, then yours; saving again replaces, delete removes', () => {
    const db = store()
    expect(listWorkflows(db).map((w) => w.id)).toEqual(['solo', 'implement-review', 'parallel'])
    const w = { id: 'api-team', name: ' API team ', description: 'two builders', team: [{ role: 'implementer', count: 2, does: 'builds' }] }
    expect(saveWorkflow(db, w)).toEqual({ ...w, name: 'API team', goodFor: [], notFor: [], builtIn: false })
    saveWorkflow(db, { ...w, description: 'changed' })
    expect(listWorkflows(db).map((x) => [x.id, x.description]).slice(3)).toEqual([['api-team', 'changed']])
    expect(getWorkflow(db, 'api-team').name).toBe('API team')
    deleteWorkflow(db, 'api-team')
    expect(() => getWorkflow(db, 'api-team')).toThrow('no workflow api-team')
  })

  it('refuses to change built-in ones and bad shapes', () => {
    const db = store()
    expect(() => saveWorkflow(db, { id: 'solo', name: 'x', description: '', team: [] })).toThrow('solo is built in; save it under another name')
    expect(() => deleteWorkflow(db, 'parallel')).toThrow('parallel is built in and cannot be deleted')
    expect(() => saveWorkflow(db, { id: 'Bad Id', name: 'x', description: '', team: [] })).toThrow('a workflow id is 2-41 lowercase letters, digits or dashes')
    expect(() => saveWorkflow(db, { id: 'ok', name: 'x', description: '', team: [{ role: 'r', count: 0, does: 'd' }] })).toThrow('r: count is 1-10, or empty for "the parent proposes"')
  })

  it('keeps when to use a setup, trimmed; setups saved before that existed get empty lists', () => {
    const db = store()
    const w = { id: 'api-team', name: 'API team', description: '', team: [{ role: 'implementer', count: 2, does: 'builds' }], goodFor: [' Two services ', ''], notFor: ['Small fixes'] }
    expect(saveWorkflow(db, w)).toMatchObject({ goodFor: ['Two services'], notFor: ['Small fixes'] })
    db.prepare("UPDATE settings SET value = ? WHERE key = 'workflows'").run(JSON.stringify([{ id: 'old', name: 'Old', description: '', team: [], builtIn: false }]))
    expect(getWorkflow(db, 'old')).toEqual({ id: 'old', name: 'Old', description: '', team: [], goodFor: [], notFor: [], builtIn: false })
    expect(listWorkflows(db).slice(0, 3).every((x) => x.goodFor.length > 0 && x.notFor.length > 0)).toBe(true)
  })

  it('describes a team in one line', () => {
    const db = store()
    expect(listWorkflows(db).map(teamLine)).toEqual(['one session', '1 implementer + 1 reviewer', 'N implementers + 1 reviewer'])
  })
})
