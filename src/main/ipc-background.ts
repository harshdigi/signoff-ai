// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import { promisify } from 'util'
import { listChecks } from './checks'
import { classify, parsePs, sameStop, type Proc, type Stop } from './processes'
import type { Store } from './store'
import type { TerminalManager } from './terminals'
import type { Tmux } from './tmux'

const run = promisify(execFile)

// Background view (SIGNOFF-39-PROCS): what the app runs and what wakes it. Read only while the view is open.
export function registerBackgroundIpc(db: Store, tmux: Tmux, terms: TerminalManager): void {
  const session = db.prepare('SELECT title, archived FROM sessions WHERE id = ?')
  const list = async (): Promise<Proc[]> => {
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,etime=,command='], { maxBuffer: 16 * 1024 * 1024 })
    return classify(parsePs(stdout), {
      appPid: process.pid,
      socket: tmux.socket,
      panes: tmux.panes(),
      terminals: terms.list().filter((t) => !t.exited),
      session: (id) => {
        const r = session.get(id) as { title: string | null; archived: number } | undefined
        return r ? { title: r.title, live: !r.archived } : null
      }
    })
  }
  ipcMain.handle('bg:list', async () => ({ processes: await list(), checks: listChecks() }))
  // Stop (D3): only what is still a leftover now; the window's list can be seconds old.
  ipcMain.handle('bg:stop', async (_e, stop: Stop) => {
    if (!(await list()).some((p) => p.kind === 'leftover' && sameStop(p.stop, stop))) throw new Error('That is no longer a leftover, so nothing was stopped.')
    if ('server' in stop) await run('tmux', ['-L', stop.server, 'kill-server'])
    else tmux.stop(stop.session)
  })
}
