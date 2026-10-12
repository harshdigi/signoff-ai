// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { checkClaudeArgs } from './security-rules'
import { BrowserWindow, ipcMain } from 'electron'
import { homedir } from 'os'
import type { ClaudeLaunch } from './protocol'
import type { SpawnOptions, TerminalManager } from './terminals'
import { sendTo } from './window-send'

// The only terminal channels the window may use. Spawning stays limited to a shell or `claude`;
// arbitrary commands from the renderer are refused.
const ALLOWED = new Set([undefined, 'claude'])
// Terminals start in the open folder (IDE/D12); with no folder open, in the home folder.

// Every claude the app starts gets the decision protocol (IDE/D7): its flags go first, the renderer's after.
export function registerTerminalIpc(terms: TerminalManager, window: () => BrowserWindow | null, launch: (cwd: string) => ClaudeLaunch, folder: () => string | null): void {
  ipcMain.handle('term:spawn', (_e, opts: SpawnOptions) => {
    if (!ALLOWED.has(opts?.command)) throw new Error(`command not allowed: ${opts?.command}`)
    const cwd = folder() || homedir()
    if (opts.command !== 'claude') return terms.spawn({ ...opts, cwd: opts.cwd || cwd })
    const claude = launch(cwd)
    const args = [...claude.args, ...(opts.args || [])]
    checkClaudeArgs(args) // the window cannot start claude with a permission-skipping flag
    return terms.spawn({ ...opts, cwd, args, env: { ...opts.env, ...claude.env } })
  })
  ipcMain.on('term:write', (_e, id: string, data: string) => terms.write(id, data))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => terms.resize(id, cols, rows))
  ipcMain.handle('term:replay', (_e, id: string) => terms.replay(id))
  ipcMain.handle('term:list', () => terms.list())
  ipcMain.handle('term:close', (_e, id: string) => terms.close(id))
  terms.onData((ev) => sendTo(window(), 'term:data', ev))
  terms.onExit((ev) => sendTo(window(), 'term:exit', ev))
}
