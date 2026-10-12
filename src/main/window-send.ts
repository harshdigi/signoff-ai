// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { BrowserWindow } from 'electron'

// Messages to the window. While the app quits (or after the window closes), its page is destroyed but terminals and
// chats still emit for a moment. Sending then throws "Object has been destroyed"; Electron shows that as a modal
// error box, and the quit hangs behind it. So a message for a window that is gone is dropped: nothing could read it.
export function sendTo(w: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): void {
  if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
}
