// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState } from 'react'
import { SessionView } from '../board/Views'
import { label, waitingOn, type BoardState, type Session } from '../board/types'
import BottomPanel from './BottomPanel'
import TestPlan from './TestPlan'
import Ship from './Ship'
import Story from './Story'
import AutonomyPanel from '../chat/AutonomyPanel'
import DiscussSwitch from '../chat/DiscussSwitch'
import { toRows, toolSummary, type ToolRow } from '../chat/transcript'
import { errText, type Term, type Workflow } from './types'
import { Icon } from './icons'

// One session, in tabs (IDE/D20): Chat, Files changed, Decisions, Agents, Terminals.
// - Chat and Files changed are passed in, so the chat stays mounted (the toolbar sends to it) on any tab.
export type SessionTab = 'chat' | 'files' | 'tests' | 'ship' | 'story' | 'decisions' | 'agents' | 'terminals'

type Props = {
  session: Session | null; workflow: Workflow | null; board: BoardState; refresh: () => void
  tab: SessionTab; setTab: (t: SessionTab) => void
  chat: React.ReactNode; files: React.ReactNode
  terms: Term[]; term: string | null; setTerm: (id: string) => void; newShell: () => void; closeTerm: (id: string) => void
  open: (session: string) => void
  ask: (text: string) => void  // send to this session's chat
  startTerminal: () => void // start (or attach) this session's Claude terminal
}

export default function SessionPage({ session: s, board, refresh, tab, setTab, chat, files, terms, term, setTerm, newShell, closeTerm, open, ask, startTerminal }: Props): React.JSX.Element {
  const waiting = s ? waitingOn(board, s.id) : 0
  const children = s ? board.sessions.filter((c) => c.parent_id === s.id && !c.archived) : []
  const plan = s ? board.tests.filter((t) => t.plan === (s.ticket ?? s.id)) : []
  const running = terms.filter((t) => !t.exited).length
  const [err, setErr] = useState<string | null>(null)
  // Opening Terminals starts the session's Claude terminal when it has none yet (a session the chat can type into).
  const hasClaudeTerm = !!s && terms.some((t) => t.session === s.id && !t.exited)
  // Once per session until its terminal shows up, so a slow start is not asked for twice.
  const asked = useRef<string | null>(null)
  useEffect(() => { if (hasClaudeTerm) asked.current = null }, [hasClaudeTerm])
  useEffect(() => {
    if (tab !== 'terminals' || !s || !(s.via === 'chat' || s.tmux) || hasClaudeTerm || asked.current === s.id) return
    asked.current = s.id
    startTerminal()
  }, [tab, s, hasClaudeTerm, startTerminal])
  const tabs: [SessionTab, string, number | null][] = [
    ['chat', 'Chat', null], ['files', 'Files changed', null], ['tests', 'Test plan', plan.length ? plan.filter((t) => t.status === 'pass').length : null], ['ship', 'Ship', null], ['story', 'Story', null], ['decisions', 'Decisions', waiting || null],
    ['agents', 'Agents', children.length || null], ['terminals', 'Terminals', running || null]
  ]
  return (
    <div className="session-page">
      <div className="subtabs session-tabs">
        {tabs.map(([k, name, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{name}{n !== null && <span className={k === 'decisions' ? 'count' : 'n'}>{n}</span>}</button>
        ))}
        <span className="tabs-right"><DiscussSwitch session={s?.id ?? null} /><AutonomyPanel session={s?.id ?? null} place="down" /></span>
        {err && <span className="err">{err}</span>}
      </div>
      <div className="session-body">
        <div className="session-pane" hidden={tab !== 'chat'}>{chat}</div>
        <div className="session-pane" hidden={tab !== 'files'}>{files}</div>
        {tab === 'decisions' && (s ? <SessionView s={s} b={board} refresh={refresh} terminal={null} /> : <p className="empty pad">Decisions show here once the chat has started.</p>)}
        {tab === 'tests' && (s ? <TestPlan s={s} b={board} ask={ask} openChat={() => setTab('chat')} /> : <p className="empty pad">The test plan starts once the chat has.</p>)}
        {tab === 'ship' && (s ? <Ship s={s} b={board} ask={ask} openChat={() => setTab('chat')} /> : <p className="empty pad">Nothing to ship yet.</p>)}
        {tab === 'story' && (s ? <Story session={s.id} /> : <p className="empty pad">The story starts once the chat has.</p>)}
        {tab === 'agents' && <AgentsTab s={s} subs={children} open={open} />}
        {/* The session's Claude terminal plus shells opened for it; several can run at once. */}
        {tab === 'terminals' && <BottomPanel terms={terms} active={term} setActive={setTerm} close={closeTerm} newShell={s ? newShell : undefined}
          empty={s ? 'Starting this session\'s terminal…' : 'No terminal yet. It starts with the first message.'}
          actions={s?.tmux && <button className="row-act" title="Open this session in a Terminal window too; both stay live" onClick={() => void window.api.chat.openInTerminal(s.id).then(() => setErr(null), (e: unknown) => setErr(errText(e)))}><Icon name="external" /></button>} />}
      </div>
    </div>
  )
}

// Agents: helper agents Claude starts inside this session (Agent / Task tool calls), and child sessions.
function AgentsTab({ s, subs, open }: { s: Session | null; subs: Session[]; open: (id: string) => void }): React.JSX.Element {
  const [loaded, setAgents] = useState<{ session: string; rows: ToolRow[] } | null>(null)
  // Rows loaded for another session are not shown.
  const agents = s && loaded?.session === s.id ? loaded.rows : []
  useEffect(() => {
    if (!s) return
    const load = (): void => void window.api.chat.history(s.id).then((ev: never[]) =>
      setAgents({ session: s.id, rows: toRows(ev).filter((r): r is ToolRow => r.kind === 'tool' && (r.name === 'Agent' || r.name === 'Task')) }))
    load()
    return window.api.chat.onEvent((e: { session: string }) => e.session === s.id && load())
  }, [s])
  return (
    <div className="view">
      <h2>Child sessions ({subs.length})</h2>
      {subs.length ? subs.map((c) => (
        <div key={c.id} className="side-item" onClick={() => open(c.id)}>
          <span className={'pill ' + c.state}>{c.state}</span>{c.role && <span className="pill">{c.role}</span>}<span className="name">{label(c)}</span><span className="dir">{c.description || c.note || ''}</span>
        </div>
      )) : <p className="empty">None. Sessions this one hands work to show here.</p>}
      <h2>Helper agents in this chat ({agents.length})</h2>
      {agents.length ? [...agents].reverse().map((a) => (
        <div key={a.id} className="side-item">
          <span className={'pill ' + (a.result === undefined ? 'working' : a.isError ? 'failed' : 'done')}>{a.result === undefined ? 'running' : a.isError ? 'failed' : 'done'}</span>
          <span className="name">{toolSummary(a.name, a.input)}</span>
        </div>
      )) : <p className="empty">None yet. Claude starts these for searches and side tasks.</p>}
    </div>
  )
}
