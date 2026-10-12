// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { protocolLaunch } from '../protocol'
import { DEFAULTS } from '../settings'

const resources = join(__dirname, '../../../resources')
const read = (p: string): string => readFileSync(join(resources, p), 'utf8')

describe('protocolLaunch', () => {
  it('loads the bundled plugin, the protocol and the developer profile, and points decide at the app store', () => {
    const l = protocolLaunch({ resources, cli: '/app/decide.cjs', db: '/data/board.db', node: '/app/node', settings: DEFAULTS })
    expect(l).toEqual({
      args: ['--plugin-dir', join(resources, 'decision-protocol'), '--append-system-prompt', [read('protocol.md'), read('profiles/developer.md'), read('tickets-ask.md')].join('\n')],
      env: { DECISION_IDE_DB: '/data/board.db', DECISION_IDE_CLI: '/app/decide.cjs', DECISION_IDE_NODE: '/app/node', DECISION_IDE_APP: '1' }
    })
    expect(existsSync(join(resources, 'decision-protocol/.claude-plugin/plugin.json'))).toBe(true)
  })

  it('switches to the no-context profile and appends the user preferences', () => {
    const l = protocolLaunch({ resources, cli: 'c', db: 'd', node: 'n', settings: { ...DEFAULTS, profile: 'product', preferences: ' Short sentences. ' } })
    expect(l.args[3]).toBe([read('protocol.md'), read('profiles/product.md'), read('tickets-ask.md'), "## The user's preferences\nShort sentences.\n"].join('\n'))
    expect(protocolLaunch({ resources, cli: 'c', db: 'd', node: 'n', settings: { ...DEFAULTS, askTicket: false } }).args[3]).not.toContain('## Tickets')
  })
})
