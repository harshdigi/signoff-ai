// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ensureUtf8Locale } from '../shell-env'
import { addWorktree } from '../workspace'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

describe('worktrees and locale', () => {
  it('reuses a worktree an earlier failed start left on the same branch; refuses any other folder', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-')))
    git(root, 'init', '-q', '-b', 'main')
    writeFileSync(join(root, 'a.txt'), 'a')
    git(root, 'add', '.')
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one')
    const path = await addWorktree(root, 'KA-1-api', 'main')
    expect(path).toBe(join(root, '.claude', 'worktrees', 'KA-1-api'))
    expect(await addWorktree(root, 'KA-1-api', 'main')).toBe(path)
    mkdirSync(join(root, '.claude', 'worktrees', 'KA-1-web'))
    await expect(addWorktree(root, 'KA-1-web', 'main')).rejects.toThrow(`${join(root, '.claude', 'worktrees', 'KA-1-web')} already exists`)
  })

  it('sets a UTF-8 locale only when none is set', () => {
    const bare: NodeJS.ProcessEnv = {}
    ensureUtf8Locale(bare)
    expect(bare.LANG).toBe('en_US.UTF-8')
    const mine: NodeJS.ProcessEnv = { LC_ALL: 'de_DE.UTF-8' }
    ensureUtf8Locale(mine)
    expect(mine).toEqual({ LC_ALL: 'de_DE.UTF-8' })
  })
})
