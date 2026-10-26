// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { classify, parsePs, sameStop, shortCommand, since, type Context } from '../processes'

// SIGNOFF-39-PROCS: the Background view's process list.
const PS = [
  '  100     1  10.0 200000 02-22:05:41 /Applications/Signoff AI.app/Contents/MacOS/Signoff AI',
  '  101   100   4.0  50000 02-22:05:39 /Applications/Signoff AI.app/Contents/Frameworks/Signoff AI Helper (Renderer).app/x --type=renderer --a',
  '  102   100   1.0  20000 02-22:05:39 /Applications/Signoff AI.app/Contents/Frameworks/Signoff AI Helper.app/x --type=gpu-process',
  '  200     1   0.5   3000 02-22:04:50 tmux -L decision-ide -f /Applications/Signoff AI.app/Contents/Resources/app.asar.unpacked/resources/tmux.conf new-session -d -s aaa',
  '  201   200   2.0 100000 02-22:04:50 claude --plugin-dir x',
  '  202   201   3.0  10000       00:05 /bin/zsh -c npm test',
  '  210   200   1.0  90000    04:41:00 claude --plugin-dir y',
  '  300   100   0.0    700 02-22:04:50 tmux -L decision-ide -f /x/tmux.conf attach -t =aaa',
  '  301   100   0.2   5000       00:01 /usr/bin/git status --porcelain',
  '  302   100   0.1   4000    1:02:03 /bin/zsh -l',
  '  400     1   0.0    400 14-04:09:08 tmux -L dbg84711 -f /Users/me/Code/decision-ide/resources/tmux.conf new-session -d -s s1',
  '  401   400   0.0    300 14-04:09:08 cat -v',
  '  500     1   0.0    400 01:00 tmux -L mine -f /Users/me/.tmux.conf new-session -d -s work',
  '  600     1  50.0 900000 01:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].join('\n')

const ctx: Context = {
  appPid: 100,
  socket: 'decision-ide',
  panes: [{ name: 'aaa', pid: 201 }, { name: 'bbb', pid: 210 }],
  terminals: [{ pid: 302, session: null, command: '/bin/zsh', args: ['-l'] }],
  session: (id) => (id === 'aaa' ? { title: 'Perf work', live: true } : id === 'bbb' ? { title: 'Old one', live: false } : null)
}

describe('process list', () => {
  it('reads ps rows, commands with spaces kept whole', () => {
    const rows = parsePs(PS)
    expect(rows).toHaveLength(14)
    expect(rows[0]).toEqual({ pid: 100, ppid: 1, cpu: 10, rss: 200000, etime: '02-22:05:41', command: '/Applications/Signoff AI.app/Contents/MacOS/Signoff AI' })
  })

  it('says elapsed time and commands in short words', () => {
    expect([since('02-22:05:41'), since('04:41:00'), since('1:02:03'), since('14:23'), since('00:09')]).toEqual(['2d 22h', '4h 41m', '1h 2m', '14m', '9s'])
    expect([shortCommand('/usr/bin/git status --porcelain'), shortCommand('/bin/zsh -l'), shortCommand('gh pr view 12')]).toEqual(['git status', 'zsh', 'gh pr'])
  })

  it('groups processes: sessions with their tools and view, leftovers stoppable, others not listed', () => {
    const procs = classify(parsePs(PS), ctx)
    expect(procs.map((p) => [p.kind, p.name, p.count, p.cpu, p.stop ?? null])).toEqual([
      ['leftover', 'Old one', 1, 1, { session: 'bbb' }],
      ['leftover', 'tmux server dbg84711', 2, 0, { server: 'dbg84711' }],
      ['session', 'Perf work', 3, 5, null],
      ['terminal', 'zsh', 1, 0.1, null],
      ['tool', 'git status', 1, 0.2, null],
      ['app', 'Signoff AI', 1, 10, null],
      ['app', 'Window', 1, 4, null],
      ['app', 'Graphics', 1, 1, null],
      ['app', 'tmux', 1, 0.5, null]
    ])
    const s = procs.find((p) => p.kind === 'session')!
    expect([s.session, s.memMB, s.detail]).toEqual(['aaa', Math.round(110000 / 1024) + 1, 'Claude session · 1 more below it'])
  })

  it('matches a stop only against the same target', () => {
    expect(sameStop({ server: 'a' }, { server: 'a' })).toBe(true)
    expect(sameStop({ server: 'a' }, { session: 'a' })).toBe(false)
    expect(sameStop(undefined, { session: 'a' })).toBe(false)
  })
})
