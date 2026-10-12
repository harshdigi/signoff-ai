// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import { answerApproval, pendingApprovals, requestApproval } from '../approvals'
import { touchSession } from '../board'

let db: Store
beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'approvals-')), 'board.db'))
  touchSession(db, 's1', {})
})

describe('approvals', () => {
  it('waits pending until answered, then hands Claude Code the allow JSON', () => {
    const a = requestApproval(db, 's1', 'Write', { file_path: 'a.txt', content: 'hi' }, 'tu1')
    expect(a.status).toBe('pending')
    expect(pendingApprovals(db).map((x) => x.id)).toEqual([a.id])
    const done = answerApproval(db, a.id, { allow: true })
    expect([done.status, done.scope, JSON.parse(done.result!)]).toEqual(['allowed', 'once', { behavior: 'allow', updatedInput: { file_path: 'a.txt', content: 'hi' } }])
    expect(pendingApprovals(db)).toEqual([])
  })

  it('a denial needs a reason and returns it to Claude', () => {
    const a = requestApproval(db, 's1', 'Bash', { command: 'rm -rf x' })
    expect(() => answerApproval(db, a.id, { allow: false, message: ' ' })).toThrow('a denial needs a reason for Claude')
    expect(JSON.parse(answerApproval(db, a.id, { allow: false, message: 'archive it instead' }).result!)).toEqual({ behavior: 'deny', message: 'archive it instead' })
    expect(() => answerApproval(db, a.id, { allow: true })).toThrow(`${a.id} is already denied`)
  })

  it('"allow for this chat" covers the same tool, and for Bash only the same command', () => {
    answerApproval(db, requestApproval(db, 's1', 'Bash', { command: 'npm test' }).id, { allow: true, scope: 'chat' })
    answerApproval(db, requestApproval(db, 's1', 'Edit', { file_path: 'a' }).id, { allow: true, scope: 'chat' })
    expect(requestApproval(db, 's1', 'Bash', { command: 'npm test' }).status).toBe('allowed')
    expect(requestApproval(db, 's1', 'Bash', { command: 'npm publish' }).status).toBe('pending')
    expect(requestApproval(db, 's1', 'Edit', { file_path: 'b' }).status).toBe('allowed')
    touchSession(db, 's2', {})
    expect(requestApproval(db, 's2', 'Edit', { file_path: 'b' }).status).toBe('pending')
  })

  it('AskUserQuestion answers travel back as updatedInput', () => {
    const a = requestApproval(db, 's1', 'AskUserQuestion', { questions: [{ question: 'Which?' }] })
    const updatedInput = { questions: [{ question: 'Which?' }], answers: { 'Which?': 'A' } }
    expect(JSON.parse(answerApproval(db, a.id, { allow: true, updatedInput }).result!)).toEqual({ behavior: 'allow', updatedInput })
  })
})
