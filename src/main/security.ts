// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { app, ipcMain, session, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { chmodSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { allowedPermission, externalAllowed, isAppUrl } from './security-rules'

// Applies the rules in security-rules.ts to Electron. See SECURITY.md for the full list and why each exists.
type AppPage = { rendererDir: string; devUrl?: string | null }

// Links: opened in the browser only when the scheme is allowed; anything else is dropped and logged.
export function openExternalSafely(url: string): void {
  if (externalAllowed(url)) void shell.openExternal(url)
  else console.warn(`blocked opening ${url.slice(0, 120)}: only https, http and mailto links leave the app`)
}

// The window stays on the app's page: no navigation away, no new windows, no embedded web views.
export function hardenWindow(win: BrowserWindow, page: AppPage): void {
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url, page)) return
    e.preventDefault()
    openExternalSafely(url)
  })
  win.webContents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url, page)) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
}

// OS permissions the page asks for (camera, microphone, location...): only clipboard writes are granted.
export function denyPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(allowedPermission(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowedPermission(permission))
}

// Every message to the main process must come from the app's own page. Applied once, before any handler is
// registered, by wrapping ipcMain.handle and ipcMain.on: a message from anywhere else is refused (and logged).
export function guardIpc(page: AppPage): void {
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => isAppUrl(e.senderFrame?.url, page)
  const handle = ipcMain.handle.bind(ipcMain)
  const on = ipcMain.on.bind(ipcMain)
  ipcMain.handle = ((channel: string, fn: (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown) =>
    handle(channel, (e, ...a) => {
      if (!trusted(e)) throw new Error(`refused ${channel}: not from the app's page`)
      return fn(e, ...a)
    })) as typeof ipcMain.handle
  ipcMain.on = ((channel: string, fn: (e: IpcMainEvent, ...a: unknown[]) => void) =>
    on(channel, (e, ...a) => {
      if (!trusted(e)) return void console.warn(`refused ${channel}: not from the app's page`)
      fn(e, ...a)
    })) as typeof ipcMain.on
}

// The data folder (decisions, chats, attachments) is readable by you only: the folder 700, the database files 600.
export function lockDataDir(dir: string): void {
  try {
    if (!existsSync(dir)) return
    chmodSync(dir, 0o700)
    for (const f of readdirSync(dir)) if (/^board\.db/.test(f) && statSync(join(dir, f)).isFile()) chmodSync(join(dir, f), 0o600)
  } catch (e) {
    console.error('could not tighten permissions on the data folder:', e) // the folder still works; macOS home is private by default
  }
}

export const appPage = (rendererDir: string): AppPage => ({ rendererDir, devUrl: !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] ?? null : null })
