// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../../main/store'
import { touchSession } from '../board'
import { addCase, cases, planOf, removeCase, setCase } from '../testplan'

describe('test plans', () => {
  it("a session's plan is its ticket's, else its own; cases are numbered, verified with evidence, and removable", () => {
    const db = openStore(join(mkdtempSync(join(tmpdir(), 'tp-')), 'b.db'))
    touchSession(db, 's1', { ticket: 'ABC-1' })
    touchSession(db, 's2', {})
    expect([planOf(db, 's1'), planOf(db, 's2')]).toEqual(['ABC-1', 's2'])
    addCase(db, 'ABC-1', { title: 'Creator sees sessions', steps: 'GET /links/:id/sessions', expected: '200, newest first' })
    addCase(db, 'ABC-1', { title: 'Others get 404' })
    setCase(db, 'ABC-1', 2, { status: 'pass', by: 'claude', evidence: 'spec/x_spec.rb:12 green' })
    expect(cases(db, 'ABC-1').map((c) => [c.idx, c.status, c.verified_by, c.evidence])).toEqual([[1, 'pending', null, null], [2, 'pass', 'claude', 'spec/x_spec.rb:12 green']])
    expect(() => setCase(db, 'ABC-1', 2, { status: 'done' as never })).toThrow('status is one of pending, pass, fail, blocked')
    removeCase(db, 'ABC-1', 1)
    expect(cases(db, 'ABC-1').map((c) => c.idx)).toEqual([2])
  })
})
