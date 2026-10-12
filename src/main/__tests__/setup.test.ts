// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureInstallDirOnPath, gitInstall, installCommand, parseAuth } from '../setup'

const env = { HOME: process.env.HOME, PATH: process.env.PATH }
afterEach(() => {
  process.env.HOME = env.HOME
  process.env.PATH = env.PATH
})

describe('setup', () => {
  it('reads claude auth status without keeping the email or org', () => {
    const out = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.com', orgId: 'x', subscriptionType: 'team' })
    const r = parseAuth(out, 0)
    expect(r).toEqual({ ok: true, method: 'claude.ai', plan: 'team', detail: 'Signed in with claude.ai (team plan)' })
    expect(JSON.stringify(r)).not.toContain('example.com')
    expect(parseAuth(JSON.stringify({ loggedIn: false, authMethod: 'none' }), 1)).toEqual({ ok: false, method: 'none', plan: null, detail: 'Not signed in' })
    expect(parseAuth('not json', 0).ok).toBe(true)
    expect(parseAuth('', 1).ok).toBe(false)
  })

  it("uses Anthropic's documented installer commands", () => {
    expect(installCommand('darwin').command).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    expect(installCommand('linux').args).toEqual(['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'])
    expect(installCommand('win32')).toEqual({ shell: 'powershell.exe', args: ['-NoProfile', '-Command', 'irm https://claude.ai/install.ps1 | iex'], command: 'irm https://claude.ai/install.ps1 | iex' })
    expect(gitInstall('darwin').command).toBe('xcode-select --install')
    expect(gitInstall('linux')).toEqual({ command: null, url: 'https://git-scm.com/downloads' })
  })

  it('adds ~/.local/bin to PATH only when claude is there and PATH lacks it', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    process.env.HOME = home
    process.env.PATH = '/usr/bin'
    expect(ensureInstallDirOnPath()).toBe(false)
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    writeFileSync(join(home, '.local/bin/claude'), '#!/bin/sh\n')
    chmodSync(join(home, '.local/bin/claude'), 0o755)
    expect(ensureInstallDirOnPath()).toBe(true)
    expect(process.env.PATH).toBe(`${join(home, '.local/bin')}:/usr/bin`)
    expect(ensureInstallDirOnPath()).toBe(false)
  })
})
