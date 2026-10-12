// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { findTranscript, listConversations, readNew, toChatLines } from '../transcript'
import { toRows, waitingInTerminal } from '../../renderer/src/chat/transcript'

const T = '2026-10-07T10:00:00.000Z'

describe("reading Claude Code's transcript", () => {
  it('keeps prompts, replies, tool results, turn ends and the title; skips injected and subagent lines', () => {
    const lines = toChatLines([
      { type: 'permission-mode', permissionMode: 'acceptEdits' } as never,
      { type: 'user', uuid: 'u0', timestamp: T, isMeta: true, message: { content: 'injected context' } },
      { type: 'user', uuid: 'u1', timestamp: T, message: { content: 'fix the bug' } },
      { type: 'assistant', uuid: 'a1', timestamp: T, isSidechain: true, message: { content: [{ type: 'text', text: 'subagent' }] } },
      { type: 'assistant', uuid: 'a2', timestamp: T, message: { content: [{ type: 'text', text: 'On it.' }] } },
      { type: 'user', uuid: 'u2', timestamp: T, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' } as never] } },
      { type: 'user', uuid: 'u3', timestamp: T, message: { content: [{ type: 'image' }, { type: 'text', text: 'this one' }] } },
      { type: 'system', uuid: 's1', timestamp: T, subtype: 'turn_duration', durationMs: 2500 },
      { type: 'user', uuid: 'n1', timestamp: T, origin: { kind: 'task-notification' }, message: { content: '<task-notification>\n<status>completed</status>\n<summary>Background command "Wait for D44" completed (exit code 0)</summary>\n</task-notification>' } },
            { type: 'ai-title', aiTitle: 'Fix the login bug' },
      { type: 'file-history-snapshot' }
    ])
    expect(lines.map((l) => l.type)).toEqual(['prompt', 'assistant', 'user', 'prompt', 'turn_end', 'notice', 'title'])
    expect(lines[3]).toMatchObject({ type: 'prompt', text: 'this one', images: 1 })
    expect(lines[4]).toMatchObject({ type: 'turn_end', ms: 2500 })
    expect(lines[5]).toEqual({ type: 'notice', text: 'Background task finished: "Wait for D44" completed (exit code 0)', at: T, uuid: 'n1' })
  })

  it('reads only new complete lines, and finds the file by session id', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const dir = join(home, '.claude/projects/-Users-x-proj')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, 'abc.jsonl')
    writeFileSync(f, JSON.stringify({ type: 'user', message: { content: 'one' } }) + '\n{"type":"assist')
    const first = readNew(f, 0)
    expect(first.lines.length).toBe(1)
    appendFileSync(f, 'ant"}\n')
    const second = readNew(f, first.offset)
    expect(second.lines).toEqual([{ type: 'assistant' }])
    expect(readNew(f, second.offset).lines).toEqual([])
    expect(findTranscript('abc', null, home)).toBe(f)
    expect(findTranscript('abc', '/no/such/file', home)).toBe(f)
    expect(findTranscript('nope', null, home)).toBeNull()
  })

  it('shows slash command output, ! commands, turn ends, and a question waiting in the terminal', () => {
    const rows = toRows([
      { type: 'prompt', text: '<command-name>/context</command-name>\n<command-args></command-args>' },
      { type: 'prompt', text: '<local-command-stdout>Context 22k / 200k</local-command-stdout>' },
      { type: 'prompt', text: '<bash-input>git status</bash-input>' },
      { type: 'turn_end', ms: 1500 }
    ] as never[])
    expect(rows).toEqual([
      { kind: 'prompt', text: '/context' }, { kind: 'text', text: '```\nContext 22k / 200k\n```' },
      { kind: 'prompt', text: '! git status' }, { kind: 'result', text: 'Done in 1.5s', isError: false }
    ])
    const ask = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't9', name: 'AskUserQuestion', input: { questions: [{ question: 'Create a ticket for this work?' }] } }] } }
    expect(waitingInTerminal([ask] as never[])).toEqual({ kind: 'question', text: 'Create a ticket for this work?' })
    expect(waitingInTerminal([ask, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9' }] } }] as never[])).toBeNull()
  })

  it("lists a folder's saved conversations newest first, titled by Claude or by the first message; empty ones are left out", () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'proj-')))
    const dir = join(home, '.claude', 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(dir, { recursive: true })
    const put = (id: string, lines: object[], when: number): void => {
      writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
      utimesSync(join(dir, `${id}.jsonl`), when, when)
    }
    put('a', [{ type: 'user', uuid: 'u', timestamp: T, message: { content: 'fix the login bug\nmore' } }], 1000)
    put('b', [{ type: 'user', uuid: 'u', timestamp: T, message: { content: 'x' } }, { type: 'ai-title', aiTitle: 'Payments refactor' }], 2000)
    put('c', [{ type: 'file-history-snapshot' }], 3000)
    expect(listConversations(folder, home).map((c) => [c.id, c.title])).toEqual([['b', 'Payments refactor'], ['a', 'fix the login bug']])
  })
})
