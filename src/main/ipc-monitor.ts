// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { ipcMain } from 'electron'
import type { Store } from './store'
import { alreadyRaised, getSetup, liveMonitor, monitorEvents, saveSetup, startMonitor, stopMonitor, type Monitor, type Recipient } from '../shared/monitors'
import { repoOfFolder, runSetup, type Setup } from './monitor-setup'
import { ghIn } from './monitor-watch'

// Monitors in Ship (SIGNOFF-23 step 4): what the panel shows for one session, and starting and stopping a watch.
export type Chosen = { deployWorkflow?: string; recipients?: Recipient[]; errors?: { app: string; services: string[] } }
type Pr = { number: number; url: string; title: string; state: string }
type SessionRow = { id: string; title: string | null; cwd: string | null }

const sessionOf = (db: Store, id: string): SessionRow => {
  const s = db.prepare('SELECT id, title, cwd FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!s?.cwd) throw new Error('this session has no folder')
  return s
}
// The pull request of a folder's current branch, or null when there is none yet.
const prOf = async (cwd: string): Promise<Pr | null> => {
  try {
    return JSON.parse(await ghIn(cwd, ['pr', 'view', '--json', 'number,url,title,state'])) as Pr
  } catch {
    return null // no pull request for this branch (gh exits non-zero); the panel offers to open one first
  }
}
const withEvents = (db: Store, m: Monitor | undefined): (Monitor & { events: ReturnType<typeof monitorEvents> }) | null =>
  m ? { ...m, events: monitorEvents(db, m.id) } : null

export function registerMonitorIpc(db: Store, env: NodeJS.ProcessEnv): void {
  ipcMain.handle('monitor:forSession', async (_e, id: string) => {
    const s = sessionOf(db, id)
    let repo: string | null = null
    let problem: string | null = null
    try { repo = repoOfFolder(s.cwd!) } catch (e) { problem = (e as Error).message }
    const pr = repo ? await prOf(s.cwd!) : null
    // The lead's team: each child session's pull request, and who already watches it (never two monitors on one).
    const kids = db.prepare('SELECT id, title, cwd FROM sessions WHERE parent_id = ? AND archived = 0').all(id) as SessionRow[]
    const team = await Promise.all(kids.filter((k) => k.cwd).map(async (k) => {
      const kr = (() => { try { return repoOfFolder(k.cwd!) } catch { return null } })()
      const kp = kr ? await prOf(k.cwd!) : null
      return { session: k.id, title: k.title, repo: kr, pr: kp, monitor: kr && kp ? withEvents(db, liveMonitor(db, kr, kp.number)) : null }
    }))
    return {
      repo, problem, pr, setup: repo ? getSetup<Setup>(db, repo) : null,
      monitor: repo && pr ? withEvents(db, liveMonitor(db, repo, pr.number)) : null,
      raised: repo && pr ? alreadyRaised(db, repo, pr.number) : [],
      team
    }
  })
  ipcMain.handle('monitor:setup', (_e, id: string) => runSetup(db, sessionOf(db, id).cwd!, env))
  ipcMain.handle('monitor:choose', (_e, repo: string, chosen: Chosen) => {
    const s = getSetup<Setup>(db, repo)
    if (!s) throw new Error(`run the setup check for ${repo} first`)
    saveSetup(db, repo, { ...s, chosen })
  })
  // Starts a watch on a session's pull request. owner: the session that watches (the lead, for its team's).
  ipcMain.handle('monitor:start', async (_e, o: { session: string; owner?: string; windowMinutes: number; checkMinutes: number; notify: boolean; recipients: Recipient[] }) => {
    const s = sessionOf(db, o.session)
    const repo = repoOfFolder(s.cwd!)
    const pr = await prOf(s.cwd!)
    if (!pr) throw new Error('this branch has no pull request yet; open it first')
    const ticket = (db.prepare('SELECT ticket FROM sessions WHERE id = ?').get(o.session) as { ticket: string | null }).ticket
    return startMonitor(db, { session: o.owner ?? o.session, repo, pr: pr.number, ticket, windowMinutes: o.windowMinutes, checkMinutes: o.checkMinutes, notify: o.notify, recipients: o.recipients })
  })
  ipcMain.handle('monitor:stop', (_e, id: string, why: string) => stopMonitor(db, id, why))
}
