// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { errText } from './types'

// Story (SIGNOFF-24/D3): the ticket at a glance. A plain summary and "how it works" flow from Claude (Update), and the
// decision chart from the board (always current). Technical details stay folded.
type Node = { id: string; question: string; answer: string | null; by: string; status: string; at: string; kind: 'decision' | 'plan' | 'review' }
type StoryData = { summary: string[]; flow: { step: string; detail: string }[]; technical: string }
type View = { ticket: string | null; chart: Node[]; story: { story: StoryData; writtenAt: string } | null }
const time = (iso: string): string => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Story({ session }: { session: string }): React.JSX.Element {
  const [v, setV] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => { window.api.story.get(session).then(setV, (e: unknown) => setErr(errText(e))) }, [session])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])
  if (!v) return <div className="view story"><p className="meta">{err ?? 'Loading…'}</p></div>
  if (!v.ticket) return <div className="view story"><p className="empty pad">The story starts once this session has a ticket.</p></div>
  const write = (): void => {
    setBusy(true); setErr(null)
    window.api.story.write(session).then(load, (e: unknown) => setErr(errText(e))).finally(() => setBusy(false))
  }
  const st = v.story?.story
  const mine = v.chart.filter((n) => n.by === 'you').length
  const claude = v.chart.filter((n) => n.by.startsWith('claude')).length
  const open = v.chart.filter((n) => n.by === 'waiting for you').length
  return (
    <div className="view story">
      <div className="story-head"><b>{v.ticket}</b><span className="meta">{v.story ? `written ${time(v.story.writtenAt)}` : 'no story yet'}</span><span className="grow" />
        <button className="sm" disabled={busy} onClick={write}>{busy ? 'Writing (about a minute)…' : v.story ? 'Update' : 'Write the story'}</button></div>
      {err && <div className="err">{err}</div>}
      {st && (
        <>
          <ul className="story-summary">{st.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="side-group">How it works</div>
          <div className="story-flow">{st.flow.map((f, i) => (
            <div key={i} className="flow-step"><div className="flow-box"><b>{f.step}</b><span className="meta">{f.detail}</span></div>{i < st.flow.length - 1 && <div className="flow-arrow">↓</div>}</div>
          ))}</div>
        </>
      )}
      <div className="side-group">Decisions <span className="meta">{mine} by you · {claude} by Claude{open ? ` · ${open} waiting for you` : ''}</span></div>
      <div className="story-chart">{v.chart.length === 0 ? <p className="meta">No decisions yet.</p> : v.chart.map((n, i) => (
        <div key={n.id} className="flow-step">
          <div className={'chart-box ' + (n.by === 'waiting for you' ? 'waiting' : n.by.startsWith('claude') ? 'claude' : 'you')}>
            <span className="meta">{n.id}{n.kind === 'plan' ? ' · plan' : n.kind === 'review' ? ' · review' : ''}</span>
            <b>{n.question}</b>
            <span>{n.answer ?? 'open'}<span className="meta"> · {n.by}</span></span>
          </div>
          {i < v.chart.length - 1 && <div className="flow-arrow">↓</div>}
        </div>
      ))}</div>
      {st && (
        <details className="fold story-tech">
          <summary className="side-group">Technical details</summary>
          <Markdown remarkPlugins={[remarkGfm]}>{st.technical}</Markdown>
        </details>
      )}
    </div>
  )
}
