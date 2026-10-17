// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { errText } from './types'

// Story (SIGNOFF-24/D3, D16-D18): the ticket as a decision diagram and a numbered "why" list.
// - Columns come from the board at once, with raw option labels.
// - After Update, Claude's short box text and why points replace them; a newer choice keeps raw labels until then.
// - How it works and technical notes stay folded.
type Box = { title: string; lines: string[] }
type Choice = { id: string; question: string; options: string[]; chosen: string | null; by: string; context: string[] }
type Column = { id: string; question: Box; chosen: Box | null; rejected: Box[]; why: string[] }
type StoryData = { summary: string; context: Box; columns: Column[]; flow: { step: string; detail: string }[]; technical: string }
type View = { ticket: string | null; diagram: { choices: Choice[]; approvals: number; reviews: number } | null; story: { story: StoryData; writtenAt: string } | null }
const time = (iso: string): string => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const raw = (c: Choice): Column => ({
  id: c.id,
  question: { title: c.question, lines: [] },
  chosen: c.chosen ? { title: c.chosen, lines: [] } : null,
  rejected: c.options.filter((o) => o !== c.chosen).map((o) => ({ title: o, lines: [] })),
  why: []
})

function BoxView({ b, kind, n, by }: { b: Box; kind: string; n?: number; by?: string }): React.JSX.Element {
  return (
    <div className={'dg-box ' + kind}>
      <b>{n !== undefined && `${n} · `}{b.title}</b>
      {b.lines.map((l, i) => <span key={i}>{l}</span>)}
      {by && <em>{by === 'you' ? 'by you' : 'by Claude'}</em>}
    </div>
  )
}

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
  if (!v.ticket || !v.diagram) return <div className="view story"><p className="empty pad">The story starts once this session has a ticket.</p></div>
  const write = (): void => {
    setBusy(true); setErr(null)
    window.api.story.write(session).then(load, (e: unknown) => setErr(errText(e))).finally(() => setBusy(false))
  }
  // A story written before the diagram (no columns) is shown as not written yet.
  const st = v.story && Array.isArray(v.story.story.columns) ? v.story.story : null
  const { choices, approvals, reviews } = v.diagram
  const cols = choices.map((c) => ({ c, col: st?.columns.find((x) => x.id === c.id) ?? raw(c) }))
  return (
    <div className="view story">
      <div className="story-head"><b>{v.ticket}</b><span className="meta">{st ? `written ${time(v.story!.writtenAt)}` : 'not written yet'}</span><span className="grow" />
        <button className="sm" disabled={busy} onClick={write}>{busy ? 'Writing (about a minute)…' : st ? 'Update' : 'Write the story'}</button></div>
      {err && <div className="err">{err}</div>}
      {st && <p className="story-summary">{st.summary}</p>}
      {choices.length === 0 ? <p className="meta">No choices yet.</p> : (
        <div className="dg-scroll">
          <div className="dg" style={{ gridTemplateColumns: `auto ${st ? 'minmax(140px, 170px) ' : ''}repeat(${choices.length}, minmax(150px, 190px))` }}>
            <span className="dg-lane">Rejected</span>
            {st && <span />}
            {cols.map(({ c, col }) => <div key={c.id} className="dg-cell up">{col.rejected.map((b, i) => <BoxView key={i} b={b} kind={c.chosen ? 'rejected' : 'option'} />)}</div>)}
            <span className="dg-lane">Question</span>
            {st && <div className="dg-cell mid"><BoxView b={st.context} kind="context" /></div>}
            {cols.map(({ c, col }, i) => <div key={c.id} className="dg-cell mid"><BoxView b={col.question} kind="question" n={i + 1} /></div>)}
            <span className="dg-lane">Chosen</span>
            {st && <span />}
            {cols.map(({ c, col }) => <div key={c.id} className="dg-cell down">{col.chosen ? <BoxView b={col.chosen} kind="chosen" by={c.by} /> : <div className="dg-box waiting"><b>Waiting for you</b></div>}</div>)}
          </div>
        </div>
      )}
      <div className="dg-legend meta">
        <span className="key question" />Question<span className="key chosen" />Chosen<span className="key rejected" />Rejected
        {(approvals > 0 || reviews > 0) && <span className="grow-text">Not drawn: {approvals} approval{approvals === 1 ? '' : 's'} · {reviews} review{reviews === 1 ? '' : 's'}</span>}
      </div>
      {cols.length > 0 && (
        <ol className="dg-why">
          {cols.map(({ c, col }, i) => (
            <li key={c.id}>
              <b>{i + 1} · {col.question.title}</b>
              {col.why.length ? <ul>{col.why.map((w, j) => <li key={j}>{w}</li>)}</ul> : <span className="meta"> {c.chosen ? 'Update to write why.' : 'Open.'}</span>}
            </li>
          ))}
        </ol>
      )}
      {st && (
        <details className="fold story-tech">
          <summary className="side-group">How it works and technical notes</summary>
          <ol className="story-flow">{st.flow.map((f, i) => <li key={i}><b>{f.step}</b> <span className="meta">{f.detail}</span></li>)}</ol>
          <Markdown remarkPlugins={[remarkGfm]}>{st.technical}</Markdown>
        </details>
      )}
    </div>
  )
}
