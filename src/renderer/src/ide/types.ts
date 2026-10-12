// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Mirrors the main-process shapes (workspace.ts, tasks.ts, catalog.ts, chat.ts).
export type Workspace = { current: string | null; recent: string[]; trusted: string[] }
export type Change = { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'; from?: string }
export type DiffMode = 'branch' | 'uncommitted'
export type ChangeSet = { root: string; branch: string | null; base: string | null; ref: string; main: boolean; files: Change[]; to?: string }  // to: one commit's changes
export type Changes = { git: boolean; groups: ChangeSet[] }
// Review (scopes.ts): whose changes, which scope, and for 'commit' which one ("<root>::<sha>").
export type Scope = 'ticket' | 'session' | 'today' | 'commit' | 'uncommitted'
export type ReviewView = { session: string | null; scope: Scope; commit?: string | null }
export type ScopedFile = Change & { reviewed: 'done' | 'changed' | null }
export type ScopedSet = Omit<ChangeSet, 'files'> & { files: ScopedFile[]; to?: string }
export type Commit = { id: string; root: string; sha: string; subject: string; at: string }
export type Scoped = { scope: Scope; groups: ScopedSet[]; outside: string[]; commits: Commit[]; commit: string | null }
export type FileDiff = { path: string; original: string; modified: string; binary: boolean; tooLarge: boolean }
export type Task = { id: string; label: string; command: string; group: 'launch' | 'console' | 'test' | 'seed' | 'other'; source: string; root: string; repo: string }
export type TaskList = { tasks: Task[]; problems: string[] }
export type CatalogItem = {
  kind: 'skill' | 'agent' | 'command'; name: string; description: string; source: string; invoke: string
  role?: 'start-ticket' | 'review' | 'create-pr' | 'docs' | 'describe-ticket'
}
export const itemKey = (c: { kind: string; name: string }): string => `${c.kind}:${c.name}`
export type Pin = { key: string; label: string }
// workflows.ts; line: the team in one line, e.g. "1 implementer + 1 reviewer".
export type Role = { role: string; count: number | null; does: string }
export type Workflow = { id: string; name: string; description: string; team: Role[]; goodFor: string[]; notFor: string[]; builtIn: boolean; line: string }
export type ChatStatus = { session: string; running: boolean; busy: boolean }
export type Term = { id: string; title: string; exited: boolean; session: string | null }  // session: the Claude session in it, if any

// Editor tabs in the middle area. Decisions and Session are always there; Session shows the selected session.
export type EditorTab =
  | { kind: 'decisions' }
  | { kind: 'session' }
  | { kind: 'review'; id: string }
  | { kind: 'ticket'; id: string }
  | { kind: 'doc'; id: string }
  | { kind: 'diff'; root: string; path: string; view?: ReviewView }  // view: the review list it was opened from
  | { kind: 'file'; root: string; path: string; line?: number }  // a file opened from Search, read-only

export const tabKey = (t: EditorTab): string => (t.kind === 'decisions' || t.kind === 'session' ? t.kind : t.kind === 'diff' || t.kind === 'file' ? `${t.kind}:${t.root}::${t.path}` : `${t.kind}:${t.id}`)
export const base = (p: string): string => p.split('/').pop() || p
export const dir = (p: string): string => p.split('/').slice(0, -1).join('/')

// Errors from ipcRenderer.invoke carry a wrapper prefix; keep only the message.
export const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
