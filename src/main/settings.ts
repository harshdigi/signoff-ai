// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'

// App settings the user changes in the Settings dialog. Stored as one JSON row in `settings`.
// Every field has a stated default, used until the user saves a value.
export type Settings = {
  profile: 'developer' | 'product'   // default developer: the app shows code-level decisions and diffs
  preferences: string                // default empty: no extra instructions
  autoHandoff: boolean               // default true: a full chat continues in a fresh one by itself
  handoffAt: number                  // default 75: percent of the context window that triggers it
  branching: 'main' | 'stacked'      // default main: every subtask branches from the base branch
  branchTemplate: string             // default {KEY}-{slug}: KEY is the subtask's Jira key, else the ticket's
  flowDocs: string                   // default empty: no flow docs folder, so flow features stay off
  nearbySkills: boolean              // default true: add skills from parent and child folders with --add-dir
  pins: Pin[]                        // default none: skills pinned to the top bar
  onOpen: string | null              // default null: nothing runs when the app opens; else a pinned skill's key
  askTicket: boolean                 // default true: with no ticket, Claude first asks whether to create one
  maxChildren: number                // default 3: most child sessions one parent may run at once (IDE/D22)
  docsOffered: string[]              // folders already offered "Generate flow docs" (asked once per folder)
}

// A skill on the top bar. key = catalog kind:name; label = what the button says (e.g. "Start my day").
export type Pin = { key: string; label: string }

export const DEFAULTS: Settings = { profile: 'developer', preferences: '', autoHandoff: true, handoffAt: 75, branching: 'main', branchTemplate: '{KEY}-{slug}', flowDocs: '', nearbySkills: true, pins: [], onOpen: null, askTicket: true, maxChildren: 3, docsOffered: [] }
const KEY = 'app'

export function getSettings(db: Store): Settings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) }
}

export function saveSettings(db: Store, patch: Partial<Settings>): Settings {
  if (patch.profile && !['developer', 'product'].includes(patch.profile)) throw new Error(`bad profile ${patch.profile}`)
  if (patch.branching && !['main', 'stacked'].includes(patch.branching)) throw new Error(`bad branching ${patch.branching}`)
  if (patch.branchTemplate !== undefined && !patch.branchTemplate.includes('{slug}') && !patch.branchTemplate.includes('{n}')) throw new Error('the branch template needs {slug} or {n} so branches differ')
  if (patch.pins && !patch.pins.every((p) => /^(skill|command|agent):\S+$/.test(p.key) && p.label.trim())) throw new Error('each pin needs a skill and a label')
  const pins = patch.pins ?? getSettings(db).pins
  if (patch.onOpen && !pins.some((p) => p.key === patch.onOpen)) throw new Error('only a pinned skill can run when the app opens')
  if (patch.handoffAt !== undefined && !(patch.handoffAt >= 40 && patch.handoffAt <= 95)) throw new Error('handoff point must be between 40 and 95 percent')
  if (patch.maxChildren !== undefined && !(Number.isInteger(patch.maxChildren) && patch.maxChildren >= 1 && patch.maxChildren <= 10)) throw new Error('child sessions per parent must be 1 to 10')
  const next = { ...getSettings(db), ...patch }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next))
  return next
}
