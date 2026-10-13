// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { DecisionCard, ReviewCard } from './Cards'
import { forLater, forProduct, label, onYou, time, type BoardState, type Decision, type Review, type Session } from './types'
import { productMarkdown } from './product'
import TerminalView from '../components/TerminalView'
import { useState } from 'react'
import { act } from './useBoard'

const closed = (b: BoardState, sid: string | null): boolean => !!sid && b.sessions.find((s) => s.id === sid)?.state === 'done'
const newestFirst = (x: Decision, y: Decision): number => (y.answered_at || y.withdrawn_at || y.created_at).localeCompare(x.answered_at || x.withdrawn_at || x.created_at)

// One line per settled decision; click to expand the full card.
function DecisionRow({ d, b, refresh }: { d: Decision; b: BoardState; refresh: () => void }): React.JSX.Element {
  const result = d.status === 'withdrawn' ? `withdrawn: ${d.withdrawn_reason ?? ''}` : d.answer ?? ''
  return (
    <details className="crow">
      <summary>
        <span className="id">{d.id}</span><span className={'pill ' + d.status}>{d.status}</span>
        {d.level !== 'ask' && <span className={'pill level-' + d.level}>{d.level === 'inform' ? 'Claude' : 'auto'}</span>}
        <span className="crow-q">{d.question}</span><span className="crow-a">{result}</span>
        <span className="meta">{time(d.answered_at || d.withdrawn_at || d.created_at)}</span>
      </summary>
      <DecisionCard d={d} b={b} refresh={refresh} />
    </details>
  )
}

function ReviewRow({ r, b, refresh }: { r: Review; b: BoardState; refresh: () => void }): React.JSX.Element {
  const done = r.changes.filter((c) => c.verdict !== 'pending').length
  return (
    <details className="crow">
      <summary>
        <span className="id">{r.id}</span><span className={'pill ' + r.status}>{r.status.replace('_', ' ')}</span>
        <span className="crow-q">{r.title}</span><span className="crow-a">{done} of {r.changes.length} files reviewed</span>
        <span className="meta">{time(r.submitted_at || r.created_at)}</span>
      </summary>
      <ReviewCard r={r} b={b} refresh={refresh} />
    </details>
  )
}

export function General({ b, refresh, open }: { b: BoardState; refresh: () => void; open: (sid: string) => void }): React.JSX.Element {
  // A closed session's open items are no longer waited on: General drops them, its own tab keeps them.
  const live = b.decisions.filter((d) => d.status === 'open' && !closed(b, d.session))
  const reviews = b.reviews.filter((r) => r.status === 'open' && !closed(b, r.session))
  const actions = live.filter((d) => d.action)
  const asks = live.filter((d) => !d.action && onYou(d))
  const product = live.filter(forProduct)
  const later = live.filter(forLater)
  const history = b.decisions.filter((d) => d.status !== 'open').sort(newestFirst)
  return (
    <div className="view">
      {actions.length > 0 && <><h2>Actions for you ({actions.length})</h2>{actions.map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} />)}</>}
      <h2>Waiting on you ({asks.length + reviews.length})</h2>
      {reviews.map((r) => <ReviewCard key={r.id} r={r} b={b} refresh={refresh} />)}
      {asks.map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} />)}
      {!asks.length && !reviews.length && <p className="empty">Nothing waiting on you.</p>}
      {product.length > 0 && <ProductList list={product} b={b} refresh={refresh} />}
      {later.length > 0 && <><h2>Later ({later.length})</h2>{later.map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} />)}</>}
      <h2>Sessions</h2>
      <table>
        <thead><tr><th>Session</th><th>What it is doing</th><th>State</th><th>Open</th><th>Updated</th></tr></thead>
        <tbody>
          {b.sessions.filter((s) => !s.archived).map((s) => (
            <tr key={s.id} className="link" onClick={() => open(s.id)}>
              <td>{label(s)}<div className="meta">{s.ticket}</div></td><td>{s.description || s.note}</td>
              <td><span className={'pill ' + s.state}>{s.state}</span></td>
              <td>{b.decisions.filter((d) => d.session === s.id && onYou(d)).length}</td><td className="meta">{time(s.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>History</h2>
      {history.slice(0, 50).map((d) => <DecisionRow key={d.id} d={d} b={b} refresh={refresh} />)}
    </div>
  )
}

// Questions sent to the product team (Open for product), with their notes, ready to paste into Slack or Jira.
function ProductList({ list, b, refresh }: { list: Decision[]; b: BoardState; refresh: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <div className="row"><h2>Waiting on product ({list.length})</h2><span className="grow" />
        <button onClick={() => void navigator.clipboard.writeText(productMarkdown(list)).then(() => setCopied(true))} title="Questions, what you need, options and the recommendation, as Markdown">{copied ? 'Copied' : 'Copy for product'}</button></div>
      {list.map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} />)}
    </>
  )
}

type SessionTab = 'waiting' | 'decisions' | 'reviews'

export function SessionView({ s, b, refresh, terminal }: { s: Session; b: BoardState; refresh: () => void; terminal: string | null }): React.JSX.Element {
  const [err, setErr] = useState<string | null>(null)
  const mine = b.decisions.filter((d) => d.session === s.id)
  const open = mine.filter((d) => d.status === 'open')
  const settled = mine.filter((d) => d.status !== 'open').sort(newestFirst)
  const reviews = b.reviews.filter((r) => r.session === s.id)
  const openReviews = reviews.filter((r) => r.status === 'open')
  const sameTicket = s.ticket ? b.decisions.filter((d) => d.ticket === s.ticket && d.session !== s.id && d.status === 'open') : []
  const blocking = open.filter(onYou).length + openReviews.length
  const [picked, setTab] = useState<SessionTab | null>(null)
  const [who, setWho] = useState<'all' | 'ask' | 'claude'>('all')
  const shown = settled.filter((d) => who === 'all' || (who === 'ask' ? d.level === 'ask' : d.level !== 'ask'))
  // Default: what needs you first; the Waiting tab disappears when nothing does.
  const tab: SessionTab = picked === 'waiting' && !blocking ? 'decisions' : picked ?? (blocking ? 'waiting' : 'decisions')
  // An embedded session takes the command as typed input + Enter, as if the user typed `! <command>` themselves.
  const runInTerminal = terminal
    ? async (d: Decision): Promise<void> => {
        if (!confirm(`Run this in the session's terminal as your own ! command?\n\n${d.command}`)) return
        window.api.terminal.write(terminal, `! ${d.command}\r`)
        setErr(await act(() => window.api.board.answer(d.id, `Ran from the board in its terminal: ${d.command}`), refresh))
      }
    : undefined
  const tabs: [SessionTab, string, number][] = [
    ...(blocking ? [['waiting', 'Waiting on you', blocking] as [SessionTab, string, number]] : []),
    ['decisions', 'Decisions', settled.length], ['reviews', 'Reviews', reviews.length]
  ]
  return (
    <div className="split">
      <div className="view">
        <div className="session-head">
          <div className="row"><span className="id">{label(s)}</span><span className={'pill ' + s.state}>{s.state}</span><span className="meta">{[s.ticket, s.branch].filter(Boolean).join(' · ')}</span></div>
          {s.description && <div className="desc">{s.description}</div>}
          {s.note && <div className="meta">Now: {s.note}</div>}
        </div>
        <div className="subtabs">
          {tabs.map(([k, name, n]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{name} <span className={k === 'waiting' ? 'count' : 'n'}>{n}</span></button>
          ))}
        </div>
        {tab === 'waiting' && (
          <>
            {s.state === 'waiting' && <div className="card open"><b>Paused until you answer {blocking}.</b> <span className="meta">It continues as soon as you answer below.</span></div>}
            {open.filter((d) => d.action).map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} onRun={runInTerminal} />)}
            {openReviews.map((r) => <ReviewCard key={r.id} r={r} b={b} refresh={refresh} />)}
            {open.filter((d) => !d.action).map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} />)}
          </>
        )}
        {tab === 'decisions' && (
          <>
            <div className="chips">
              {([['all', 'All'], ['ask', 'Answered by you'], ['claude', 'Decided by Claude']] as const).map(([k, l]) => (
                <button key={k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l} <span className="n">{settled.filter((d) => k === 'all' || (k === 'ask' ? d.level === 'ask' : d.level !== 'ask')).length}</span></button>
              ))}
            </div>
            {shown.length ? shown.map((d) => <DecisionRow key={d.id} d={d} b={b} refresh={refresh} />) : <p className="empty">Nothing here yet.</p>}
          </>
        )}
        {tab === 'reviews' && (reviews.length ? [...openReviews, ...reviews.filter((r) => r.status !== 'open').reverse()].map((r) => <ReviewRow key={r.id} r={r} b={b} refresh={refresh} />) : <p className="empty">No reviews yet.</p>)}
        {sameTicket.length > 0 && (
          <details className="also">
            <summary>Also open on {s.ticket} in other sessions ({sameTicket.length})</summary>
            {sameTicket.map((d) => <DecisionCard key={d.id} d={d} b={b} refresh={refresh} />)}
          </details>
        )}
        {err && <div className="err">{err}</div>}
      </div>
      {terminal && <div className="term"><TerminalView id={terminal} /></div>}
    </div>
  )
}
