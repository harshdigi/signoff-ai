// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { BoardError, now } from './board'
import type { Store } from '../main/store'

// Autonomy (SIGNOFF-24/D1): per session, a checklist of what Claude may decide on your behalf, grouped by phase.
// Modes are presets that tick the boxes; changing one box makes the mode "custom". Everything Claude decides alone is
// still recorded on the board. The locked items always ask (D2, strict floor) and can never be ticked.
export type Item = { id: string; label: string }
export type Phase = { id: string; label: string; items: Item[] }
export const PHASES: Phase[] = [
  { id: 'plan', label: 'Planning', items: [
    { id: 'plan.approach', label: 'Implementation approach' },
    { id: 'plan.naming', label: 'Naming and structure' },
    { id: 'plan.tests', label: 'Test plan cases' },
    { id: 'plan.split', label: 'Splitting the work into steps or team pieces' }
  ] },
  { id: 'impl', label: 'Implementing', items: [
    { id: 'impl.reviews', label: 'Accept its own code reviews' },
    { id: 'impl.details', label: 'Small design details inside the plan' },
    { id: 'impl.fixes', label: 'Fix failing tests and lint' },
    { id: 'impl.patterns', label: 'Choose between equivalent patterns already in the repo' },
    { id: 'impl.surprise', label: 'Record a surprise and carry on (otherwise stop and ask)' }
  ] },
  { id: 'ship', label: 'Shipping', items: [
    { id: 'ship.commit', label: 'Commit' },
    { id: 'ship.branch', label: 'Create a branch' },
    { id: 'ship.push', label: 'Push the feature branch' },
    { id: 'ship.pr', label: 'Open the pull request' },
    { id: 'ship.comments', label: 'Answer PR review comments' }
  ] },
  { id: 'after', label: 'After merge', items: [
    { id: 'after.monitor', label: 'Start the monitor' },
    { id: 'after.firefight', label: 'Prepare fire-fighting branches (pushing them still asks)' }
  ] }
]
// Always ask, whatever the mode (D2): shown greyed and locked.
export const LOCKED: Item[] = [
  { id: 'lock.deploy', label: 'Production deploys and rollbacks' },
  { id: 'lock.prodData', label: 'Anything touching production data' },
  { id: 'lock.merge', label: 'Merging pull requests' },
  { id: 'lock.main', label: 'Pushes to main, and force-pushes' },
  { id: 'lock.delete', label: 'Deleting data or branches' },
  { id: 'lock.messages', label: 'Messages to people (except a review request you ticked)' },
  { id: 'lock.money', label: 'Spending money' },
  { id: 'lock.secrets', label: 'Secrets' }
]
export const ITEMS = PHASES.flatMap((p) => p.items.map((i) => i.id))

// plan: nothing is settled by Claude until you approve its plan (Plan first, then run; step 4). It is its own switch,
// so it stays on when you change a box.
export const MODES = {
  ask: { label: 'Ask as you go', items: [] as string[], plan: false },
  planFirst: { label: 'Plan first, then run', items: [...PHASES[1].items.map((i) => i.id), 'ship.commit', 'ship.branch'], plan: true },
  full: { label: 'Full auto', items: ITEMS, plan: false }
} as const
export type Mode = keyof typeof MODES | 'custom'
export type Autonomy = { mode: Mode; items: string[]; plan: boolean }
export const ASK: Autonomy = { mode: 'ask', items: [], plan: false }
export const PLAN_ITEM = 'plan' // marks the plan's approval card; never settled by Claude

// The preset these boxes (and the plan switch) match, else custom.
export function modeOf(items: string[], plan = false): Mode {
  const s = [...new Set(items)].sort().join(',')
  for (const [k, v] of Object.entries(MODES)) if (v.plan === plan && [...v.items].sort().join(',') === s) return k as Mode
  return 'custom'
}

// Checks a choice and settles its mode: known items only, never a locked one. A mode alone means its preset.
export function normalize(a: { mode?: string; items?: string[]; plan?: boolean }): Autonomy {
  if (a.items === undefined) {
    if (!a.mode || !(a.mode in MODES)) throw new BoardError(`unknown autonomy mode ${a.mode}`)
    const m = MODES[a.mode as keyof typeof MODES]
    return { mode: a.mode as Mode, items: [...m.items], plan: m.plan }
  }
  const locked = a.items.filter((i) => i.startsWith('lock.'))
  if (locked.length) throw new BoardError(`always asks, cannot be handed to Claude: ${locked.join(', ')}`)
  const unknown = a.items.filter((i) => !ITEMS.includes(i))
  if (unknown.length) throw new BoardError(`unknown autonomy item: ${unknown.join(', ')}`)
  const items = ITEMS.filter((i) => a.items!.includes(i))
  const plan = a.plan ?? false
  return { mode: modeOf(items, plan), items, plan }
}

// A session's autonomy: its own choice, else the default from Settings (passed in), else ask everything.
export function getAutonomy(db: Store, session: string, fallback: Autonomy = ASK): Autonomy {
  const r = db.prepare('SELECT autonomy FROM sessions WHERE id = ?').get(session) as { autonomy: string | null } | undefined
  if (!r) throw new BoardError(`no session ${session}`)
  if (!r.autonomy) return fallback
  const a = JSON.parse(r.autonomy) as Autonomy
  return { ...a, plan: a.plan ?? false }
}

export function setAutonomy(db: Store, session: string, a: { mode?: string; items?: string[]; plan?: boolean }): Autonomy {
  const n = normalize(a)
  const r = db.prepare('UPDATE sessions SET autonomy = ? WHERE id = ?').run(JSON.stringify(n), session)
  if (r.changes !== 1) throw new BoardError(`no session ${session}`)
  return n
}

export const allows = (a: Autonomy, item: string): boolean => !item.startsWith('lock.') && a.items.includes(item)

// Whether this session hands an item to Claude, and the name the board records it under.
export function delegate(db: Store, session: string, item: string | undefined, fallback: Autonomy = ASK): { by: string } | { reason: string } | null {
  if (!item) return null
  if (item.startsWith('lock.')) return { reason: `${item} always asks` }
  if (!ITEMS.includes(item)) throw new BoardError(`unknown autonomy item: ${item}`)
  const a = getAutonomy(db, session, fallback)
  if (!allows(a, item)) return { reason: `${item} is not handed to Claude in this session` }
  if (a.plan && !planApproved(db, session)) return { reason: 'Plan first: the plan is not approved yet; post it with signoff plan and wait for the answer' }
  return { by: `claude (${a.mode === 'custom' ? 'Custom' : MODES[a.mode].label})` }
}

// Plan first: the user approved this session's latest plan card.
export function planApproved(db: Store, session: string): boolean {
  const r = db.prepare("SELECT status, answer FROM decisions WHERE session_id = ? AND autonomy_item = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(session, PLAN_ITEM) as { status: string; answer: string | null } | undefined
  return !!r && ['answered', 'applied'].includes(r.status) && /^approve/i.test(r.answer ?? '')
}

// A review Claude may accept itself (impl.reviews): every file accepted, recorded with who accepted it.
export function acceptByClaude(db: Store, review: string, by: string): void {
  db.transaction(() => {
    db.prepare("UPDATE review_changes SET verdict = 'accept' WHERE review_id = ? AND verdict = 'pending'").run(review)
    const t = now()
    const r = db.prepare("UPDATE reviews SET status = 'accepted', note = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'open'").run(`Accepted by ${by}`, t, t, review)
    if (r.changes !== 1) throw new BoardError(`${review} is not open`)
  })()
}

// The lines a session reads: its mode, what it may settle itself, and that everything else asks.
export function autonomyBrief(a: Autonomy): string {
  const mode = a.mode === 'custom' ? 'Custom' : MODES[a.mode].label
  if (!a.items.length) return `Autonomy: ${mode}. Nothing is handed to you: every decision and action waits for the user.`
  const plan = a.plan ? ' Plan first: ask the user everything now, then post the plan with signoff plan; until they approve it, nothing is settled by you.' : ''
  return `Autonomy: ${mode}. You may settle these yourself (name them with --item): ${a.items.join(', ')}. Everything else waits for the user.${plan}`
}
