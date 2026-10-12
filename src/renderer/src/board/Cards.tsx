// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import Rich from './Rich'
import { act } from './useBoard'
import { Linked } from './Refs'
import { unpack } from './unpack'
import { split2 } from './option'
import { SetupPreview } from '../ide/Workflows'
import type { Workflow } from '../ide/types'
import { forProduct, label, time, type BoardState, type Change, type Decision, type Review, type ThreadEntry } from './types'

// The session a card came from, as a link to its chat. A session no longer on the board stays plain text.
function SessionLink({ b, id }: { b: BoardState; id: string | null }): React.JSX.Element {
  const s = b.sessions.find((x) => x.id === id)
  if (!s) return <>{label(s)}</>
  return <button className="link sess-link" title="Open this session's chat" onClick={() => window.dispatchEvent(new CustomEvent('open-session', { detail: s.id }))}>↗ {label(s)}</button>
}

const who = (b: BoardState, t: ThreadEntry): string => (t.who === 'you' ? 'You' : label(b.sessions.find((s) => s.id === t.who)))

function Thread({ b, entries, session }: { b: BoardState; entries: ThreadEntry[]; session: string | null }): React.JSX.Element {
  return <>{entries.map((t, i) => (
    <div key={i} className={t.who === 'you' ? 'msg' : 'reply'}>
      <div className="row"><b>{who(b, t)}{t.verdict ? ` (${t.verdict})` : ''}</b><span className="meta">{time(t.at)}</span></div>
      <Rich text={t.text} session={session} />
    </div>
  ))}</>
}

// The code lines behind one piece of evidence, read from the decision's session folder.
function Evidence({ d, item, show }: { d: Decision; item: string; show: boolean }): React.JSX.Element {
  const [ref, note] = split2(item)
  const [open, setOpen] = useState(show)
  const [snip, setSnip] = useState<{ file: string; from: number; to: number; lines: { n: number; text: string }[] } | null | undefined>(undefined)
  useEffect(() => {
    if (open && snip === undefined && d.session) void window.api.evidence(d.session, ref).then(setSnip, () => setSnip(null))
  }, [open, snip, d.session, ref])
  return (
    <div className="ev2">
      <button className="link ev-ref" onClick={() => setOpen(!open)} title="Show or hide the code">{open ? '▾' : '▸'} {ref}</button>
      {note && <span className="ev-note"> {note}</span>}
      {open && snip && <pre className="snip">{snip.lines.map((l) => <div key={l.n} className={l.n >= snip.from && l.n <= snip.to ? 'hit' : ''}><span className="ln">{l.n}</span>{l.text}</div>)}</pre>}
      {open && snip === null && <div className="meta">Could not show this code (no line number, or the file is not in the session folder).</div>}
    </div>
  )
}

export function DecisionCard({ d, b, refresh, onRun }: { d: Decision; b: BoardState; refresh: () => void; onRun?: (d: Decision) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const [other, setOther] = useState(false)
  const [ask, setAsk] = useState('')
  const [productNote, setProductNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const open = d.status === 'open'
  const run = async (fn: () => Promise<unknown>): Promise<void> => setErr(await act(fn, refresh))
  // A team lead's proposed split (IDE/D22): pieces you can drop before starting them.
  const split = d.kind === 'split' && d.item ? (JSON.parse(d.item) as { pieces: Piece[] }).pieces : null
  // A session's proposed team setup (signoff team propose): shown in full, approved with one click.
  const team = d.kind === 'team' && d.item ? (JSON.parse(d.item) as Omit<Workflow, 'builtIn' | 'line'>) : null
  const q = unpack(d.question)
  const context = [...(d.context ?? []), ...q.points]
  const [recLabel, recWhy] = d.recommend ? split2(d.recommend) : ['', null]
  const isRec = (name: string): boolean => !!recLabel && (name === recLabel || recLabel.startsWith(name) || name.startsWith(recLabel))
  return (
    <div className={'card' + (open ? ' open' : '')} data-decision={d.id}>
      <div className="row">
        <span className="id">{d.id}</span><span className={'pill ' + d.status}>{d.status}</span>
        {d.action && <span className="pill">{d.action}</span>}
        {forProduct(d) && <span className="pill product" title={d.product_note ?? ''}>Waiting on product</span>}
        {d.level !== 'ask' && <span className={'pill level-' + d.level} title={d.level === 'inform' ? 'Claude decided this because the code already settles it' : 'Implementation detail, only logged'}>{d.level === 'inform' ? 'Claude decided' : 'auto'}</span>}
        <span className="meta"><SessionLink b={b} id={d.session} /> · {time(d.created_at)}</span>
        {d.refs.map((r) => <span key={r} className="chip" title={b.decisions.find((x) => x.id === r)?.question}>↳ {r}</span>)}
      </div>
      <div className="q dq"><Linked text={q.lead} ticket={d.ticket} session={d.session} /></div>
      {context.length > 0 && (
        <div className="ctx"><div className="ctx-h">What&apos;s going on</div><ul>{context.map((c, i) => <li key={i}><Linked text={c} ticket={d.ticket} session={d.session} /></li>)}</ul></div>
      )}
      {forProduct(d) && (
        <div className="product-note"><b>Sent to product</b> <span className="meta">{time(d.product_at)}</span><div>{d.product_note}</div>
          <button onClick={() => run(() => window.api.board.backFromProduct(d.id))} title="Product answered elsewhere, or it no longer needs them">Back to me</button></div>
      )}
      {d.draft && (
        <div className="draft"><div className="row"><span className="ctx-h">Exact text</span><span className="grow" /><button onClick={() => void navigator.clipboard.writeText(d.draft!)}>Copy</button></div><Rich text={d.draft} clampAt={30} session={d.session} /></div>
      )}
      {d.options.length > 0 && !d.action && !split && !team && (
        <div className="opts">
          {d.options.map((o) => {
            const [name, what] = split2(o)
            const chosen = !!d.answer && (d.answer === o || d.answer === name)
            return (
              <div key={o} className={'opt' + (isRec(name) ? ' rec-opt' : '') + (chosen ? ' chosen' : '')}>
                <div className="opt-head"><b><Linked text={name} ticket={d.ticket} session={d.session} /></b>{isRec(name) && <span className="pill rec-pill">★ Recommended</span>}{chosen && <span className="pill answered">chosen</span>}</div>
                {what && <div className="opt-what"><Linked text={what} ticket={d.ticket} session={d.session} /></div>}
                {open && !d.action && <button className={isRec(name) ? 'primary' : ''} onClick={() => run(() => window.api.board.answer(d.id, name))}>Choose</button>}
              </div>
            )
          })}
        </div>
      )}
      {d.recommend && (recWhy || !d.options.some((o) => isRec(split2(o)[0]))) && (
        <div className="rec"><b>{recWhy ? `Why ${recLabel}:` : 'Recommended:'}</b> <Linked text={recWhy ?? d.recommend} ticket={d.ticket} session={d.session} /></div>
      )}
      {d.if_wrong && <div className="ifwrong"><b>If wrong:</b> {d.if_wrong}</div>}
      {d.evidence.length > 0 && <div className="evs"><div className="ctx-h">Evidence</div>{d.evidence.map((e) => <Evidence key={e} d={d} item={e} show={open} />)}</div>}
      {d.command && <pre className="cmd">$ {d.command}</pre>}
      {d.status === 'withdrawn' && <div className="msg"><b>Withdrawn:</b> {d.withdrawn_reason}</div>}
      {d.answer && <div className="answer"><b>{d.level === 'ask' ? 'Answer:' : 'Decided:'}</b> {d.answer}<div className="meta">{time(d.answered_at)} via {d.answered_by}</div></div>}
      <Delivery d={d} b={b} run={run} />
      {d.level !== 'ask' && (d.status === 'answered' || d.status === 'applied') && (
        <details className="ask">
          <summary>Object to this</summary>
          <textarea value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What should happen instead? It goes back to the session as an open question." />
          <button onClick={() => run(async () => { await window.api.board.object(d.id, ask); setAsk('') })}>Object</button>
        </details>
      )}
      {open && !forProduct(d) && !d.action && (
        <details className="ask">
          <summary>Open for product…</summary>
          <textarea value={productNote} onChange={(e) => setProductNote(e.target.value)} placeholder="What do you need from the product team? e.g. Confirm whether expired links should still show the amount." />
          <button disabled={!productNote.trim()} onClick={() => run(async () => { await window.api.board.forProduct(d.id, productNote); setProductNote('') })}>Mark open for product</button>
          <span className="meta"> It stops counting as waiting on you; the session parks it and keeps working.</span>
        </details>
      )}
      <details className="ask">
        <summary>{d.thread.length ? `Ask about this (${d.thread.length})` : 'Ask about this'}</summary>
        <Thread b={b} entries={d.thread} session={d.session} />
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything about this decision" />
        <button onClick={() => run(async () => { await window.api.board.ask(d.id, ask); setAsk('') })}>Ask</button>
        <span className="meta"> The session answers here once it reads its board messages.</span>
      </details>
      {open && d.action === 'consent' && (
        <div className="bar"><button className="primary" onClick={() => run(() => window.api.board.answer(d.id, 'Approve'))}>Approve</button>
          <button onClick={() => run(() => window.api.board.answer(d.id, 'Decline'))}>Decline</button></div>
      )}
      {open && d.action === 'terminal' && (
        <div className="bar">
          {onRun && <button className="primary" onClick={() => onRun(d)}>Run in its terminal</button>}
          <button onClick={() => navigator.clipboard.writeText(d.command || '')}>Copy</button>
          <button onClick={() => run(() => window.api.board.answer(d.id, 'Done: I ran it myself'))}>I ran it myself</button>
        </div>
      )}
      {open && split && <SplitPicker d={d} pieces={split} run={run} />}
      {team && <SetupPreview w={team} />}
      {open && team && (
        <div className="bar">
          <button className="primary" onClick={() => run(async () => { await window.api.workflows.adopt(d.id); window.dispatchEvent(new Event('workflows-changed')) })}>Create and use</button>
          <button onClick={() => run(() => window.api.board.answer(d.id, 'Not now'))}>Not now</button>
        </div>
      )}
      {open && !d.action && !split && !team && (other || !d.options.length) && (
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer in your own words" />
      )}
      {open && (
        <div className="bar">
          {!d.action && !split && !team && (other || !d.options.length
            ? <button className="primary" disabled={!text.trim()} onClick={() => run(() => window.api.board.answer(d.id, text))}>Send answer</button>
            : <button onClick={() => setOther(true)}>Something else…</button>)}
          <button onClick={() => run(() => window.api.board.withdraw(d.id, 'made moot by another answer'))}>Dismiss</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

function DiffView({ diff }: { diff: string }): React.JSX.Element {
  return <pre className="diff">{diff.split('\n').map((l, i) => (
    <div key={i} className={/^(\+\+\+|---|diff |index |#\s)/.test(l) ? 'dl-head' : l.startsWith('@@') ? 'dl-hunk' : l.startsWith('+') ? 'dl-add' : l.startsWith('-') ? 'dl-del' : ''}>{l || ' '}</div>
  ))}</pre>
}

export function ReviewCard({ r, b, refresh }: { r: Review; b: BoardState; refresh: () => void }): React.JSX.Element {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const open = r.status === 'open'
  const done = r.changes.filter((c) => c.verdict !== 'pending').length
  const run = async (fn: () => Promise<unknown>): Promise<void> => setErr(await act(fn, refresh))
  return (
    <div className={'card' + (open ? ' open' : '')}>
      <div className="row"><span className="id">{r.id} · review</span><span className={'pill ' + r.status}>{r.status.replace('_', ' ')}</span>
        <span className="meta"><SessionLink b={b} id={r.session} /> · {time(r.created_at)} · {done} of {r.changes.length} reviewed</span></div>
      <div className="q">{r.title}</div>
      {r.summary && <Rich text={r.summary} session={r.session} />}
      {r.changes.map((c) => (
        <div key={c.id} className="change">
          <div className="row"><code className="inl">{c.file}</code><span className={'pill ' + c.verdict}>{c.verdict}</span></div>
          <ChangeDiff review={r.id} change={c} />
          <Thread b={b} entries={c.thread} session={r.session} />
          {open && (
            <>
              <textarea value={notes[c.id] || ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} placeholder="Suggestion or question (required for Ask)" />
              <div className="bar">
                {(['accept', 'reject', 'question'] as const).map((v) => (
                  <button key={v} className={v === 'accept' && c.verdict !== 'accept' ? 'primary' : ''} onClick={() => run(() => window.api.board.verdict(r.id, c.id, v, notes[c.id]))}>
                    {v === 'question' ? 'Ask' : v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
                {c.verdict !== 'pending' && <button onClick={() => run(() => window.api.board.verdict(r.id, c.id, 'pending'))}>Undo</button>}
              </div>
            </>
          )}
        </div>
      ))}
      {r.note && <div className="msg">Your note: {r.note}</div>}
      {open && (
        <>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Overall note for the session (optional)" />
          <div className="bar">
            <button className="primary" onClick={() => run(() => window.api.board.submit(r.id, true, note))}>{done ? `Accept the ${r.changes.length - done} pending & submit` : 'Accept all & submit'}</button>
            <button disabled={done < r.changes.length} onClick={() => run(() => window.api.board.submit(r.id, false, note))}>Submit review</button>
          </div>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

type Piece = { title: string; task: string; role: string }

// Pick which pieces to start. Starting answers the decision with who is doing what; the cap is checked in main.
// Whether your latest answer or question on this decision reached its session, with a way to push it again.
function Delivery({ d, b, run }: { d: Decision; b: BoardState; run: (fn: () => Promise<unknown>) => Promise<void> }): React.JSX.Element | null {
  const m = [...b.messages].reverse().find((x) => x.decision_id === d.id)
  if (!m) return null
  const what = m.text.startsWith('The user asks') ? 'Your question' : 'Your answer'
  const how: Record<string, string> = { terminal: 'typed into its terminal', stop: 'at the end of its turn', wait: 'while it waited for your answer', inbox: 'from its inbox' }
  if (m.submitted_at) return <div className="delivery ok">✓ {what} reached the session · {time(m.submitted_at)}{m.via ? ` · ${how[m.via] ?? m.via}` : ''}</div>
  if (m.failed) return (
    <div className="delivery bad">⚠ {what} was {m.failed}.
      <button onClick={() => run(() => window.api.board.resend(m.id))}>Resend</button></div>
  )
  if (m.delivered_at) return <div className="delivery">… Typing {what.toLowerCase()} into the session</div>
  return (
    <div className="delivery wait">{what} has not reached the session yet. It is sent once the session is idle and ready.
      <button onClick={() => run(() => window.api.board.deliver(m.session))} title="Starts the session if it is not running">Send now</button></div>
  )
}

function SplitPicker({ d, pieces, run }: { d: Decision; pieces: Piece[]; run: (fn: () => Promise<unknown>) => Promise<void> }): React.JSX.Element {
  const [keep, setKeep] = useState(() => pieces.map((_, i) => i))
  const toggle = (i: number): void => setKeep(keep.includes(i) ? keep.filter((k) => k !== i) : [...keep, i].sort())
  return (
    <div className="split-pick">
      {pieces.map((p, i) => (
        <label key={i} className="inline split-piece">
          <input type="checkbox" checked={keep.includes(i)} onChange={() => toggle(i)} />
          <span className="pill">{p.role}</span><b>{p.title}</b><span className="meta">{p.task}</span>
        </label>
      ))}
      <div className="bar">
        <button className="primary" disabled={!keep.length} onClick={() => run(() => window.api.chat.startSplit(d.id, keep))}>Start {keep.length} session{keep.length === 1 ? '' : 's'}</button>
        <button onClick={() => run(() => window.api.board.answer(d.id, 'Not now'))}>Not now</button>
      </div>
    </div>
  )
}

// A review file's diff. Closed reviews arrive without it (keeps the board small); it is fetched when expanded.
function ChangeDiff({ review, change }: { review: string; change: Change }): React.JSX.Element {
  const [fetched, setFetched] = useState<string | null>(null)
  const diff = change.diff ?? fetched
  const load = (open: boolean): void => {
    if (open && diff === null) void window.api.board.reviewDiff(review, change.id).then(setFetched)
  }
  return (
    <details open={change.diff !== null && change.lines <= 40} onToggle={(e) => load((e.target as HTMLDetailsElement).open)}>
      <summary className="meta">Diff ({change.lines} lines)</summary>
      {diff !== null ? <DiffView diff={diff} /> : <div className="meta">Loading…</div>}
    </details>
  )
}

