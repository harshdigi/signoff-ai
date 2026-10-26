// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'

// Workflows (IDE/D21): saved team setups, i.e. how a session splits its work.
// - Built-in ones always exist; yours are stored in `settings` under 'workflows'.
// - A session started with one records its id (sessions.workflow). Splitting the work into child sessions is IDE/D22.

// count: how many sessions of this role; null = the parent proposes the number once it knows the task.
// readsOnly: the role never edits code, so it works in the lead's folder with no branch or worktree (SIGNOFF-40-TEAMS/D1).
export type Role = { role: string; count: number | null; does: string; readsOnly?: boolean }

// Setups saved before readsOnly existed: a role named "reviewer" reads only, as it always did; any other edits code.
export const readsOnly = (r: Pick<Role, 'role' | 'readsOnly'>): boolean => r.readsOnly ?? r.role === 'reviewer'
// goodFor / notFor: when to pick it, shown in the Workflows tab so a setup explains itself.
export type Workflow = { id: string; name: string; description: string; team: Role[]; goodFor: string[]; notFor: string[]; builtIn: boolean }

export const BUILT_IN: Workflow[] = [
  {
    id: 'solo', name: 'Solo', description: 'One session does the whole task.', team: [], builtIn: true,
    goodFor: ['Small fixes and one-file changes', 'Questions about the code, investigations, exploring', 'Anything you would finish in about an hour'],
    notFor: ['Risky changes you want a second pair of eyes on: use Implement + review']
  },
  {
    id: 'implement-review', name: 'Implement + review', builtIn: true,
    description: 'One session builds, another reads every change and reports problems before you see it.',
    team: [
      { role: 'implementer', count: 1, does: 'Builds the change on its own branch and worktree.' },
      { role: 'reviewer', count: 1, does: 'Reads each diff from the implementers and posts findings as a review. Never edits code.', readsOnly: true }
    ],
    goodFor: ['One feature where mistakes are costly: payments, auth, data migrations, money movement', 'Changes you want checked before you spend time reviewing them'],
    notFor: ['Quick fixes: three sessions cost more than the check is worth', 'Folders that are not git repos: implementers need worktrees']
  },
  {
    id: 'parallel', name: 'Parallel build', builtIn: true,
    description: 'The parent splits the task into independent pieces; each piece gets its own implementer, one reviewer checks all.',
    team: [
      { role: 'implementer', count: null, does: 'Builds one piece on its own branch and worktree.' },
      { role: 'reviewer', count: 1, does: 'Reads each diff from the implementers and posts findings as a review. Never edits code.', readsOnly: true }
    ],
    goodFor: ['Tasks with independent parts: an API, its frontend page and the specs', 'One change repeated across several services or modules', 'Large tickets where waiting on one session is the bottleneck'],
    notFor: ['Parts that edit the same files: the merges conflict', 'Tasks whose design is not settled yet: settle it in a Solo session first', 'Folders that are not git repos: implementers need worktrees']
  }
]
const KEY = 'workflows'
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/

const mine = (db: Store): Workflow[] => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  // Setups saved before goodFor / notFor existed have neither; they show as empty lists.
  return row ? (JSON.parse(row.value) as Workflow[]).map((w) => ({ ...w, goodFor: w.goodFor ?? [], notFor: w.notFor ?? [] })) : []
}

export const listWorkflows = (db: Store): Workflow[] => [...BUILT_IN, ...mine(db)]

export function getWorkflow(db: Store, id: string): Workflow {
  const w = listWorkflows(db).find((x) => x.id === id)
  if (!w) throw new Error(`no workflow ${id}`)
  return w
}

export type WorkflowInput = Omit<Workflow, 'builtIn' | 'goodFor' | 'notFor'> & { goodFor?: string[]; notFor?: string[] }
// The rules a setup must meet, for saving it and for a session proposing one (signoff team propose).
export function checkWorkflow(w: WorkflowInput): void {
  if (!ID.test(w.id)) throw new Error('a workflow id is 2-41 lowercase letters, digits or dashes')
  if (BUILT_IN.some((b) => b.id === w.id)) throw new Error(`${w.id} is built in; save it under another name`)
  if (!w.name.trim()) throw new Error('a workflow needs a name')
  for (const r of w.team) {
    if (!r.role.trim() || !r.does.trim()) throw new Error('each role needs a name and what it does')
    if (r.count !== null && !(Number.isInteger(r.count) && r.count >= 1 && r.count <= 10)) throw new Error(`${r.role}: count is 1-10, or empty for "the parent proposes"`)
    if (r.readsOnly !== undefined && typeof r.readsOnly !== 'boolean') throw new Error(`${r.role}: readsOnly is true or false`)
  }
}

// Adds or replaces one of yours. Built-in ones cannot be changed (save a copy under a new id instead).
export function saveWorkflow(db: Store, w: WorkflowInput): Workflow {
  checkWorkflow(w)
  const lines = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => x.trim()).filter(Boolean)
  const saved: Workflow = { ...w, name: w.name.trim(), goodFor: lines(w.goodFor), notFor: lines(w.notFor), builtIn: false }
  const next = [...mine(db).filter((x) => x.id !== w.id), saved]
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next))
  return saved
}

export function deleteWorkflow(db: Store, id: string): void {
  if (BUILT_IN.some((b) => b.id === id)) throw new Error(`${id} is built in and cannot be deleted`)
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(mine(db).filter((x) => x.id !== id)))
}

// One line per role, as the session header and the parent's instructions show it.
export const teamLine = (w: Workflow): string =>
  w.team.length ? w.team.map((r) => `${r.count ?? 'N'} ${r.role}${r.count === 1 ? '' : 's'}`).join(' + ') : 'one session'
