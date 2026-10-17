// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { ipcMain } from 'electron'
import type { Store } from './store'
import { runHeadless } from './headless'
import { chartOf, storyOf, writeStory } from './story'

// The Story tab (SIGNOFF-24/D3) for a session's ticket.
export function registerStoryIpc(db: Store, env: NodeJS.ProcessEnv): void {
  const sessionOf = (id: string): { ticket: string; cwd: string } => {
    const s = db.prepare('SELECT ticket, cwd FROM sessions WHERE id = ?').get(id) as { ticket: string | null; cwd: string | null } | undefined
    if (!s?.ticket) throw new Error('this session has no ticket yet')
    if (!s.cwd) throw new Error('this session has no folder')
    return { ticket: s.ticket, cwd: s.cwd }
  }
  ipcMain.handle('story:get', (_e, session: string) => {
    const s = db.prepare('SELECT ticket FROM sessions WHERE id = ?').get(session) as { ticket: string | null } | undefined
    if (!s?.ticket) return { ticket: null, chart: [], story: null }
    return { ticket: s.ticket, chart: chartOf(db, s.ticket), story: storyOf(db, s.ticket) }
  })
  ipcMain.handle('story:write', (_e, session: string) => {
    const s = sessionOf(session)
    return writeStory(db, s.ticket, s.cwd, (args) => runHeadless(args, { cwd: s.cwd, env, timeoutMs: 240_000 }))
  })
}
