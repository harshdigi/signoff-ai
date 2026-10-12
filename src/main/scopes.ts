// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import type { Store } from './store'
import { baseBranch, changeSetAt, listWorktrees, parseNameStatus, reposOf, tryGit, type Change, type ChangeSet } from './workspace'

// Review scopes (Files changed): which changes to look at, and how far review has got.
// - ticket: everything on the branch against its base; session: only the files this session edited (on the branch);
//   today: since the last commit before midnight; commit: one commit; uncommitted: not committed yet.
// - The repos are the ones the session's files live in (the open folder may be a folder of repos); with no session,
//   the open folder's own repo.
export type Scope = 'ticket' | 'session' | 'today' | 'commit' | 'uncommitted'
export const SCOPES: Scope[] = ['ticket', 'session', 'today', 'commit', 'uncommitted']
export type Commit = { id: string; root: string; sha: string; subject: string; at: string }
export type Reviewed = 'done' | 'changed' | null
export type ScopedSet = Omit<ChangeSet, 'files'> & { files: (Change & { reviewed: Reviewed })[] }
export type Scoped = { scope: Scope; groups: ScopedSet[]; outside: string[]; commits: Commit[]; commit: string | null }  // commit: the one shown (Commit scope)

// Async: these run in the main process, which must never block (the window would stall).
const git = (root: string, args: string[], input?: string): Promise<string> => new Promise((resolve, reject) => {
  const p = execFile('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out)))
  if (input !== undefined) p.stdin?.end(input)
})
const midnight = (): string => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// The branch's commits since its base, newest first (for the Commit picker).
async function commitsOf(root: string, base: string | null): Promise<Commit[]> {
  const range = base ? [`${base}..HEAD`] : ['-n', '30', 'HEAD']
  const out = (await tryGit(root, ['log', '--format=%H%x09%cI%x09%s', ...range])) ?? ''
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, at, ...subject] = l.split('\t')
    return { id: `${root}::${sha}`, root, sha, at, subject: subject.join('\t') }
  })
}

// What each file's content is now (or at the commit), as git blob hashes; compared with what was marked reviewed.
async function withReviewed(db: Store, set: ChangeSet): Promise<ScopedSet> {
  const live = set.files.filter((f) => f.status !== 'deleted')
  const hashes = new Map<string, string>()
  if (live.length) {
    const out = set.to
      ? await git(set.root, ['rev-parse', ...live.map((f) => `${set.to}:${f.path}`)])
      : await git(set.root, ['hash-object', '--stdin-paths'], live.map((f) => f.path).join('\n') + '\n')
    out.trim().split('\n').forEach((h, i) => hashes.set(live[i].path, h))
  }
  const marks = new Map((db.prepare('SELECT path, hash FROM reviewed WHERE root = ?').all(set.root) as { path: string; hash: string }[]).map((r) => [r.path, r.hash]))
  return {
    ...set,
    files: set.files.map((f) => {
      const mark = marks.get(f.path)
      return { ...f, reviewed: !mark ? null : mark === (hashes.get(f.path) ?? 'deleted') ? 'done' : 'changed' }
    })
  }
}

// own: the repo or worktree the session runs in, and whether that worktree is the session's alone (a team member or
// subtask session). Its repo is always looked at, even when the transcript shows no edits (changes made through Bash
// or scripts leave no Edit call); in its own worktree, everything on the branch is the session's work.
export async function scoped(db: Store, o: { folder: string; sessionFiles: string[] | null; scope: Scope; commit?: string | null; sessionBase: (root: string) => string | null; own?: { root: string; whole: boolean } | null }): Promise<Scoped> {
  const { byRoot, outside } = o.sessionFiles ? await reposOf(o.sessionFiles) : { byRoot: new Map<string, Set<string>>(), outside: [] }
  if (o.own && !byRoot.has(o.own.root)) byRoot.set(o.own.root, new Set())
  if (!o.sessionFiles && !o.own) {
    const main = (await listWorktrees(o.folder))[0]
    if (main) byRoot.set(main.path, new Set())
  }
  const groups: ScopedSet[] = []
  const commits: Commit[] = []
  let shown: string | null = null
  for (const [root, rels] of byRoot) {
    const head = await tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = head === 'HEAD' ? null : head
    // The branch's base, worked out once: ticket, session and today all start from it.
    const base = await baseBranch(root, o.sessionBase(root))
    const onBase = !!base && !!branch && (base === branch || base.endsWith('/' + branch))
    const mergeBase = base && !onBase ? await tryGit(root, ['merge-base', base, 'HEAD']) : null
    const onBranch = async (): Promise<ChangeSet> => ({ ...(await changeSetAt(root, branch, mergeBase ?? 'HEAD')), base: mergeBase ? base : null })
    let set: ChangeSet | null = null
    if (o.scope === 'ticket') set = await onBranch()
    else if (o.scope === 'session') {
      const all = await onBranch()
      set = o.own?.whole && root === o.own.root ? all : { ...all, files: all.files.filter((f) => rels.has(f.path)) }
    } else if (o.scope === 'uncommitted') set = await changeSetAt(root, branch, 'HEAD')
    else if (o.scope === 'today') {
      // This branch's own work since today began: from its last commit made before midnight, or (no such commit)
      // from where it left its base. Commits that came in from the base branch are not counted.
      const ownBefore = await tryGit(root, ['rev-list', '-1', `--before=${midnight()}`, ...(mergeBase ? [`${mergeBase}..HEAD`] : ['HEAD'])])
      set = await changeSetAt(root, branch, ownBefore || mergeBase || 'HEAD')
    } else if (o.scope === 'commit') {
      // Commits are listed only here; with none picked yet, the newest is shown.
      const list = await commitsOf(root, mergeBase)
      commits.push(...list)
      const id = o.commit?.startsWith(root + '::') ? o.commit : !o.commit && !shown ? list[0]?.id : undefined
      if (id) {
        shown = id
        const sha = id.slice(root.length + 2)
        const files = parseNameStatus(await git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-z', '--root', sha]))
        const parent = (await tryGit(root, ['rev-parse', '--verify', '--quiet', `${sha}^`])) ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // git's empty tree, for a first commit
        set = { root, branch, base: null, ref: parent, to: sha, main: false, files: files.sort((a, b) => a.path.localeCompare(b.path)) }
      }
    }
    if (set && set.files.length) groups.push(await withReviewed(db, set))
  }
  return { scope: o.scope, groups, outside: o.scope === 'session' ? outside : [], commits: commits.sort((a, b) => b.at.localeCompare(a.at)), commit: o.scope === 'commit' ? o.commit ?? shown : null }
}

// Mark (or unmark) one file reviewed, as it is now in that change set.
export async function markReviewed(db: Store, set: ChangeSet, change: Change, on: boolean): Promise<void> {
  const path = change.path
  if (!on) return void db.prepare('DELETE FROM reviewed WHERE root = ? AND path = ?').run(set.root, path)
  const hash = change.status === 'deleted' ? 'deleted'
    : set.to ? (await git(set.root, ['rev-parse', `${set.to}:${path}`])).trim() : (await git(set.root, ['hash-object', '--stdin-paths'], path + '\n')).trim()
  db.prepare('INSERT INTO reviewed (root, path, hash, at) VALUES (?, ?, ?, ?) ON CONFLICT(root, path) DO UPDATE SET hash = excluded.hash, at = excluded.at')
    .run(set.root, path, hash, new Date().toISOString())
}
