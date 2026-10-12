// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, realpathSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import type { Store } from './store'

// The open folder (IDE/D12) and its git changes (IDE/D11).

export type Workspace = { current: string | null; recent: string[]; trusted: string[] }
export type Change = { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'; from?: string }
export type Changes = { root: string | null; git: boolean; branch: string | null; files: Change[] }
export type FileDiff = { path: string; original: string; modified: string; binary: boolean; tooLarge: boolean }

const KEY = 'workspace'
const MAX_RECENT = 10
const MAX_BYTES = 2 * 1024 * 1024

export function getWorkspace(db: Store): Workspace {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  return row ? JSON.parse(row.value) : { current: null, recent: [], trusted: [] }
}

function save(db: Store, w: Workspace): Workspace {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(w))
  return w
}

export function openFolder(db: Store, path: string): Workspace {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`not a folder: ${path}`)
  const w = getWorkspace(db)
  return save(db, { ...w, current: path, recent: [path, ...w.recent.filter((p) => p !== path)].slice(0, MAX_RECENT) })
}

export function setTrust(db: Store, path: string, trusted: boolean): Workspace {
  const w = getWorkspace(db)
  return save(db, { ...w, trusted: trusted ? [...new Set([...w.trusted, path])] : w.trusted.filter((p) => p !== path) })
}

export const isTrusted = (db: Store, path: string): boolean => getWorkspace(db).trusted.includes(path)

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

const STATUS: Record<string, Change['status']> = { M: 'modified', T: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added', U: 'conflict' }

// git status --porcelain=v1 -z: "XY path\0", renames add "\0from".
export function parseStatus(out: string): Change[] {
  const parts = out.split('\0')
  const files: Change[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    if (xy === '??') files.push({ path, status: 'untracked' })
    else if (xy.includes('U') || xy === 'AA' || xy === 'DD') files.push({ path, status: 'conflict' })
    else {
      const code = xy[0] !== ' ' ? xy[0] : xy[1]
      const c: Change = { path, status: STATUS[code] ?? 'modified' }
      if (code === 'R' || code === 'C') c.from = parts[++i]
      files.push(c)
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function changes(folder: string): Changes {
  let root: string
  try {
    root = git(folder, ['rev-parse', '--show-toplevel']).trim()
  } catch {
    return { root: folder, git: false, branch: null, files: [] }
  }
  const branch = git(root, ['branch', '--show-current']).trim() || null
  return { root, git: true, branch, files: parseStatus(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) }
}

// HEAD version against the file on disk. Missing on either side is an empty string (added or deleted file).
export const fileDiff = (root: string, change: Change): FileDiff =>
  setFileDiff({ root, branch: null, base: null, ref: 'HEAD', main: true, files: [] }, change)

// ---- worktree-aware review (IDE/D16 D) ---------------------------------------
// Every worktree of the repo, each diffed against its base branch: the branch's own commits plus uncommitted work.
// That is what parallel sessions need, and what an editor showing only the main folder cannot give.

export type DiffMode = 'branch' | 'uncommitted'
// ref: what the files are compared against. to: a commit to compare with instead of the files on disk (one commit's changes).
export type ChangeSet = { root: string; branch: string | null; base: string | null; ref: string; main: boolean; files: Change[]; to?: string }
export type Review = { git: boolean; groups: ChangeSet[] }

// Async git: the review runs in the main process, which must never block (the window would freeze).
const run = promisify(execFile)
const gitA = async (cwd: string, args: string[]): Promise<string> => (await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout
// A git command that may fail by design (no such branch, not a repo): null means "not there".
export const tryGit = async (cwd: string, args: string[]): Promise<string | null> => {
  try {
    return (await gitA(cwd, args)).trim()
  } catch {
    return null
  }
}

export async function listWorktrees(folder: string): Promise<{ path: string; branch: string | null }[]> {
  const out = await tryGit(folder, ['worktree', 'list', '--porcelain'])
  if (out === null) return []
  return out.split('\n\n').filter(Boolean).flatMap((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (!path || /^prunable/m.test(block)) return []
    return [{ path, branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null }]
  })
}

// Base branch, in this order (each step only when the previous gives nothing):
// 1. the session's own base (stacked branches, set by the ticket pipeline);
// 2. origin's default branch (origin/HEAD);
// 3. a local main, then master.
// With none of these, the worktree is shown against HEAD (uncommitted only).
export async function baseBranch(root: string, sessionBase?: string | null): Promise<string | null> {
  if (sessionBase && (await tryGit(root, ['rev-parse', '--verify', '--quiet', sessionBase]))) return sessionBase
  const remote = await tryGit(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  if (remote && remote !== 'origin/HEAD') return remote
  for (const b of ['main', 'master']) if (await tryGit(root, ['rev-parse', '--verify', '--quiet', b])) return b
  return null
}

// A branch and its worktree under <repo>/.claude/worktrees (ticket subtasks, team implementers).
// An existing branch is checked out as is; a new one is cut from base.
// - A worktree already registered at that folder on that same branch (left by an earlier start that failed after
//   git made it) is reused. Any other existing folder is refused.
export async function addWorktree(root: string, branch: string, base: string): Promise<string> {
  const path = join(root, '.claude', 'worktrees', branch.replace(/\//g, '-'))
  if (existsSync(path)) {
    const list = (await tryGit(root, ['worktree', 'list', '--porcelain'])) ?? ''
    const mine = list.split('\n\n').some((w) => w.split('\n').includes(`worktree ${realpathSync(path)}`) && w.split('\n').includes(`branch refs/heads/${branch}`))
    if (mine) return path
    throw new Error(`${path} already exists`)
  }
  if (await tryGit(root, ['rev-parse', '--verify', '--quiet', branch])) await gitA(root, ['worktree', 'add', path, branch])
  else await gitA(root, ['worktree', 'add', '-b', branch, path, base])
  return path
}

// git diff --name-status -z: "M\0path\0", renames "R100\0old\0new\0".
export function parseNameStatus(out: string): Change[] {
  const p = out.split('\0')
  const files: Change[] = []
  for (let i = 0; i < p.length - 1; ) {
    const code = p[i++]
    if (!code) continue
    if (code[0] === 'R' || code[0] === 'C') {
      const from = p[i++]
      files.push({ path: p[i++], status: code[0] === 'R' ? 'renamed' : 'added', from })
    } else files.push({ path: p[i++], status: STATUS[code[0]] ?? 'modified' })
  }
  return files
}

export async function changeSet(root: string, branch: string | null, main: boolean, mode: DiffMode, sessionBase?: string | null): Promise<ChangeSet> {
  const base = mode === 'branch' ? await baseBranch(root, sessionBase) : null
  const onBase = !!base && !!branch && (base === branch || base.endsWith('/' + branch))
  const ref = base && !onBase ? (await tryGit(root, ['merge-base', base, 'HEAD'])) ?? 'HEAD' : 'HEAD'
  return { ...(await changeSetAt(root, branch, ref, main)), base: ref === 'HEAD' ? null : base }
}

// The files changed between `ref` and the working tree (committed since ref, plus uncommitted and untracked work).
export async function changeSetAt(root: string, branch: string | null, ref: string, main = false): Promise<ChangeSet> {
  const [diffOut, statusOut] = await Promise.all([
    ref === 'HEAD' ? Promise.resolve('') : gitA(root, ['diff', '--name-status', '-z', '-M', ref]),
    gitA(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ])
  const tracked = parseNameStatus(diffOut)
  const status = parseStatus(statusOut)
  const seen = new Set(tracked.map((f) => f.path))
  const files = [...tracked, ...status.filter((f) => ref === 'HEAD' || (f.status === 'untracked' && !seen.has(f.path)))]
  return { root, branch, base: null, ref, main, files: files.sort((a, b) => a.path.localeCompare(b.path)) }
}

export async function review(folder: string, mode: DiffMode, sessionBase: (root: string) => string | null = () => null): Promise<Review> {
  const trees = await listWorktrees(folder)
  if (!trees.length) return { git: false, groups: [] }
  const groups = await Promise.all(trees.map((t, i) => changeSet(t.path, t.branch, i === 0, mode, sessionBase(t.path))))
  // Worktrees kept inside the repo (Claude Code uses .claude/worktrees/) are not changes of the main folder.
  const inOther = (g: ChangeSet, path: string): boolean =>
    trees.some((t) => t.path.startsWith(g.root + '/') && (join(g.root, path) + '/').startsWith(t.path + '/'))
  return { git: true, groups: groups.map((g) => ({ ...g, files: g.files.filter((f) => !inOther(g, f.path)) })) }
}

// One session's changes (scopes.ts) start from the repos its edited files are in.
// Which git repo each file is in: repo root -> paths inside it; files in no repo go to outside.
export async function reposOf(files: string[]): Promise<{ byRoot: Map<string, Set<string>>; outside: string[] }> {
  const byRoot = new Map<string, Set<string>>()
  const outside: string[] = []
  for (const f of files) {
    // The nearest folder that still exists (the file, or its folder, may have been deleted since).
    let dir = dirname(f)
    while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir)
    const root = await tryGit(dir, ['rev-parse', '--show-toplevel'])
    if (!root) { outside.push(f); continue }
    // git reports real paths (/private/var...), Claude Code may not (/var...).
    const rel = relative(root, join(realpathSync(dir), f.slice(dir.length)))
    if (!byRoot.has(root)) byRoot.set(root, new Set())
    byRoot.get(root)!.add(rel)
  }
  return { byRoot, outside }
}


// The diff for one file of a change set: the set's ref (merge-base or HEAD) against the file on disk.
export function setFileDiff(set: ChangeSet, change: Change): FileDiff {
  const res: FileDiff = { path: change.path, original: '', modified: '', binary: false, tooLarge: false }
  const old = change.status === 'untracked' || change.status === 'added' ? null : change.from ?? change.path
  const original = old ? showAt(set.root, set.ref, old) : Buffer.alloc(0)
  const disk = join(set.root, change.path)
  const modified = change.status === 'deleted' ? Buffer.alloc(0) : set.to ? showAt(set.root, set.to, change.path) : existsSync(disk) ? readFileSync(disk) : Buffer.alloc(0)
  if (original.length > MAX_BYTES || modified.length > MAX_BYTES) return { ...res, tooLarge: true }
  if (original.includes(0) || modified.includes(0)) return { ...res, binary: true }
  return { ...res, original: original.toString('utf8'), modified: modified.toString('utf8') }
}

function showAt(root: string, ref: string, path: string): Buffer {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return Buffer.alloc(0) // not at that ref: shown as an added file
  }
}
