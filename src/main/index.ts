// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { app, BrowserWindow, ipcMain, Notification } from 'electron'

import { homedir } from 'os'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { openStore, type Store } from './store'
import { TerminalManager } from './terminals'
import { registerTerminalIpc } from './ipc-terminals'
import { protocolLaunch } from './protocol'
import { ChatManager } from './chat'
import { registerIdeIpc } from './ipc-ide'
import { TestRunner } from './testing'
import { Pipeline } from './pipeline'
import { Teams } from './teams'
import { Tmux } from './tmux'
import { ensureUtf8Locale, loadShellPath } from './shell-env'
import { ensureBrewDirsOnPath } from './setup'
import { changes, getWorkspace } from './workspace'
import { getSettings } from './settings'
import { skillDirs } from './skilldirs'
import { appFiles, pinUserData } from './paths'
import { parseDeepLink, type DeepLink } from './deeplink'
import { registerBoardIpc } from './ipc-board'

// The prototype's data, imported once into an empty store (Phase 1, D4).

let store: Store
let mainWindow: BrowserWindow | null = null
const terminals = new TerminalManager()
import icon from '../../resources/icon.png?asset'
import { sendTo } from './window-send'
import { SpeechInput } from './speech'
import { deployWorkflowOf, gh, MonitorWatcher } from './monitor-watch'
import { registerMonitorIpc } from './ipc-monitor'
import { registerStoryIpc } from './ipc-story'
import { writeStory } from './story'
import { checkApprovals, sendReviewRequest } from './monitor-notify'
import { checkErrors } from './monitor-errors'
import { startFirefight } from './monitor-firefight'
import { runHeadless } from './headless'
import { addEvent, type Monitor } from '../shared/monitors'
import { queueMessage } from '../shared/board'
import { repairIntegration } from './integration'
import { appPage, denyPermissions, guardIpc, hardenWindow, lockDataDir } from './security'

// The app's own page (out/renderer); the only page allowed in the window and to talk to the main process.
const page = appPage(join(__dirname, '../renderer'))

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Signoff AI',
    // macOS: toolbar sits beside the window buttons, as in VS Code.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The page runs sandboxed with no Node access; it reaches the app only through the preload's window.api.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // Full screen hides macOS's window buttons, so the top bar drops the space it keeps for them.
  mainWindow.on('enter-full-screen', () => sendTo(mainWindow, 'window:fullscreen', true))
  mainWindow.on('leave-full-screen', () => sendTo(mainWindow, 'window:fullscreen', false))
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    pageReady = true
    for (const l of pendingLinks) sendTo(mainWindow, 'deeplink', l)
    pendingLinks = []
  })

  hardenWindow(mainWindow, page)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Before ready: the data folder must not depend on the app's display name.
pinUserData()

// decision-ide:// links (Shortcuts, Siri). macOS can deliver one before the window exists: keep it until the page loads.
let pendingLinks: DeepLink[] = []
let pageReady = false
const deliver = (link: DeepLink): void => {
  if (pageReady) sendTo(mainWindow, 'deeplink', link)
  else pendingLinks.push(link)
}
app.setAsDefaultProtocolClient('decision-ide')
app.on('open-url', (e, url) => {
  e.preventDefault()
  const link = parseDeepLink(url)
  if (link) deliver(link)
  mainWindow?.show()
})

app.whenReady().then(() => {
  ipcMain.handle('window:isFullScreen', () => mainWindow?.isFullScreen() ?? false)
  // Set app user model id for windows
  electronApp.setAppUserModelId('io.github.harshdigi.signoffai') // Windows taskbar identity; same as the bundle id

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Before any handler is registered: only the app's page may call the main process; OS permissions denied.
  guardIpc(page)
  denyPermissions()
  lockDataDir(app.getPath('userData'))
  const dbPath = join(app.getPath('userData'), 'board.db')
  const files = appFiles()
  const claude = (cwd: string): ReturnType<typeof protocolLaunch> => {
    const settings = getSettings(store)
    return protocolLaunch({
      resources: files.resources, cli: files.cli,
      db: dbPath, node: process.execPath, settings, addDirs: settings.nearbySkills ? skillDirs(cwd).dirs : []
    })
  }
  loadShellPath()
  ensureUtf8Locale()
  ensureBrewDirsOnPath() // tmux from Homebrew, even when the shell profile did not put it on PATH
  store = openStore(dbPath)
  // After a rename or a move (Decision IDE.app -> Signoff AI.app), Terminal integration still points into the old app.
  // Packaged builds only: a dev run must not take over your terminal's decide.
  if (app.isPackaged) {
    try {
      const f = appFiles()
      if (repairIntegration(homedir(), join(app.getPath('userData'), 'terminal-integration.json'), { node: process.execPath, cli: f.cli, resources: f.resources, db: dbPath, shell: process.env.SHELL || '/bin/zsh' }))
        console.log('terminal integration now points at this app')
    } catch (e) {
      console.error('could not update terminal integration for this app:', e) // Settings → Terminal integration can redo it
    }
  }
  registerTerminalIpc(terminals, () => mainWindow, claude, () => getWorkspace(store).current)
  // chat is made just below; a wake only happens later, from the window.
  const stopBoardWatch = registerBoardIpc(store, () => mainWindow, (s) => chat.wake(s))
  app.on('before-quit', stopBoardWatch)
  const chat = new ChatManager(store, (cwd) => ({ ...claude(cwd), decide: join(files.resources, 'decision-protocol/bin/decide') }), {
    settings: () => getSettings(store),
    files: (cwd) => changes(cwd).files.map((f) => f.path),
    attachments: join(app.getPath('userData'), 'attachments'),
    tmux: new Tmux(join(files.resources, 'tmux.conf'))
  }, terminals)
  const pipeline = new Pipeline(store, chat, () => getSettings(store))
  // Monitors (SIGNOFF-23): GitHub is checked every 2 minutes with gh, at no token cost.
  const tell = (m: Monitor, text: string): void => {
    if (!m.session_id) return
    queueMessage(store, m.session_id, text, 'monitor')
    try { chat.wake(m.session_id) } catch (e) { console.error(`could not wake session ${m.session_id}:`, e) } // the message waits on the board
  }
  const watcher = new MonitorWatcher(store, gh, {
    ciGreen: (m) => {
      if (!m.notify) return
      const cwd = (store.prepare('SELECT cwd FROM sessions WHERE id = ?').get(m.session_id) as { cwd: string | null } | undefined)?.cwd ?? homedir()
      void sendReviewRequest(store, m, {
        pr: async (repo, n) => JSON.parse(await gh(['pr', 'view', String(n), '-R', repo, '--json', 'title,url'])) as { title: string; url: string },
        run: (args) => runHeadless(args, { cwd, env: { ...process.env, DECISION_IDE_DB: dbPath, DECISION_IDE_APP: '1' }, timeoutMs: 180_000 })
      }).catch((e: unknown) => addEvent(store, m.id, 'notify-failed', `Review request failed: ${(e as Error).message.slice(0, 200)}`))
    },
    ciRed: (m, failed) => tell(m, `Monitor ${m.id}: CI failed on ${m.repo}#${m.pr}: ${failed.join(', ')}. Fix it, or tell the user why not.`),
    started: (m) => {
      if (!m.ticket) return
      const cwd = (store.prepare('SELECT cwd FROM sessions WHERE id = ?').get(m.session_id) as { cwd: string | null } | undefined)?.cwd
      if (!cwd) return
      void writeStory(store, m.ticket, cwd, (args) => runHeadless(args, { cwd, env: { ...process.env, DECISION_IDE_DB: dbPath, DECISION_IDE_APP: '1' }, timeoutMs: 240_000 }))
        .catch((e: unknown) => addEvent(store, m.id, 'error', `Could not write the Story: ${(e as Error).message.slice(0, 200)}`))
    },
    checkApproval: async (m) => {
      const cwd = (store.prepare('SELECT cwd FROM sessions WHERE id = ?').get(m.session_id) as { cwd: string | null } | undefined)?.cwd ?? homedir()
      const { url } = JSON.parse(await gh(['pr', 'view', String(m.pr), '-R', m.repo, '--json', 'url'])) as { url: string }
      return checkApprovals(store, m, (args) => runHeadless(args, { cwd, env: { ...process.env, DECISION_IDE_DB: dbPath, DECISION_IDE_APP: '1' }, timeoutMs: 180_000 }), url)
    },
    checkErrors: (m) => {
      const cwd = (store.prepare('SELECT cwd FROM sessions WHERE id = ?').get(m.session_id) as { cwd: string | null } | undefined)?.cwd ?? homedir()
      return checkErrors(store, m, (args) => runHeadless(args, { cwd, env: { ...process.env, DECISION_IDE_DB: dbPath, DECISION_IDE_APP: '1' }, timeoutMs: 240_000 }), new Date().toISOString())
    },
    incident: (m, what) => {
      // A change watch (SIGNOFF-34/D2): no PR to revert, so no fire-fighting session; the session proposes undoing it.
      if (m.kind === 'change') {
        tell(m, `Monitor ${m.id}, production: ${what} (after: ${m.subject}${m.focus ? `; focus: ${m.focus}` : ''}). Look into it and propose undoing the change; ask the user before changing anything.`)
        if (Notification.isSupported()) new Notification({ title: `Production problem after: ${m.subject}`, body: what }).show()
        return
      }
      const ff = startFirefight(store, chat, m, what)
      tell(m, `Monitor ${m.id}, production: ${what} (${m.repo}#${m.pr}).${ff ? ` Fire fighting runs in session ${ff.slice(0, 8)}; it prepares the fix and the rollback for the user's approval.` : ''}`)
      if (Notification.isSupported()) new Notification({ title: `Production incident: ${m.repo}#${m.pr}`, body: what }).show()
    }
  }, (repo) => deployWorkflowOf(store, repo))
  const watchTimer = setInterval(() => void watcher.tick(), 120_000)
  registerMonitorIpc(store, { ...process.env, DECISION_IDE_DB: dbPath, DECISION_IDE_APP: '1' }, watcher)
  registerStoryIpc(store, { ...process.env, DECISION_IDE_DB: dbPath, DECISION_IDE_APP: '1' })
  app.on('before-quit', () => clearInterval(watchTimer))
  const stopIde = registerIdeIpc(store, chat, terminals, new TestRunner(terminals), pipeline, new Teams(store, chat), () => mainWindow)
  app.on('before-quit', () => {
    stopIde()
    chat.stopAll()
  })
  // Voice input in the chat box (speech.ts): the language comes from Settings, empty = the Mac's own.
  const speech = new SpeechInput(join(files.resources, 'speech/signoff-speech'), (e) => sendTo(mainWindow, 'speech:event', e))
  ipcMain.handle('speech:start', () => speech.start(getSettings(store).speechLocale || null))
  ipcMain.handle('speech:stop', () => speech.stop())
  ipcMain.handle('speech:languages', () => speech.languages())
  app.on('before-quit', () => speech.kill())

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// Quitting ends every embedded terminal's process.
app.on('before-quit', () => terminals.closeAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
