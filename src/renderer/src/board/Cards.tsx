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
import { ago, forLater, forProduct, label, time, type BoardState, type Change, type Decision, type Review, type ThreadEntry } from './types'
import { CodeDiff, CodeLine, CodePre } from '../ide/CodeBlock'
import { useColoredLines } from '../ide/use-colored-lines'
import { languageForPath } from '../ide/languages'
import { Chev } from '../ide/icons'

// The session a card came from, as a link to its chat. A session no longer on the board stays plain text.
function SessionLink({ b, id }: { b: BoardState; id: string | null }): React.JSX.Element {
  const s = b.sessions.find((x) => x.id === id)
  if (!s) return <>{label(s)}</>
  return <button className="link sess-link" title="Open this session's chat" onClick={() => window.dispatchEvent(new CustomEvent('open-session', { detail: s.id }))}>↗ {label(s)}</button>
}

const who = (b: BoardState, t: ThreadEntry): string => (t.who === 'you' ? 'You' : t.who === 'board' ? 'Signoff AI' : label(b.sessions.find((s) => s.id === t.who)))

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
  const colored = useColoredLines(snip?.lines.map((l) => l.text) ?? [], snip ? languageForPath(snip.file) : null)
  useEffect(() => {
    if (open && snip === undefined && d.session) void window.api.evidence(d.session, ref).then(setSnip, () => setSnip(null))
  }, [open, snip, d.session, ref])
  return (
    <div className="ev2">
      {/* One row per place: the file's name, its lines, and what they show; click to see the code under it. */}
      <button className="ev-row" onClick={() => setOpen(!open)} title={`${ref}: show or hide the code`}>
        <Chev open={open} /><span className="fn">{ref.replace(/:[\d-]+$/, '').split('/').pop()}</span>
        {/:(\d+(?:-\d+)?)$/.exec(ref) && <span className="meta">{/-/.test(/:([\d-]+)$/.exec(ref)![1]) ? 'lines' : 'line'} {/:([\d-]+)$/.exec(ref)![1].replace('-', '–')}</span>}
        {note && <span className="ev-note">{note}</span>}
      </button>
      {open && snip && <pre className="snip">{snip.lines.map((l, i) => <div key={l.n} className={l.n >= snip.from && l.n <= snip.to ? 'hit' : ''}><span className="ln">{l.n}</span><CodeLine html={colored?.[i]} text={l.text} /></div>)}</pre>}
      {open && snip === null && <div className="meta">Could not show this code (no line number, or the file is not in the session folder).</div>}
    </div>
  )
}

export function DecisionCard({ d, b, refresh, onRun, startOpen }: { d: Decision; b: BoardState; refresh: () => void; onRun?: (d: Decision) => void; startOpen?: boolean }): React.JSX.Element {
  const [text, setText] = useState('')
  const [panel, setPanel] = useState<'other' | 'ask' | 'product' | 'more' | null>(null)
  const [ask, setAsk] = useState('')
  const [productNote, setProductNote] = useState('')
  const [allContext, setAllContext] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const open = d.status === 'open'
  // A settled card (answered, applied, withdrawn) folds to one line; click it to see everything again.
  const [shown, setShown] = useState(open || !!startOpen)
  const run = async (fn: () => Promise<unknown>): Promise<void> => setErr(await act(fn, refresh))
  // A team lead's proposed split (IDE/D22): pieces you can drop before starting them.
  const split = d.kind === 'split' && d.item ? (JSON.parse(d.item) as { pieces: Piece[] }).pieces : null
  // A session's proposed team setup (signoff team propose): shown in full, approved with one click.
  const team = d.kind === 'team' && d.item ? (JSON.parse(d.item) as Omit<Workflow, 'builtIn' | 'line'>) : null
  const q = unpack(d.question)
  const context = [...(d.context ?? []), ...q.points]
  const [recLabel, recWhy] = d.recommend ? split2(d.recommend) : ['', null]
  const isRec = (name: string): boolean => !!recLabel && (name === recLabel || recLabel.startsWith(name) || name.startsWith(recLabel))
  const recShown = d.options.some((o) => isRec(split2(o)[0]))
  const plain = !d.action && !split && !team // an ordinary question: pick an option or say something else
  const how = ({ chat: 'decided in the chat', board: 'answered here', terminal: 'answered in the terminal' } as Record<string, string>)[d.answered_by ?? ''] ?? `via ${d.answered_by}`
  if (!shown) return (
    <button className="card card-line" data-decision={d.id} onClick={() => setShown(true)} title="Show the whole decision">
      <span className={'line-mark ' + d.status}>{d.status === 'withdrawn' ? '–' : '✓'}</span>
      <span className="id">{d.id.split('/').pop()}</span><span className="line-q">{q.lead}</span>
      <span className="line-a">{d.status === 'withdrawn' ? `withdrawn: ${d.withdrawn_reason ?? ''}` : d.answer}</span>
      <span className="meta">{d.status === 'withdrawn' ? '' : how}</span>
    </button>
  )
  return (
    <div className={'card' + (open ? ' open' : '')} data-decision={d.id}>
      <div className="q dq"><Linked text={q.lead} ticket={d.ticket} session={d.session} /></div>
      <div className="meta card-meta">
        {d.id} · <SessionLink b={b} id={d.session} /> · <span title={time(d.created_at)}>{ago(d.created_at)}</span>
        {!open && <span className={'pill ' + d.status}>{d.status}</span>}
        {d.action && <span className="pill">{d.action}</span>}
        {forProduct(d) && <span className="pill product" title={d.product_note ?? ''}>Waiting on product</span>}
        {forLater(d) && <span className="pill later">Later</span>}
        {d.level !== 'ask' && <span className={'pill level-' + d.level} title={d.level === 'inform' ? 'Claude decided this because the code already settles it' : 'Implementation detail, only logged'}>{d.level === 'inform' ? 'Claude decided' : 'auto'}</span>}
        {d.refs.map((r) => <span key={r} className="chip" title={b.decisions.find((x) => x.id === r)?.question}>↳ {r}</span>)}
        {!open && <button className="link" onClick={() => setShown(false)}>Fold</button>}
      </div>
      {context.length > 0 && (
        <ul className="card-ctx">
          {(allContext ? context : context.slice(0, 3)).map((c, i) => <li key={i}><Linked text={c} ticket={d.ticket} session={d.session} /></li>)}
          {context.length > 3 && !allContext && <li className="more-li"><button className="link" onClick={() => setAllContext(true)}>Show {context.length - 3} more</button></li>}
        </ul>
      )}
      {forProduct(d) && (
        <div className="product-note"><b>Sent to product</b> <span className="meta">{time(d.product_at)}</span><div>{d.product_note}</div>
          <button onClick={() => run(() => window.api.board.backFromProduct(d.id))} title="Product answered elsewhere, or it no longer needs them">Back to me</button></div>
      )}
      {d.draft && (
        <div className="draft"><div className="row"><span className="ctx-h">Exact text</span><span className="grow" /><button onClick={() => void navigator.clipboard.writeText(d.draft!)}>Copy</button></div><Rich text={d.draft} clampAt={30} session={d.session} /></div>
      )}
      {d.options.length > 0 && plain && (
        <div className="opts">
          {d.options.map((o) => {
            const [name, what] = split2(o)
            const chosen = !!d.answer && (d.answer === o || d.answer === name)
            const rec = isRec(name)
            return (
              // A whole option is the button: click it to choose it.
              <div key={o} className={'opt' + (rec ? ' rec-opt' : '') + (chosen ? ' chosen' : '') + (open ? ' pick' : '')} role={open ? 'button' : undefined}
                title={open ? `Choose: ${name}` : undefined} onClick={open ? () => run(() => window.api.board.answer(d.id, name)) : undefined}>
                <div className="opt-head"><b>{rec ? '★ ' : ''}<Linked text={name} ticket={d.ticket} session={d.session} /></b>{chosen && <span className="pill answered">chosen</span>}</div>
                {what && <div className="opt-what"><Linked text={what} ticket={d.ticket} session={d.session} /></div>}
                {rec && (recWhy || d.if_wrong) && <div className="opt-why">{recWhy && <>Why: <Linked text={recWhy} ticket={d.ticket} session={d.session} /></>}{recWhy && d.if_wrong ? ' · ' : ''}{d.if_wrong && <>If wrong: {d.if_wrong}</>}</div>}
              </div>
            )
          })}
        </div>
      )}
      {d.recommend && !recShown && <div className="rec"><b>Recommended:</b> <Linked text={recWhy ?? d.recommend} ticket={d.ticket} session={d.session} /></div>}
      {d.if_wrong && !recShown && <div className="ifwrong"><b>If wrong:</b> {d.if_wrong}</div>}
      {d.evidence.length > 0 && (
        <div className="file-box code-box">
          <div className="code-head"><b>Code it refers to</b><span className="meta">{d.evidence.length} place{d.evidence.length === 1 ? '' : 's'}</span></div>
          {d.evidence.map((e) => <Evidence key={e} d={d} item={e} show={false} />)}
        </div>
      )}
      {d.command && <CodePre className="cmd" code={d.command} language="shell" />}
      {d.status === 'withdrawn' && (
        <div className="msg"><b>Withdrawn:</b> {d.withdrawn_reason}{' '}
          <button onClick={() => run(() => window.api.board.reopen(d.id))} title="Open it again; its session is told to wait for your answer">Reopen</button></div>
      )}
      {d.answer && <div className="answer"><b>{d.level === 'ask' ? 'Answer:' : 'Decided:'}</b> {d.answer}<div className="meta">{time(d.answered_at)} · {how}</div></div>}
      <Delivery d={d} b={b} run={run} />
      {d.level !== 'ask' && (d.status === 'answered' || d.status === 'applied') && (
        <details className="ask">
          <summary>Object to this</summary>
          <textarea value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What should happen instead? It goes back to the session as an open question." />
          <button onClick={() => run(async () => { await window.api.board.object(d.id, ask); setAsk('') })}>Object</button>
        </details>
      )}
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
      {panel === 'other' && (
        <div className="file-ask">
          <div className="meta">What do you want instead? Words, code, or both.</div>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          <div className="bar"><button className="sm primary" disabled={!text.trim()} onClick={() => run(async () => { await window.api.board.answer(d.id, text); setPanel(null) })}>Send to Claude</button>
            <button className="sm" onClick={() => setPanel(null)}>Cancel</button></div>
        </div>
      )}
      {panel === 'ask' && (
        <div className="file-ask">
          <Thread b={b} entries={d.thread} session={d.session} />
          <textarea autoFocus value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask anything about this decision" />
          <div className="bar"><button className="sm primary" disabled={!ask.trim()} onClick={() => run(async () => { await window.api.board.ask(d.id, ask); setAsk('') })}>Ask</button>
            <button className="sm" onClick={() => setPanel(null)}>Close</button><span className="meta">The session answers here once it reads its board messages.</span></div>
        </div>
      )}
      {panel !== 'ask' && d.thread.length > 0 && <button className="link thread-link" onClick={() => setPanel('ask')}>{d.thread.length} message{d.thread.length === 1 ? '' : 's'} about this</button>}
      {panel === 'product' && (
        <div className="file-ask">
          <div className="meta">What do you need from the product team? It stops counting as waiting on you; the session parks it.</div>
          <textarea autoFocus value={productNote} onChange={(e) => setProductNote(e.target.value)} placeholder="e.g. Confirm whether expired links should still show the amount." />
          <div className="bar"><button className="sm primary" disabled={!productNote.trim()} onClick={() => run(async () => { await window.api.board.forProduct(d.id, productNote); setProductNote(''); setPanel(null) })}>Mark open for product</button>
            <button className="sm" onClick={() => setPanel(null)}>Cancel</button></div>
        </div>
      )}
      {open && (
        <div className="bar card-acts">
          {plain && <button onClick={() => setPanel(panel === 'other' ? null : 'other')}>{d.options.length ? 'Something else…' : 'Answer…'}</button>}
          <button onClick={() => setPanel(panel === 'ask' ? null : 'ask')}>💬 Ask</button>
          <span className="grow" />
          <span className="more-wrap">
            <button className="sm" title="Later · Open for product · Dismiss" onClick={() => setPanel(panel === 'more' ? null : 'more')}>⋯</button>
            {panel === 'more' && (
              <div className="dropdown right">
                {forLater(d)
                  ? <div onClick={() => run(() => window.api.board.bringBack(d.id))}>Bring back <span className="meta">to Waiting on you</span></div>
                  : !forProduct(d) && <div onClick={() => run(() => window.api.board.setAside(d.id))}>Later <span className="meta">not now; answer it from Decisions</span></div>}
                {plain && !forProduct(d) && <div onClick={() => setPanel('product')}>Open for product…</div>}
                <div onClick={() => run(() => window.api.board.withdraw(d.id, 'made moot by another answer'))}>Dismiss <span className="meta">you can reopen it from the history</span></div>
              </div>
            )}
          </span>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

export function ReviewCard({ r, b, refresh }: { r: Review; b: BoardState; refresh: () => void }): React.JSX.Element {
  const [note, setNote] = useState('')
  const [noting, setNoting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const open = r.status === 'open'
  const done = r.changes.filter((c) => c.verdict !== 'pending').length
  const left = r.changes.length - done
  const run = async (fn: () => Promise<unknown>): Promise<void> => setErr(await act(fn, refresh))
  return (
    <div className={'card review-card' + (open ? ' open' : '')}>
      <div className="q">{r.title}</div>
      <div className="meta card-meta">
        {r.id} · <SessionLink b={b} id={r.session} /> · {r.changes.length} file{r.changes.length === 1 ? '' : 's'}{done ? ` · ${done} reviewed` : ''} · <span title={time(r.created_at)}>{ago(r.created_at)}</span>
        {!open && <span className={'pill ' + r.status}>{r.status.replace('_', ' ')}</span>}
      </div>
      {r.summary && <div className="card-summary"><Rich text={r.summary} session={r.session} /></div>}
      {r.changes.map((c) => <ReviewFile key={c.id} r={r} c={c} b={b} run={run} />)}
      {r.note && <div className="msg">Your note: {r.note}</div>}
      {open && (
        <>
          {noting && <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note to the session about the whole review (optional)" />}
          <div className="bar">
            <button className="primary" disabled={left > 0} title={left ? `Review the ${left} file${left === 1 ? '' : 's'} left first` : 'Send your verdicts to the session'} onClick={() => run(() => window.api.board.submit(r.id, false, note))}>Submit review</button>
            <button onClick={() => run(() => window.api.board.submit(r.id, true, note))}>{done ? `Accept the ${left} left & submit` : 'Accept all'}</button>
            <span className="grow" />
            {!noting && <button className="sm" onClick={() => setNoting(true)}>+ Note for the session</button>}
          </div>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// One file of a review, framed: its name, lines added and removed and its status; opened, the diff, the conversation
// about it and its own buttons. Ask for changes (a reject with what you want instead) is how you ask for something
// different; Drop is a reject that says to leave the change out.
const DROP = 'Drop this change: leave this file out.'
const fileStatus = (c: Change): [string, string] =>
  c.verdict === 'accept' ? ['accepted', 'ok'] : c.verdict === 'reject' ? (c.comment === DROP ? ['dropped', 'bad'] : ['changes asked', 'warn'])
  : c.verdict === 'question' ? ['question asked', 'warn'] : ['not reviewed', '']
function ReviewFile({ r, c, b, run }: { r: Review; c: Change; b: BoardState; run: (fn: () => Promise<unknown>) => Promise<void> }): React.JSX.Element {
  const [opened, setOpened] = useState(false)
  const [asking, setAsking] = useState<'reject' | 'question' | null>(null)
  const [text, setText] = useState('')
  const [fetched, setFetched] = useState<string | null>(null)
  const diff = c.diff ?? fetched
  const toggle = (): void => {
    if (!opened && diff === null) void window.api.board.reviewDiff(r.id, c.id).then(setFetched)
    setOpened(!opened)
  }
  const added = diff ? diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length : null
  const removed = diff ? diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length : null
  const [status, tone] = fileStatus(c)
  const send = (v: 'accept' | 'reject' | 'question' | 'pending', comment?: string): void => {
    void run(() => window.api.board.verdict(r.id, c.id, v, comment)).then(() => { setAsking(null); setText('') })
  }
  return (
    <div className="file-box">
      <button className="file-head" onClick={toggle} title={opened ? 'Fold' : 'Show the diff, the conversation and the buttons'}>
        <Chev open={opened} /><span className="fn">{c.file}</span>
        {added !== null ? <><span className="plus">+{added}</span><span className="minus">−{removed}</span></> : <span className="meta">{c.lines} lines</span>}
        {c.thread.length > 0 && <span className="meta">· {c.thread.length} repl{c.thread.length === 1 ? 'y' : 'ies'}</span>}
        <span className="grow" /><span className={'fstat ' + tone}>{status}</span>
      </button>
      {opened && (
        <>
          {diff !== null ? <CodeDiff diff={diff} language={languageForPath(c.file)} /> : <div className="meta pad-s">Loading…</div>}
          {c.thread.length > 0 && <div className="file-thread"><Thread b={b} entries={c.thread} session={r.session} /></div>}
          {asking && (
            <div className="file-ask">
              <div className="meta">{asking === 'reject' ? 'What should it be instead? Words, code, or both.' : 'Your question about this file'}</div>
              <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} />
              <div className="bar">
                <button className="sm primary" disabled={!text.trim()} onClick={() => send(asking, text)}>Send to Claude</button>
                <button className="sm" onClick={() => setAsking(null)}>Cancel</button>
                <span className="meta">{asking === 'reject' ? 'Claude reworks the file and proposes it again.' : 'Claude answers here.'}</span>
              </div>
            </div>
          )}
          {r.status === 'open' && (
            <div className="file-acts">
              <button className="sm ok" onClick={() => send('accept')}>✓ Accept</button>
              <button className="sm warn" onClick={() => setAsking('reject')}>✎ Ask for changes</button>
              <button className="sm" onClick={() => setAsking('question')}>💬 Question</button>
              {c.verdict !== 'pending' && <button className="sm" onClick={() => send('pending')}>Undo</button>}
              <span className="grow" />
              <button className="sm bad" title="You do not want this change at all" onClick={() => send('reject', DROP)}>Drop this file</button>
            </div>
          )}
        </>
      )}
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


