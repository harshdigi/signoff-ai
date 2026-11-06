// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import { promisify } from 'util'
import { listChecks } from './checks'
import { funesEntry, writeShim, type FunesHub } from './funes-hub'
import { homedir } from 'os'
import { getSettings, saveSettings } from './settings'
import { classify, parsePs, parseTop, sameStop, withFootprint, type Proc, type Stop } from './processes'
import type { Store } from './store'
import type { TerminalManager } from './terminals'
import type { Tmux } from './tmux'

const run = promisify(execFile)
const FOOTPRINT_MS = 15_000

// Background view (SIGNOFF-39-PROCS): what the app runs and what wakes it. Read only while the view is open.
// suspend: stops an idle app session (ChatManager.suspend); it throws when the session has work running.
// funes: the shared funes (D9): the hub, and where its socket and shim are.
export function registerBackgroundIpc(db: Store, tmux: Tmux, terms: TerminalManager, suspend: (session: string) => void, funes: { hub: FunesHub; socket: string; shim: string }): void {
  // Footprint (top) costs about half a second of CPU, so it is read at most every 15 s; the 3 s refresh reuses it.
  // - top fails: memory falls back to rss (ps) for that read, and the view says so (memory: 'resident').
  let footprint: { at: number; kb: Map<number, number> } | null = null
  const readFootprint = async (): Promise<Map<number, number> | null> => {
    if (footprint && Date.now() - footprint.at < FOOTPRINT_MS) return footprint.kb
    try {
      const { stdout } = await run('top', ['-l', '1', '-stats', 'pid,mem'], { maxBuffer: 16 * 1024 * 1024 })
      footprint = { at: Date.now(), kb: parseTop(stdout) }
      return footprint.kb
    } catch (e) {
      console.error('Background view: top failed, showing resident memory', e)
      return null
    }
  }
  const session = db.prepare('SELECT title, archived FROM sessions WHERE id = ?')
  // kb: footprint by pid, or null to count rss (Stop only needs to know what is a leftover).
  const list = async (kb: Map<number, number> | null): Promise<Proc[]> => {
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,etime=,command='], { maxBuffer: 16 * 1024 * 1024 })
    const rows = parsePs(stdout)
    return classify(kb ? withFootprint(rows, kb) : rows, {
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
  ipcMain.handle('bg:list', async () => {
    const kb = await readFootprint()
    return { processes: await list(kb), checks: listChecks(), memory: kb ? 'footprint' : 'resident' }
  })
  ipcMain.handle('bg:suspend', (_e, session: string) => suspend(session))
  // Stop (D3): only what is still a leftover now; the window's list can be seconds old.
  ipcMain.handle('bg:stop', async (_e, stop: Stop) => {
    if (!(await list(null)).some((p) => p.kind === 'leftover' && sameStop(p.stop, stop))) throw new Error('That is no longer a leftover, so nothing was stopped.')
    if ('server' in stop) await run('tmux', ['-L', stop.server, 'kill-server'])
    else tmux.stop(stop.session)
  })
  // Shared funes (D9): your funes entry is switched with Claude Code's own `claude mcp` commands, in a visible terminal.
  // - Sharing remembers the entry it replaces, and the shim runs that entry when the app is not running.
  // - Going back re-adds exactly that entry.
  ipcMain.handle('funes:state', () => {
    const entry = funesEntry(homedir())
    return { entry, shared: entry?.[0] === funes.shim, sessions: funes.hub.sessions(), running: funes.hub.pid() !== null }
  })
  ipcMain.handle('funes:share', () => {
    const entry = funesEntry(homedir())
    if (!entry) throw new Error('funes is not set up in Claude Code (no funes entry in your user config)')
    if (entry[0] === funes.shim) throw new Error('funes is already shared')
    saveSettings(db, { funesOriginal: entry })
    writeShim(funes.shim, funes.socket, entry)
    const script = 'claude mcp remove funes --scope user && claude mcp add --scope user funes -- "$1"'
    return { ...terms.spawn({ command: '/bin/sh', args: ['-c', script, 'sh', funes.shim] }), title: 'Share one funes' }
  })
  ipcMain.handle('funes:unshare', () => {
    const original = getSettings(db).funesOriginal
    if (!original) throw new Error('the app does not know your funes entry from before; re-add it with claude mcp add')
    const script = 'claude mcp remove funes --scope user && claude mcp add --scope user funes -- "$@"'
    return { ...terms.spawn({ command: '/bin/sh', args: ['-c', script, 'sh', ...original] }), title: 'One funes per session' }
  })
}
