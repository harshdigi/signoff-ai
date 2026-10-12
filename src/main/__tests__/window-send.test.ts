// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import { sendTo } from '../window-send'

const win = (destroyed: boolean, pageDestroyed = false): { w: BrowserWindow; sent: unknown[][] } => {
  const sent: unknown[][] = []
  const w = { isDestroyed: () => destroyed, webContents: { isDestroyed: () => pageDestroyed, send: (...a: unknown[]) => { if (destroyed || pageDestroyed) throw new TypeError('Object has been destroyed'); sent.push(a) } } }
  return { w: w as unknown as BrowserWindow, sent }
}

describe('sending to the window', () => {
  it('sends while the window lives, and drops messages once it or its page is destroyed (quitting)', () => {
    const live = win(false)
    sendTo(live.w, 'term:data', { id: 't', data: 'x' })
    expect(live.sent).toEqual([['term:data', { id: 't', data: 'x' }]])
    expect(() => sendTo(win(true).w, 'term:data', {})).not.toThrow()
    expect(() => sendTo(win(false, true).w, 'term:data', {})).not.toThrow()
    expect(() => sendTo(null, 'term:data', {})).not.toThrow()
  })
})
