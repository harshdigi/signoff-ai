// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { BoardError, nextId, now } from './board'
import type { Store } from '../main/store'

// Monitors (SIGNOFF-23): one watch per pull request, from CI through merge and the production deploy to a stability
// window. The app's watcher moves the stage; a failure opens a fire-fighting session.
// - Never two live monitors on the same pull request (the board refuses; a unique index backs it up).
// - A lead can watch its team's pull requests: it starts one monitor per pull request, so the rule above still holds.
export const STAGES = ['ci', 'merge', 'deploy', 'stable', 'done', 'incident', 'stopped'] as const
export type Stage = (typeof STAGES)[number]
export type Recipient = { app: string; where: string; tags: string[] }
export interface Monitor {
  id: string; session_id: string | null; repo: string; pr: number; ticket: string | null; stage: Stage
  window_minutes: number; check_minutes: number; notify: number; recipients: string | null
  merge_sha: string | null; deployed_at: string | null; firefight_session: string | null
  note: string | null; created_at: string; updated_at: string
}
const LIVE = "stage NOT IN ('done','stopped')"

const need = (cond: unknown, msg: string): void => {
  if (!cond) throw new BoardError(msg)
}

export function liveMonitor(db: Store, repo: string, pr: number): Monitor | undefined {
  return db.prepare(`SELECT * FROM monitors WHERE repo = ? AND pr = ? AND ${LIVE}`).get(repo, pr) as Monitor | undefined
}

export function startMonitor(db: Store, p: { session: string | null; repo: string; pr: number; ticket?: string | null; windowMinutes: number; checkMinutes: number; notify?: boolean; recipients?: Recipient[] }): Monitor {
  need(/^[\w.-]+\/[\w.-]+$/.test(p.repo), `repo must be owner/name: ${p.repo}`)
  need(Number.isInteger(p.pr) && p.pr > 0, `not a pull request number: ${p.pr}`)
  need(p.windowMinutes >= 5 && p.windowMinutes <= 7 * 24 * 60, 'the stability window is 5 minutes to 7 days')
  need(p.checkMinutes >= 5 && p.checkMinutes <= p.windowMinutes, 'the check interval is at least 5 minutes and no longer than the window')
  need(!p.notify || (p.recipients ?? []).length > 0, 'pick at least one recipient for the review request')
  return db.transaction(() => {
    const live = liveMonitor(db, p.repo, p.pr)
    need(!live, `${p.repo}#${p.pr} is already watched by ${live?.id}${live?.session_id ? ` (session ${live.session_id.slice(0, 8)})` : ''}`)
    const id = nextId(db, 'monitors', 'M')
    const t = now()
    db.prepare(`INSERT INTO monitors (id, session_id, repo, pr, ticket, stage, window_minutes, check_minutes, notify, recipients, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ci', ?, ?, ?, ?, ?, ?)`)
      .run(id, p.session, p.repo, p.pr, p.ticket ?? null, p.windowMinutes, p.checkMinutes, p.notify ? 1 : 0, p.notify ? JSON.stringify(p.recipients) : null, t, t)
    addEvent(db, id, 'started', `Watching ${p.repo}#${p.pr}: CI, merge, production deploy, then ${p.windowMinutes} min of stability`)
    return getMonitor(db, id)
  })()
}

export function getMonitor(db: Store, id: string): Monitor {
  const m = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as Monitor | undefined
  need(m, `no monitor ${id}`)
  return m!
}

// The watcher moves a monitor on, with a line for its timeline. A finished or stopped monitor does not move again.
export function setStage(db: Store, id: string, stage: Stage, text: string, fields: { merge_sha?: string; deployed_at?: string; firefight_session?: string } = {}): Monitor {
  need(STAGES.includes(stage), `not a stage: ${stage}`)
  db.transaction(() => {
    const m = getMonitor(db, id)
    need(m.stage !== 'done' && m.stage !== 'stopped', `${id} is ${m.stage}`)
    db.prepare(`UPDATE monitors SET stage = ?, merge_sha = COALESCE(?, merge_sha), deployed_at = COALESCE(?, deployed_at),
      firefight_session = COALESCE(?, firefight_session), updated_at = ? WHERE id = ?`)
      .run(stage, fields.merge_sha ?? null, fields.deployed_at ?? null, fields.firefight_session ?? null, now(), id)
    addEvent(db, id, stage, text)
  })()
  return getMonitor(db, id)
}

export function stopMonitor(db: Store, id: string, why: string): Monitor {
  need(why.trim(), 'say why it stops')
  return setStage(db, id, 'stopped', why.trim())
}

// "#reviews (Slack)": a destination as the timeline names it.
export const raisedKey = (where: string, app: string): string => `${where} (${app})`

export function addEvent(db: Store, id: string, kind: string, text: string): void {
  db.prepare('INSERT INTO monitor_events (monitor_id, at, kind, text) VALUES (?, ?, ?, ?)').run(id, now(), kind, text)
}

export const liveMonitors = (db: Store): Monitor[] => db.prepare(`SELECT * FROM monitors WHERE ${LIVE} ORDER BY created_at, rowid`).all() as Monitor[]
export const monitorEvents = (db: Store, id: string): { at: string; kind: string; text: string }[] =>
  db.prepare('SELECT at, kind, text FROM monitor_events WHERE monitor_id = ? ORDER BY id').all(id) as { at: string; kind: string; text: string }[]

// What a repo's monitoring uses: the tools Claude found connected and the ones you picked, with their details.
export function saveSetup(db: Store, repo: string, profile: unknown): void {
  need(/^[\w.-]+\/[\w.-]+$/.test(repo), `repo must be owner/name: ${repo}`)
  db.prepare('INSERT INTO repo_setups (repo, profile, updated_at) VALUES (?, ?, ?) ON CONFLICT(repo) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at')
    .run(repo, JSON.stringify(profile), now())
}
export function getSetup<T = unknown>(db: Store, repo: string): T | null {
  const r = db.prepare('SELECT profile FROM repo_setups WHERE repo = ?').get(repo) as { profile: string } | undefined
  return r ? (JSON.parse(r.profile) as T) : null
}
