// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { Tmux } from '../tmux'

// Real tmux, on a socket of its own per run.
const socket = `dide-test-${process.pid}`
const tmux = new Tmux(join(__dirname, '../../../resources/tmux.conf'), socket)
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 30))
}
afterEach(() => {
  try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* no server left */ }
})

describe('Tmux', () => {
  it('starts a session with its env, clears inherited variables, types keys and pastes, reads the screen, stops', async () => {
    process.env.DIDE_LEAK = 'leaked'
    tmux.start('s1', { cwd: '/tmp', command: ['sh', '-c', 'echo "A=$A LEAK=${DIDE_LEAK:-none}"; exec cat -v'], env: { A: 'set' }, unset: ['DIDE_LEAK'], cols: 80, rows: 20 })
    delete process.env.DIDE_LEAK
    expect(tmux.has('s1')).toBe(true)
    expect(tmux.has('s')).toBe(false) // exact names only, no prefix match
    tmux.type('s1', 'héllo "q" $HOME')
    tmux.key('s1', 'Enter')
    tmux.key('s1', 'BTab')
    tmux.type('s1', 'one\ntwo')
    tmux.key('s1', 'Enter')
    await until(() => tmux.screen('s1').some((l) => l.includes('two')))
    // The terminal echoes input and cat prints it again, so check what arrived rather than the exact line breaks.
    const shown = tmux.screen('s1')
    expect(shown[0]).toBe('A=set LEAK=none')
    expect(shown.filter((l) => l === 'héllo "q" $HOME')).toHaveLength(2)
    expect(shown.join('\n')).toContain('^[[Zone')
    tmux.stop('s1')
    expect(tmux.has('s1')).toBe(false)
  })

  it('attaching uses the same socket and config', () => {
    expect(tmux.attachArgs('s1')).toEqual(['-L', socket, '-f', join(__dirname, '../../../resources/tmux.conf'), 'attach', '-t', '=s1'])
  })

  it('says plainly that tmux is missing, instead of a spawn error', () => {
    const path = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      expect(() => tmux.has('x')).toThrow('tmux is not installed. Chats run in tmux: open Setup (⇧⌘P → Setup) and install it.')
    } finally {
      process.env.PATH = path
    }
  })
})

