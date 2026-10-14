// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { BrowserWindow, ipcMain } from 'electron'
import * as b from '../shared/board'
import { changeStamp, readBoard } from './board-state'
import type { Store } from './store'
import { sendTo } from './window-send'

// What the window may do to the board. Every write goes through the shared board operations (same rules as decide).
// `by` is always 'board' or 'you': the window cannot act as a session.
// wake: makes sure a session can receive a board message now (ChatManager.wake): started if it is not running.
export function registerBoardIpc(db: Store, window: () => BrowserWindow | null, wake: (session: string) => string): () => void {
  // After your answer is saved, its session is woken so the message reaches it. If waking fails (tmux gone, say),
  // the answer stays saved and the message waiting; the card shows "Not delivered yet" with Send now.
  const tryWake = (session: string | null): void => {
    if (!session) return
    try {
      wake(session)
    } catch (e) {
      console.error(`could not wake session ${session}:`, e)
    }
  }
  ipcMain.handle('board:state', () => readBoard(db))
  ipcMain.handle('board:reviewDiff', (_e, review: string, change: string) =>
    (db.prepare('SELECT diff FROM review_changes WHERE review_id = ? AND change_id = ?').get(review, change) as { diff: string } | undefined)?.diff ?? '')
  ipcMain.handle('board:answer', (_e, id: string, text: string) => tryWake(b.answerFromBoard(db, id, text)))
  // Delivery: send waiting messages now (starting the session if needed), or put a stuck one back in the queue.
  ipcMain.handle('board:deliver', (_e, session: string) => wake(session))
  ipcMain.handle('board:resend', (_e, message: string) => wake(b.resendMessage(db, message)))
  ipcMain.handle('board:withdraw', (_e, id: string, reason: string) => b.withdraw(db, id, 'you', reason || 'dismissed on the board'))
  ipcMain.handle('board:object', (_e, id: string, reason: string) => b.object(db, id, reason))
  ipcMain.handle('board:ask', (_e, id: string, text: string) => {
    b.askAbout(db, id, text)
    tryWake((db.prepare('SELECT session_id FROM decisions WHERE id = ?').get(id) as { session_id: string | null }).session_id)
  })
  ipcMain.handle('board:forProduct', (_e, id: string, note: string) => b.openForProduct(db, id, note))
  ipcMain.handle('board:backFromProduct', (_e, id: string) => b.backFromProduct(db, id))
  ipcMain.handle('board:setAside', (_e, id: string) => b.setAside(db, id))
  ipcMain.handle('board:bringBack', (_e, id: string) => b.bringBack(db, id))
  ipcMain.handle('board:reopen', (_e, id: string) => b.reopen(db, id))
  ipcMain.handle('board:message', (_e, session: string, text: string) => b.queueMessage(db, session, text, 'board'))
  ipcMain.handle('board:typed', (_e, session: string, text: string) => b.logTyped(db, session, text))
  ipcMain.handle('board:verdict', (_e, rid: string, cid: string, verdict: b.Verdict, comment?: string) => tryWake(b.setVerdict(db, rid, cid, verdict, comment)))
  ipcMain.handle('board:dismissReview', (_e, rid: string) => tryWake(b.dismissReview(db, rid)))
  ipcMain.handle('board:submit', (_e, rid: string, acceptRest: boolean, note?: string) => {
    const status = b.submitReview(db, rid, { acceptRest, note })
    tryWake((db.prepare('SELECT session_id FROM reviews WHERE id = ?').get(rid) as { session_id: string | null }).session_id)
    return status
  })

  // Tell the window when the board changed, once a second at most:
  // - data_version moves when another connection commits (decide, a session, the MCP server);
  // - total_changes moves when this connection writes (the app's own actions: remove, rename, ticket steps…).
  // Without the second, the app's own changes did not show until something else wrote.
  let seen = changeStamp(db)
  const timer = setInterval(() => {
    const v = changeStamp(db)
    if (v !== seen) {
      seen = v
      sendTo(window(), 'board:changed')
    }
  }, 1000)
  return () => clearInterval(timer)
}
