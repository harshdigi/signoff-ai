// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'
import { addEvent, getMonitor, getSetup, monitorEvents, setStage, type Monitor } from '../shared/monitors'
import type { Setup } from './monitor-setup'

// Fire fighting (SIGNOFF-23 step 7, D4 "prepare, do not ship"): an incident on a monitor starts one Claude session, a
// child of the session that owns the monitor, with the evidence. It investigates, prepares a revert branch and a fix
// branch in its own worktree, and posts the cause and both plans on the board. Pushing, merging, deploying and rolling
// back stay with you, each as an approval card.
export type Chats = { create: (cwd: string, o: { ticket?: string | null; title?: string; parent?: string }) => string; send: (session: string, text: string) => void }

export function firefightBrief(m: Monitor, what: string, events: { at: string; kind: string; text: string }[], setup: Setup | null): string {
  const merge = m.merge_sha ? m.merge_sha.slice(0, 12) : 'unknown'
  const wt = `../${m.repo.split('/')[1]}-firefight-${m.id}`
  return [
    `Production incident on ${m.repo}#${m.pr}${m.ticket ? ` (${m.ticket})` : ''}, found by monitor ${m.id}: ${what}`,
    `Merged as ${merge}; deployed at ${m.deployed_at ?? 'not yet'}.`,
    '',
    'What the monitor saw:',
    ...events.slice(-8).map((e) => `- ${e.at} ${e.kind}: ${e.text}`),
    '',
    setup ? `Deploy: ${setup.found.deploy.workflow ?? 'unknown'}; ${setup.found.deploy.trigger}` : 'Deploy: no setup recorded for this repo.',
    setup?.found.errors.length ? `Error tools: ${setup.found.errors.map((e) => `${e.app} (${e.services.join(', ')})`).join('; ')}` : '',
    '',
    'Your job, in this order:',
    '1. Find the cause: the failing run logs (gh run view --log-failed), the error tool, and the PR diff (gh pr diff).',
    `2. In a new worktree (git worktree add ${wt} origin/main), prepare two branches without pushing them:`,
    `   - revert-${m.pr}: git revert -m 1 ${merge}`,
    `   - fix-${m.pr}: the smallest fix for the cause, with a spec that fails before it.`,
    '3. Post on the board: the cause with evidence, a rollback plan (the revert PR, or the deploy workflow\'s rollback path if it has one), and a fix plan.',
    '4. Post each next step (push, open the revert or fix PR, deploy, roll back) as a consent action and wait.',
    '',
    'Never push, merge, deploy or roll back without the user\'s approval. Production data: read-only queries only, LIMIT 100, and no customer data in any message.'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}

// Starts the fire-fighting session once per monitor; a second incident on the same monitor goes to the same session.
export function startFirefight(db: Store, chats: Chats, m: Monitor, what: string): string | null {
  const fresh = getMonitor(db, m.id)
  if (fresh.firefight_session) {
    chats.send(fresh.firefight_session, `Monitor ${m.id} saw another problem: ${what}`)
    return fresh.firefight_session
  }
  const cwd = (db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(m.session_id) as { cwd: string | null } | undefined)?.cwd
  if (!cwd) {
    addEvent(db, m.id, 'error', 'Could not start fire fighting: the monitor\'s session has no folder')
    return null
  }
  const id = chats.create(cwd, { ticket: m.ticket ?? `INCIDENT-${m.id}`, title: `Fire fighting: ${m.repo.split('/')[1]}#${m.pr}`, parent: m.session_id ?? undefined })
  setStage(db, m.id, 'incident', `Fire fighting started (session ${id.slice(0, 8)})`, { firefight_session: id })
  chats.send(id, firefightBrief(fresh, what, monitorEvents(db, m.id), getSetup<Setup>(db, m.repo)))
  return id
}
