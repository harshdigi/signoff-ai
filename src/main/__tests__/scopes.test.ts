// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { markReviewed, scoped, type Scope } from '../scopes'
import { openStore } from '../store'

const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString()
const setup = (): { repo: string; db: ReturnType<typeof openStore> } => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'scope-')))
  const repo = join(top, 'service')
  mkdirSync(repo)
  const g = (date: string | null, ...a: string[]): void => void execFileSync('git', a, {
    cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }
  })
  g(yesterday, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'base.rb'), 'x\n')
  g(yesterday, 'add', '.'); g(yesterday, 'commit', '-q', '-m', 'base')
  g(yesterday, 'checkout', '-q', '-b', 'KA-1')
  writeFileSync(join(repo, 'old.rb'), 'yesterday\n')
  g(yesterday, 'add', '.'); g(yesterday, 'commit', '-q', '-m', 'yesterday work')
  writeFileSync(join(repo, 'new.rb'), 'today\n')
  g(null, 'add', '.'); g(null, 'commit', '-q', '-m', 'today work')
  writeFileSync(join(repo, 'wip.rb'), 'not committed\n')
  return { repo, db: openStore(join(top, 'b.db')) }
}
const files = async (db: ReturnType<typeof openStore>, repo: string, scope: Scope, commit?: string): Promise<string[]> =>
  (await scoped(db, { folder: repo, sessionFiles: [join(repo, 'new.rb'), join(repo, 'wip.rb')], scope, commit, sessionBase: () => ({ base: 'main', pin: null }) })).groups.flatMap((g) => g.files.map((f) => f.path))

describe('review scopes', () => {
  it('a repo changed only through shell commands shows its whole branch in the session scope', async () => {
    const { repo, db } = setup()
    const r = await scoped(db, { folder: repo, sessionFiles: null, scope: 'session', sessionBase: () => ({ base: 'main', pin: null }), shellRoots: [realpathSync(repo)] })
    expect(r.groups.flatMap((g) => g.files.map((f) => f.path))).toEqual(['new.rb', 'old.rb', 'wip.rb'])
  })

  it('ticket: the whole branch; session: only its files; today: since yesterday; uncommitted: not committed; commit: one commit', async () => {
    const { repo, db } = setup()
    expect(await files(db, repo, 'ticket')).toEqual(['new.rb', 'old.rb', 'wip.rb'])
    expect(await files(db, repo, 'session')).toEqual(['new.rb', 'wip.rb'])
    expect(await files(db, repo, 'today')).toEqual(['new.rb', 'wip.rb'])
    expect(await files(db, repo, 'uncommitted')).toEqual(['wip.rb'])
    const s = await scoped(db, { folder: repo, sessionFiles: [join(repo, 'new.rb')], scope: 'commit', sessionBase: () => ({ base: 'main', pin: null }) })
    expect(s.commits.map((c) => c.subject)).toEqual(['today work', 'yesterday work'])
    expect(await files(db, repo, 'commit', s.commits[1].id)).toEqual(['old.rb'])
  }, 20_000) // about 1 s alone; many git runs, slower when the whole suite runs in parallel

  it('a session that edited only through Bash still shows its repo; in its own worktree the whole branch is its work', async () => {
    const { repo, db } = setup()
    const shown = async (scope: Scope, own: { root: string; whole: boolean }): Promise<string[]> =>
      (await scoped(db, { folder: join(repo, '..'), sessionFiles: null, scope, sessionBase: () => ({ base: 'main', pin: null }), own })).groups.flatMap((g) => g.files.map((f) => f.path))
    expect(await shown('ticket', { root: repo, whole: false })).toEqual(['new.rb', 'old.rb', 'wip.rb'])
    expect(await shown('session', { root: repo, whole: false })).toEqual([])
    expect(await shown('session', { root: repo, whole: true })).toEqual(['new.rb', 'old.rb', 'wip.rb'])
  }, 20_000)

  it('a reviewed file shows as done, and as changed once it is edited again', async () => {
    const { repo, db } = setup()
    const set = (await scoped(db, { folder: repo, sessionFiles: null, scope: 'ticket', sessionBase: () => ({ base: 'main', pin: null }) })).groups[0]
    await markReviewed(db, set, set.files.find((f) => f.path === 'wip.rb')!, true)
    const state = async (): Promise<unknown> => (await scoped(db, { folder: repo, sessionFiles: null, scope: 'ticket', sessionBase: () => ({ base: 'main', pin: null }) })).groups[0].files.find((f) => f.path === 'wip.rb')!.reviewed
    expect(await state()).toBe('done')
    writeFileSync(join(repo, 'wip.rb'), 'edited after review\n')
    expect(await state()).toBe('changed')
  })
})
