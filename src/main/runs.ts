// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'
import type { Custom, TaskGroup } from './tasks'

// Run commands Claude (or you) added for a repo, when the folder's own files do not say how to run something.
// Stored in the app (settings key 'runs'), never written into the repo.
const KEY = 'runs'
const GROUPS: TaskGroup[] = ['launch', 'console', 'test', 'seed', 'other']
type All = Record<string, Custom[]>

const all = (db: Store): All => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as All) : {}
}
const save = (db: Store, a: All): void => void db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(a))

export const customRuns = (db: Store, root: string): Custom[] => all(db)[root] ?? []

export function addRun(db: Store, root: string, c: Custom): Custom[] {
  if (!c.label.trim() || !c.command.trim()) throw new Error('a run command needs a label and a command')
  if (!GROUPS.includes(c.group)) throw new Error(`group is one of ${GROUPS.join(', ')}`)
  const a = all(db)
  a[root] = [...(a[root] ?? []).filter((x) => x.label !== c.label.trim()), { label: c.label.trim(), command: c.command.trim(), group: c.group }]
  save(db, a)
  return a[root]
}

export function removeRun(db: Store, root: string, label: string): void {
  const a = all(db)
  a[root] = (a[root] ?? []).filter((x) => x.label !== label)
  save(db, a)
}
