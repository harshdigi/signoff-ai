// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { bloated, idleVerdict, runningShells, type IdleFacts } from '../idle'
import { parsePs, withFootprint } from '../processes'

const shell = (cmd: string): string => `/bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB && eval '${cmd}' < /dev/null && pwd -P >| /tmp/claude-a-cwd`

describe('runningShells', () => {
  const rows = parsePs([
    `  907 100 0.0 2000 01:00 ${shell('signoff wait --ticket X --id D4')}`,
    `  908 100 0.0 2000 01:00 ${shell('decide wait --review R-3')}`,
    `  909 100 0.0 2000 01:00 ${shell('npm test')}`,
    `  910 100 0.0 2000 01:00 /bin/zsh -c something without eval`,
    `  911 100 0.0 9000 01:00 funes mcp`,
    `  912 100 0.0 9000 01:00 tsh mcp db start teleport://x`,
    `  913 200 0.0 2000 01:00 ${shell('npm run build')}`
  ].join('\n'))

  it('counts shell commands, not board waits or MCP servers; an unreadable shell counts', () => {
    expect(runningShells(rows, 100)).toBe(2)
  })

  it('only the children of that Claude', () => {
    expect(runningShells(rows, 200)).toBe(1)
    expect(runningShells(rows, 300)).toBe(0)
  })
})

describe('idleVerdict', () => {
  const now = 10_000_000
  const idle: IdleFacts = { owned: true, busy: false, queued: 0, menu: false, shown: false, shells: 0, lastActive: now - 21 * 60_000, bloated: false }

  it('suspends an app session idle past the window', () => {
    expect(idleVerdict(idle, now, 20)).toEqual({ suspend: true })
  })

  it('keeps it, saying why, for each guard', () => {
    const why = (f: Partial<IdleFacts>, minutes = 20): unknown => idleVerdict({ ...idle, ...f }, now, minutes)
    expect([
      why({}, 0),
      why({ owned: false }),
      why({ busy: true }),
      why({ queued: 1 }),
      why({ menu: true }),
      why({ shown: true }),
      why({ shells: 1 }),
      why({ lastActive: now - 19 * 60_000 })
    ]).toEqual([
      { suspend: false, why: 'suspending is off' },
      { suspend: false, why: 'started in a Terminal window' },
      { suspend: false, why: 'a turn is running' },
      { suspend: false, why: 'a message is waiting to be typed in' },
      { suspend: false, why: 'its terminal shows a question' },
      { suspend: false, why: 'open on screen' },
      { suspend: false, why: 'a shell command is running' },
      { suspend: false, why: 'active recently' }
    ])
  })

  it('a session with a bloated tool is suspended after 5 min, not 20 (D7)', () => {
    const six = { ...idle, lastActive: now - 6 * 60_000 }
    expect([idleVerdict(six, now, 20), idleVerdict({ ...six, bloated: true }, now, 20), idleVerdict({ ...idle, lastActive: now - 4 * 60_000, bloated: true }, now, 20)])
      .toEqual([{ suspend: false, why: 'active recently' }, { suspend: true }, { suspend: false, why: 'active recently' }])
    expect(idleVerdict({ ...idle, lastActive: now - 3 * 60_000, bloated: true }, now, 2)).toEqual({ suspend: true })
  })
})

describe('bloated', () => {
  const rows = parsePs([
    '  100     1 0.0 300000 01:00 claude --plugin-dir x',
    '  101   100 0.0   8000 01:00 funes mcp',
    '  102   100 0.0  20000 01:00 /bin/zsh -c x',
    '  103   102 0.0   9000 01:00 node child.js',
    '  200     1 0.0 300000 01:00 claude --plugin-dir y',
    '  201   200 0.0   8000 01:00 funes mcp'
  ].join('\n'))

  it('looks at footprints of the tools below Claude, at any depth; Claude itself does not count', () => {
    expect([bloated(rows, 100), bloated(rows, 200)]).toEqual([false, false])
    const big = withFootprint(rows, new Map([[101, 2353 * 1024], [100, 4 * 1024 * 1024]]))
    expect([bloated(big, 100), bloated(big, 200)]).toEqual([true, false])
    expect(bloated(withFootprint(rows, new Map([[103, 1024 * 1024]])), 100)).toBe(true)
  })
})
