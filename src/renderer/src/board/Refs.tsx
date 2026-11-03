// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { createContext, Fragment, useContext, useEffect, useState } from 'react'
import type { BoardState } from './types'

// References that explain themselves: decision ids (D13, ABC-1/D13) and plan steps ("step 7", "points 1-3") become
// links. Hover shows what they are; click goes there.
// - Steps come from the ticket's saved plan (signoff subtask add). For older sessions that only wrote "Point 7: ..."
//   in the chat, the passage where the chat described it is used, but only if it fits: plans get renumbered, so when
//   the text names the point ("point 7 (session status)"), the passage must mention that name. Unresolved stays plain.
export type Nav = { openDecision: (id: string) => void; openTicket: (key: string) => void; gotoChat: (session: string, anchor: string) => void }
const RefsContext = createContext<{ board: BoardState | null; nav: Nav | null }>({ board: null, nav: null })
export const RefsProvider = RefsContext.Provider

const TOKEN = /\b([A-Z][A-Z0-9]{1,9}-\d+\/D\d+|D\d+|(?:points?|steps?)\s+\d+(?:\s*(?:-|–|,|and)\s*\d+)*)\b/gi
type Point = { anchor: string; text: string }

// "Point 7: session status" headings in a session's chat, newest wins. One fetch per session, shared by every link
// on screen (a chat can render thousands of paragraphs; each asking on its own reloaded a multi-MB conversation each
// time). Re-read at most every 30 s.
const points = new Map<string, { at: number; map: Map<number, Point> }>()
const loading = new Map<string, Promise<void>>()
const loadPoints = (session: string): Promise<void> => {
  const busy = loading.get(session)
  if (busy) return busy
  // Worked out in the app (SIGNOFF-38-PERF/D1): the window gets the headings, not the whole conversation.
  const p = window.api.chat.points(session).then((rows: [number, Point][]) => {
    points.set(session, { at: Date.now(), map: new Map(rows) })
  }).finally(() => loading.delete(session))
  loading.set(session, p)
  return p
}
// session: null when the text has no point or step to resolve, so nothing is fetched for it.
function usePoints(session: string | null | undefined): Map<number, Point> | null {
  const [, bump] = useState(0)
  // Checked when a link appears (not on every render): load if missing or older than 30 s.
  useEffect(() => {
    if (!session) return
    const c = points.get(session)
    if (c && Date.now() - c.at < 30_000) return
    let alive = true
    void loadPoints(session).then(() => alive && bump((n) => n + 1))
    return () => { alive = false }
  }, [session])
  return session ? points.get(session)?.map ?? null : null
}

// Text with its references linked. ticket: for bare D-ids and steps; session: whose chat holds older "Point N" passages.
export function Linked({ text, ticket, session }: { text: string; ticket?: string | null; session?: string | null }): React.JSX.Element {
  const { board, nav } = useContext(RefsContext)
  const chatPoints = usePoints(/\b(?:points?|steps?)\s+\d/i.test(text) ? session : null)
  if (!board || !nav) return <>{text}</>
  const parts = text.split(TOKEN)
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>
        if (/^([A-Z][A-Z0-9]{1,9}-\d+\/)?D\d+$/i.test(p)) {
          const id = (p.includes('/') ? p : `${ticket ?? ''}/${p}`).toUpperCase()
          const d = board.decisions.find((x) => x.id === id)
          if (!d) return <Fragment key={i}>{p}</Fragment>
          const answer = d.status === 'withdrawn' ? 'withdrawn' : d.answer ?? 'open: waiting on you'
          return <button key={i} className="ref" title={`${d.id} · ${d.question}\n→ ${answer}`} onClick={() => nav.openDecision(d.id)}>{p}</button>
        }
        const nums = (p.match(/\d+/g) ?? []).map(Number)
        const range = /-|–/.test(p) && nums.length === 2 ? Array.from({ length: Math.max(0, nums[1] - nums[0] + 1) }, (_, k) => nums[0] + k) : nums
        const steps = ticket ? board.tickets.find((t) => t.key === ticket.toUpperCase())?.subtasks : undefined
        const fromPlan = range.map((n) => steps?.find((s) => s.idx === n)).filter((s): s is NonNullable<typeof s> => !!s)
        if (fromPlan.length === range.length && ticket) {
          return <button key={i} className="ref" title={fromPlan.map((s) => `Step ${s.idx}: ${s.title} [${s.status}]`).join('\n')} onClick={() => nav.openTicket(ticket)}>{p}</button>
        }
        const named = /^\s*\(([^,)]+)/.exec(parts[i + 1] ?? '')?.[1]
        const words = (named ?? '').toLowerCase().split(/\W+/).filter((w) => w.length >= 4)
        const fits = (x: Point): boolean => !words.length || words.some((w) => x.text.toLowerCase().includes(w))
        const fromChat = range.map((n) => chatPoints?.get(n)).filter((x): x is Point => !!x && fits(x))
        if (fromChat.length === range.length && session) {
          return <button key={i} className="ref" title={fromChat.map((x) => x.text).join('\n\n')} onClick={() => nav.gotoChat(session, fromChat[0].anchor)}>{p}</button>
        }
        return <Fragment key={i}>{p}</Fragment>
      })}
    </>
  )
}
