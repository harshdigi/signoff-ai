// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { TerminalManager, terminalEnv } from '../terminals'

const collect = (t: TerminalManager, id: string): Promise<{ out: string; code: number }> =>
  new Promise((resolve) => {
    let out = ''
    t.onData((e) => { if (e.id === id) out += e.data })
    t.onExit((e) => { if (e.id === id) resolve({ out, code: e.exitCode }) })
  })

describe('TerminalManager', () => {
  it('runs a command in a pty and reports its output and exit', async () => {
    const t = new TerminalManager()
    const info = t.spawn({ command: '/bin/sh', args: ['-c', 'echo hello; exit 3'] })
    const r = await collect(t, info.id)
    expect(r.out.trim()).toBe('hello')
    expect(r.code).toBe(3)
    expect(t.replay(info.id).trim()).toBe('hello')
    expect(t.list()[0]).toMatchObject({ id: info.id, exited: true, exitCode: 3 })
  })

  it('takes input and resizes', async () => {
    const t = new TerminalManager()
    const info = t.spawn({ command: '/bin/sh', args: ['-c', 'read x; stty size; echo got $x'], cols: 80, rows: 24 })
    const done = collect(t, info.id)
    t.resize(info.id, 120, 40)
    t.write(info.id, 'abc\r')
    const r = await done
    expect(r.out).toContain('40 120')
    expect(r.out).toContain('got abc')
  })

  it('closing a tab ends its process and forgets it', async () => {
    const t = new TerminalManager()
    const info = t.spawn({ command: '/bin/sh', args: ['-c', 'sleep 30'] })
    const done = collect(t, info.id)
    t.close(info.id)
    await done
    expect(t.list()).toEqual([])
    expect(() => t.write(info.id, 'x')).toThrow(`no terminal ${info.id}`)
  })

  it("drops a parent Claude Code session's variables so a claude started here saves its conversation", () => {
    const base = { PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_PID: '9', CLAUDE_EFFORT: 'high', AI_AGENT: 'claude', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_USE_BEDROCK: '1' }
    expect(terminalEnv(base, { DECISION_IDE_DB: '/d' })).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_USE_BEDROCK: '1', TERM: 'xterm-256color', DECISION_IDE_DB: '/d' })
  })

  it('keeps the session a terminal belongs to, so the window can group it after a reload', () => {
    const t = new TerminalManager()
    const a = t.spawn({ command: '/bin/sh', args: ['-c', 'sleep 5'], session: 's1' })
    const b = t.spawn({ command: '/bin/sh', args: ['-c', 'sleep 5'] })
    expect(t.list().map((x) => [x.id, x.session])).toEqual([[a.id, 's1'], [b.id, null]])
    t.closeAll()
  })

  it('closing a terminal twice, or one it never had, does nothing (quitting must not fail on it)', () => {
    const t = new TerminalManager()
    const a = t.spawn({ command: '/bin/sh', args: ['-c', 'sleep 5'] })
    t.close(a.id)
    expect(() => t.close(a.id)).not.toThrow()
    expect(() => t.close('no-such-terminal')).not.toThrow()
  })
})
