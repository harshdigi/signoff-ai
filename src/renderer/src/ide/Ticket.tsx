// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import type { BoardState, Subtask, Ticket } from '../board/types'
import { base, errText } from './types'

// Ticket pipeline (IDE/D16 C): plan -> decisions -> subtasks -> branch + worktree + chat each -> review -> PR.

export function StartTicket({ close, started }: { close: () => void; started: (key: string, session: string) => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const go = (): void => {
    window.api.tickets.start(key.trim(), title.trim(), desc).then((r: { ticket: Ticket; session: string }) => { started(r.ticket.key, r.session); close() }, (e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Start a ticket</h3>
        <div className="field"><div className="label">Issue key</div><input autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="ABC-1234" /></div>
        <div className="field"><div className="label">Title (optional)</div><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field">
          <div className="label">Ticket text (optional)</div>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Paste the ticket here, or leave empty: Claude reads it with your Jira tool if one is connected, or asks you for it." />
        </div>
        <p className="meta">A planning chat opens. Claude reads the code, posts decisions, then proposes subtasks. Each subtask later gets its own branch, worktree and chat.</p>
        <div className="bar"><button className="primary" disabled={!key.trim()} onClick={go}>Start planning</button><button onClick={close}>Cancel</button></div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  )
}

const STEPS = ['Plan', 'Subtasks', 'Implement', 'Review', 'PR'] as const

export function TicketView({ t, b, openChat }: { t: Ticket; b: BoardState; openChat: (session: string) => void }): React.JSX.Element {
  const [err, setErr] = useState<string | null>(null)
  const decisions = b.decisions.filter((d) => d.ticket === t.key)
  const open = decisions.filter((d) => d.status === 'open').length
  const subs = t.subtasks
  const step = !subs.length ? 0 : subs.every((s) => s.status === 'done') ? 4 : subs.some((s) => s.status === 'review') ? 3 : subs.some((s) => s.status !== 'planned') ? 2 : 1
  const act = (p: Promise<unknown>): void => {
    setErr(null)
    p.catch((e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="view">
      <div className="session-head">
        <div className="row"><span className="id">{t.key}</span>{t.title && <span>{t.title}</span>}<span className="meta">{t.strategy === 'stacked' ? 'stacked branches' : 'each subtask from the base branch'} · {base(t.folder)}</span>
          <span className="grow" />
          {t.closed_at
            ? <><span className="meta">Closed</span><button className="sm" onClick={() => act(window.api.tickets.reopen(t.key))}>Reopen</button></>
            : <button className="sm" title="Stops and removes its sessions; branches and worktrees stay. Reopen undoes it." onClick={() => act(window.api.tickets.close(t.key))}>Close ticket</button>}
        </div>
      </div>
      <div className="steps">{STEPS.map((s, i) => <span key={s} className={'step' + (i < step ? ' done' : i === step ? ' on' : '')}>{i + 1}. {s}</span>)}</div>

      <h2>Plan</h2>
      <div className="bar">
        {t.plan_session && <button onClick={() => openChat(t.plan_session!)}>Open planning chat</button>}
        <span className="meta">{decisions.length} decisions · {open ? <b className="warnt">{open} waiting on you</b> : 'none waiting'}</span>
      </div>

      <h2>Subtasks ({subs.length})</h2>
      {!subs.length && <p className="empty">None yet. The planning chat adds them once the decisions it needs are settled.</p>}
      {subs.map((s) => <SubtaskRow key={s.idx} t={t} s={s} prev={subs.find((x) => x.idx === s.idx - 1)} openChat={openChat} act={act} b={b} />)}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

function SubtaskRow({ t, s, prev, openChat, act, b }: { t: Ticket; s: Subtask; prev?: Subtask; openChat: (id: string) => void; act: (p: Promise<unknown>) => void; b: BoardState }): React.JSX.Element {
  const blocked = t.strategy === 'stacked' && !!prev && !prev.branch
  const waiting = s.decisions.filter((id) => b.decisions.find((d) => d.id === id)?.status === 'open').length
  return (
    <div className="card subtask">
      <div className="row">
        <span className="id">#{s.idx}</span><span className="q">{s.title}</span>
        <span className={'pill ' + s.status}>{s.status.replace('_', ' ')}</span>
        {s.jira_key && <span className="chip">{s.jira_key}</span>}
      </div>
      <div className="meta">
        {s.decisions.length ? `Implements ${s.decisions.join(', ')}` : 'No decisions linked'}{waiting ? ` · ${waiting} still open` : ''}
        {s.branch && <> · ⎇ {s.branch}</>}
      </div>
      <div className="bar">
        {s.status === 'planned' && <button className="primary" disabled={blocked} title={blocked ? `Stacked: start #${prev!.idx} first` : 'Create the branch and worktree, and start a chat there'} onClick={() => act(window.api.tickets.startSubtask(t.key, s.idx))}>Start</button>}
        {s.session_id && <button onClick={() => openChat(s.session_id!)}>Open chat</button>}
        {(s.status === 'in_progress' || s.status === 'review') && <button onClick={() => act(window.api.tickets.openPr(t.key, s.idx))}>Open PR</button>}
        {s.status === 'in_progress' && <button onClick={() => act(window.api.tickets.setStatus(t.key, s.idx, 'review'))}>Ready for review</button>}
        {s.status === 'review' && <button onClick={() => act(window.api.tickets.setStatus(t.key, s.idx, 'done'))}>Mark done</button>}
      </div>
    </div>
  )
}
