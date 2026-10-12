// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore } from '../../main/store'
import { answerApproval, requestApproval } from '../approvals'
import { touchSession } from '../board'
import { isOutward, serviceOf } from '../outward'

describe('outward tool calls', () => {
  it('tells sends from reads', () => {
    const yes = ['mcp__claude_ai_Slack__slack_send_message', 'mcp__claude_ai_Atlassian__createJiraIssue', 'mcp__claude_ai_Atlassian__addCommentToJiraIssue', 'mcp__claude_ai_Atlassian__transitionJiraIssue', 'mcp__claude_ai_Slack__slack_schedule_message']
    const no = ['mcp__claude_ai_Slack__slack_read_channel', 'mcp__claude_ai_Slack__slack_search_public', 'mcp__claude_ai_Atlassian__getJiraIssue', 'mcp__funes__recall', 'mcp__decide__approve', 'Edit', 'Read']
    expect(yes.map((t) => isOutward(t))).toEqual(yes.map(() => true))
    expect(no.map((t) => isOutward(t))).toEqual(no.map(() => false))
    expect(isOutward('Bash', { command: 'git push origin ABC-1' })).toBe(true)
    expect(isOutward('Bash', { command: 'gh pr create --fill' })).toBe(true)
    expect(isOutward('Bash', { command: 'git status' })).toBe(false)
    expect([serviceOf('mcp__claude_ai_Slack__slack_send_message'), serviceOf('mcp__postman__createCollection'), serviceOf('Bash')]).toEqual(['Slack', 'postman', 'git / GitHub'])
  })

  it('are approved one at a time: never by an earlier "allow for this chat", and never as one', () => {
    const db = openStore(join(mkdtempSync(join(tmpdir(), 'out-')), 'board.db'))
    touchSession(db, 's1', {})
    const send = 'mcp__claude_ai_Slack__slack_send_message'
    const first = requestApproval(db, 's1', send, { channel: 'C1', text: 'hi' })
    expect(() => answerApproval(db, first.id, { allow: true, scope: 'chat' })).toThrow('something sent outside is approved one at a time')
    const sent = answerApproval(db, first.id, { allow: true, updatedInput: { channel: 'C1', text: 'hi, edited' } })
    expect(JSON.parse(sent.result!)).toEqual({ behavior: 'allow', updatedInput: { channel: 'C1', text: 'hi, edited' } })
    db.prepare("UPDATE approvals SET scope = 'chat' WHERE id = ?").run(first.id) // even a standing chat allow (from older data)
    expect(requestApproval(db, 's1', send, { channel: 'C1', text: 'again' }).status).toBe('pending')
  })
})
