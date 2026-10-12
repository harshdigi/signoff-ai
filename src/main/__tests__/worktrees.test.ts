// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { baseBranch, parseNameStatus, review, setFileDiff } from '../workspace'

const repo = (): { root: string; g: (cwd: string, ...a: string[]) => string } => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-')))
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' })
  g(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.rb'), 'one\n')
  g(root, 'add', '.')
  g(root, 'commit', '-qm', 'init')
  return { root, g }
}

describe('worktree-aware review', () => {
  it('parses name-status -z, including renames', () => {
    expect(parseNameStatus('M\0a.rb\0R100\0old.rb\0new.rb\0D\0gone.rb\0')).toEqual([
      { path: 'a.rb', status: 'modified' }, { path: 'new.rb', status: 'renamed', from: 'old.rb' }, { path: 'gone.rb', status: 'deleted' }
    ])
  })

  it('shows every worktree with its branch work against the base: commits, uncommitted and untracked', async () => {
    const { root, g } = repo()
    const wt = join(root, '.claude/worktrees/abc-1')
    g(root, 'worktree', 'add', '-q', '-b', 'abc-1', wt, 'main')
    writeFileSync(join(wt, 'b.rb'), 'committed on branch\n')
    g(wt, 'add', '.')
    g(wt, 'commit', '-qm', 'b')
    writeFileSync(join(wt, 'a.rb'), 'edited\n')
    writeFileSync(join(wt, 'c.rb'), 'untracked\n')
    writeFileSync(join(root, 'a.rb'), 'main edit\n')

    const r = await review(root, 'branch')
    expect(r.git).toBe(true)
    expect(r.groups.map((x) => [x.branch, x.main, x.base, x.files.map((f) => `${f.status} ${f.path}`)])).toEqual([
      ['main', true, null, ['modified a.rb']],
      ['abc-1', false, 'main', ['modified a.rb', 'added b.rb', 'untracked c.rb']]
    ])
    const branch = r.groups[1]
    expect(setFileDiff(branch, branch.files[1])).toMatchObject({ original: '', modified: 'committed on branch\n' })
    expect(setFileDiff(branch, branch.files[0])).toMatchObject({ original: 'one\n', modified: 'edited\n' })

    const unc = (await review(root, 'uncommitted')).groups[1]
    expect([unc.base, unc.files.map((f) => f.path)]).toEqual([null, ['a.rb', 'c.rb']])
  })

  it('a stacked branch is diffed against its parent branch when the session says so', async () => {
    const { root, g } = repo()
    const p = join(root, '.claude/worktrees/p1')
    g(root, 'worktree', 'add', '-q', '-b', 'abc-1-part1', p, 'main')
    writeFileSync(join(p, 'one.rb'), '1\n')
    g(p, 'add', '.')
    g(p, 'commit', '-qm', 'p1')
    const s = join(root, '.claude/worktrees/p2')
    g(root, 'worktree', 'add', '-q', '-b', 'abc-1-part2', s, 'abc-1-part1')
    writeFileSync(join(s, 'two.rb'), '2\n')
    g(s, 'add', '.')
    g(s, 'commit', '-qm', 'p2')
    expect(await baseBranch(s, 'abc-1-part1')).toBe('abc-1-part1')
    expect(await baseBranch(s, 'no-such-branch')).toBe('main')
    const stacked = (await review(root, 'branch', (r) => (r === s ? 'abc-1-part1' : null))).groups.find((x) => x.root === s)!
    expect([stacked.base, stacked.files.map((f) => f.path)]).toEqual(['abc-1-part1', ['two.rb']])
    const plain = (await review(root, 'branch')).groups.find((x) => x.root === s)!
    expect(plain.files.map((f) => f.path)).toEqual(['one.rb', 'two.rb'])
  })

  it('outside git there is nothing to review', async () => {
    expect(await review(mkdtempSync(join(tmpdir(), 'nogit-')), 'branch')).toEqual({ git: false, groups: [] })
  })
})
