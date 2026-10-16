// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Fragment, useEffect, useState } from 'react'
import { forLater, forProduct, waitingOn, type BoardState } from '../board/types'
import { base, errText, itemKey, type CatalogItem, type EditorTab, type Pin } from './types'
import { SideHead } from './SideHead'
import { Chev } from './icons'
import { Menu } from './Menu'

export type View = 'decisions' | 'sessions' | 'search' | 'run' | 'mcps' | 'workflows' | 'skills'


// Open items per session (IDE/D20): click one to go to that session's Decisions tab; "All decisions" opens the overview.
export function DecisionsSideView({ board, openSession, openAll }: { board: BoardState; openSession: (id: string) => void; openAll: () => void }): React.JSX.Element {
  const live = board.sessions.filter((s) => !s.archived)
  const count = (sid: string): number => waitingOn(board, sid)
  const waiting = live.filter((s) => count(s.id) > 0)
  const product = board.decisions.filter(forProduct)
  const later = board.decisions.filter(forLater)
  return (
    <div className="side-body">
      <SideHead title="DECISIONS" actions={[{ icon: 'list', title: 'All decisions: everything waiting, plus history', onClick: openAll }]} />
      <div className="side-group">Waiting on you</div>
      {waiting.length === 0 && <div className="side-empty">Nothing waiting on you.</div>}
      {waiting.map((s) => (
        <div key={s.id} className="side-item" onClick={() => openSession(s.id)}>
          <span className={'state-dot ' + s.state} /><span className="name">{s.title || s.ticket || s.id.slice(0, 8)}</span><span className="count">{count(s.id)}</span>
        </div>
      ))}
      {product.length > 0 && (
        <>
          <div className="side-group">Waiting on product</div>
          {product.map((d) => (
            <div key={d.id} className="side-item" onClick={openAll} title={d.product_note ?? ''}><span className="st pending">P</span><span className="name">{d.id}</span><span className="dir">{d.question}</span></div>
          ))}
        </>
      )}
      {later.length > 0 && (
        <>
          <div className="side-group">Later</div>
          {later.map((d) => (
            <div key={d.id} className="side-item" onClick={openAll}><span className="st">L</span><span className="name">{d.id}</span><span className="dir">{d.question}</span></div>
          ))}
        </>
      )}
    </div>
  )
}

// Sessions (IDE/D20): tickets, then every Claude session in this folder (and its worktrees), wherever it was started.
// Sessions started in a Terminal window carry a tag. Each has Rename and Remove; removed ones are hidden, not deleted.
const inFolder = (cwd: string | null, folder: string | null): boolean => !!cwd && !!folder && (cwd === folder || cwd.startsWith(folder + '/'))
// Where a session runs, when that is not the open folder itself: "api-service". Claude Code loads MCPs and
// settings from that folder, so it can differ from a session started here.
const subfolder = (cwd: string | null, folder: string | null): string | null => (cwd && folder && cwd !== folder && cwd.startsWith(folder + '/') ? cwd.slice(folder.length + 1) : null)
// A worktree (<repo>/.claude/worktrees/<branch>) shows as "api-service ⎇ worktree"; the full path is in the tooltip.
export function SessionsView({ board, folder, current, openSession, newSession, resume, openTab }: {
  board: BoardState; folder: string | null; current: string | null; openSession: (id: string) => void; newSession: () => void; resume: () => void; openTab: (t: EditorTab) => void
}): React.JSX.Element {
  const [showRemoved, setShowRemoved] = useState(false)
  const here = board.sessions.filter((s) => inFolder(s.cwd, folder) && !s.archived)
  const removed = board.sessions.filter((s) => s.archived && inFolder(s.cwd, folder))
  const open = (sid: string): number => waitingOn(board, sid)
  const removeIt = (id: string): void => {
    void window.api.sessions.remove(id)
    if (current === id) newSession()
  }
  // Grouped (default): a session started by another (a team's members, a ticket's subtask sessions, a handoff) sits
  // under it, collapsible. Individual: one line each. The choice is remembered on this computer only.
  const [view, setViewState] = useState<'grouped' | 'flat'>(() => {
    try {
      return localStorage.getItem('sessions-view') === 'flat' ? 'flat' : 'grouped'
    } catch {
      return 'grouped' // storage unavailable: grouped, as by default
    }
  })
  const setView = (v: 'grouped' | 'flat'): void => {
    setViewState(v)
    try { localStorage.setItem('sessions-view', v) } catch { /* not remembered; the list still switches */ }
  }
  const grouped = view === 'grouped'
  const place = (cwd: string | null): string | null => {
    const sub = subfolder(cwd, folder)
    const i = sub?.indexOf('/.claude/worktrees/') ?? -1
    return sub && i >= 0 ? `${sub.slice(0, i)} ⎇ worktree` : sub
  }
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const ids = new Set(here.map((s) => s.id))
  const kids = (id: string): typeof here => here.filter((s) => s.parent_id === id)
  // A session whose parent is gone or removed shows at the top level.
  const roots = here.filter((s) => !s.parent_id || !ids.has(s.parent_id))
  const byId = new Map(here.map((s) => [s.id, s]))
  // Where a session can move: any other session here that is not under it (that would loop).
  const under = (id: string): Set<string> => { const out = new Set<string>(); const walk = (p: string): void => kids(p).forEach((c) => { out.add(c.id); walk(c.id) }); walk(id); return out }
  const parentsFor = (id: string): typeof here => { const no = under(id); return here.filter((x) => x.id !== id && !no.has(x.id)) }
  const nameOf = (x: (typeof here)[number]): string => x.title || x.ticket || x.id.slice(0, 8)
  // Tickets from Start ticket show on their plan session: key, and subtasks done of all (click: the ticket's page).
  const tickets = board.tickets.filter((t) => t.folder === folder)
  const plans = new Map(tickets.filter((t) => t.plan_session).map((t) => [t.plan_session!, { key: t.key, done: t.subtasks.filter((x) => x.status === 'done').length, total: t.subtasks.length }]))
  const tree = (s: (typeof here)[number], depth: number): React.JSX.Element => {
    const children = grouped ? kids(s.id) : []
    const shut = folded.has(s.id)
    const fold = (): void => setFolded((f) => { const n = new Set(f); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })
    return (
      <Fragment key={s.id}>
        <div className="sess-tree" style={{ paddingLeft: depth * 14 }}>
          {children.length > 0
            ? <button className="row-act fold" title={shut ? `Show ${children.length}` : 'Collapse'} onClick={fold}><Chev open={!shut} /></button>
            : grouped ? <span className="fold-gap" /> : null /* same slot on every row, so names line up */}
          <SessionRow s={s} label={s.title || s.ticket || s.id.slice(0, 8)} where={place(s.cwd)} active={current === s.id} count={open(s.id)} onOpen={() => openSession(s.id)} onRemove={() => removeIt(s.id)}
            plan={plans.get(s.id)} openTicket={(key) => openTab({ kind: 'ticket', id: key })} showKey={!grouped || byId.get(s.parent_id ?? '')?.ticket !== s.ticket}
            moveTo={{ options: parentsFor(s.id).map((x) => ({ id: x.id, name: nameOf(x) })), nested: !!s.parent_id, move: (p) => void window.api.sessions.setParent(s.id, p) }} />
          {shut && <span className="kids" title={`${children.length} session${children.length === 1 ? '' : 's'} under this one (folded)`}>{children.length}</span>}
        </div>
        {!shut && children.map((c) => tree(c, depth + 1))}
      </Fragment>
    )
  }
  return (
    <div className="side-body">
      <SideHead title="SESSIONS" actions={[
        grouped
          ? { icon: 'list', title: 'Show every session on its own line', onClick: () => setView('flat') }
          : { icon: 'tree', title: 'Group team members and subtask sessions under the session that started them', onClick: () => setView('grouped') },
        { icon: 'clock', title: 'History: resume a conversation Claude Code saved for this folder (like claude --resume)', onClick: resume },
        { icon: 'plus', title: 'New session', onClick: newSession }
      ]} />
      {/* A ticket from Start ticket whose plan session is not in the list (removed, or another folder's): still reachable. */}
      {tickets.filter((t) => !t.plan_session || !ids.has(t.plan_session)).map((t) => (
        <div key={t.key} className="side-item" onClick={() => openTab({ kind: 'ticket', id: t.key })}>
          <span className="pill key-pill">{t.key}</span><span className="name">{t.title ?? 'Ticket'}</span>
          <span className="dir">{t.subtasks.filter((x) => x.status === 'done').length}/{t.subtasks.length}</span>
        </div>
      ))}
      {(grouped ? roots : here).map((s) => tree(s, 0))}
      {removed.length > 0 && (
        <>
          <button className="link removed-toggle" onClick={() => setShowRemoved(!showRemoved)}>{showRemoved ? 'Hide removed' : `Show removed (${removed.length})`}</button>
          {showRemoved && removed.map((s) => (
            <div key={s.id} className="side-item removed">
              <span className="name">{s.title || s.ticket || s.id.slice(0, 8)}</span>
              <button className="row-act" onClick={() => void window.api.sessions.restore(s.id)}>Restore</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// One row: click to open; ✎ renames in place (Enter saves, Esc cancels); × asks once, then removes.
// plan: this session plans a ticket (Start ticket): its subtasks' progress, and a link to the ticket's page.
export function SessionRow({ s, label, where, active, count, onOpen, onRemove, plan, openTicket, showKey = true, moveTo }: {
  s: BoardState['sessions'][number]; label: string; where: string | null; active: boolean; count: number; onOpen: () => void; onRemove: () => void
  plan?: { key: string; done: number; total: number }; openTicket?: (key: string) => void
  showKey?: boolean // false under a parent on the same ticket: the key is already shown there
  moveTo?: { options: { id: string; name: string }[]; nested: boolean; move: (parent: string | null) => void } // "Move under…"
}): React.JSX.Element {
  // The issue key (from Start ticket, its branch, or a ticket link in its first message), the folder, the team role.
  const meta = [showKey && s.ticket && !label.startsWith(s.ticket) ? s.ticket : null, where, s.role && s.role !== label ? s.role : null].filter((x): x is string => !!x)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(label)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = (): void => {
    window.api.sessions.rename(s.id, name).then(() => { setEditing(false); setErr(null) }, (e: unknown) => setErr(errText(e)))
  }
  if (editing) return (
    <div className="side-item editing">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} onBlur={save} />
      {err && <div className="err">{err}</div>}
    </div>
  )
  return (
    <div className={'side-item session-row' + (active ? ' on' : '')} onClick={onOpen} title={s.description || ''}>
      <span className={'state-dot ' + s.state} />
      {/* Two quiet lines: the name, then one grey line with the issue key, where it runs and its team role. */}
      <span className="sess-text">
        <span className="name">{label}</span>
        {meta.length > 0 && <span className="sess-meta" title={where ? `Runs in ${s.cwd}: its MCPs and settings come from there` : undefined}>{meta.join(' · ')}</span>}
      </span>
      {s.via !== 'chat' && <span className="sess-term" title={s.tmux ? 'Started in a Terminal window; shared, so you can use it here too' : 'Started in a Terminal window without the shared wrapper; the app can only leave it messages'}>›_</span>}
      {plan && <button className="row-act plan" title={`${plan.key}: ${plan.done} of ${plan.total} subtasks done. Open the ticket`} onClick={(e) => { e.stopPropagation(); openTicket?.(plan.key) }}>{plan.done}/{plan.total}</button>}
      {count > 0 && <span className="count">{count}</span>}
      {confirm ? (
        <span className="row-confirm" onClick={(e) => e.stopPropagation()}>
          <button className="danger row-act" onClick={() => { setConfirm(false); onRemove() }}>Remove</button>
          <button className="row-act" onClick={() => setConfirm(false)}>Keep</button>
        </span>
      ) : (
        <span className="row-acts" onClick={(e) => e.stopPropagation()}>
          <button className="row-act" title="Rename" onClick={() => { setName(label); setEditing(true) }}>✎</button>
          {moveTo && (moveTo.options.length > 0 || moveTo.nested) && (
            <Menu className="more-wrap" align="right" trigger={({ toggle }) => <button className="row-act" title="Move under another session" onClick={toggle}>⤷</button>}>
              <div className="dd-head">Move under…</div>
              {moveTo.options.map((o) => <div key={o.id} onClick={() => moveTo.move(o.id)}>{o.name}</div>)}
              {moveTo.nested && <div onClick={() => moveTo.move(null)}>Move to top level</div>}
            </Menu>
          )}
          <button className="row-act" title="Remove from the list (its decisions stay in history)" onClick={() => setConfirm(true)}>×</button>
        </span>
      )}
    </div>
  )
}

type Nearby = { on: boolean; dirs: string[]; skipped: { dir: string; sameAs: string }[] }

export function SkillsView({ catalog, run, pins, togglePin, created }: {
  catalog: CatalogItem[]; run: (c: CatalogItem) => void; pins: Pin[]; togglePin: (c: CatalogItem) => void; created: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [making, setMaking] = useState(false)
  const [nearby, setNearby] = useState<Nearby | null>(null)
  useEffect(() => {
    window.api.catalog.nearby().then(setNearby)
  }, [catalog])
  const shown = catalog.filter((c) => (c.name + c.description).toLowerCase().includes(q.toLowerCase()))
  const groups: [string, CatalogItem[]][] = [['Skills', shown.filter((c) => c.kind === 'skill')], ['Commands', shown.filter((c) => c.kind === 'command')], ['Agents', shown.filter((c) => c.kind === 'agent')]]
  return (
    <div className="side-body">
      <SideHead title="SKILLS & AGENTS" actions={[making
        ? { icon: 'close', title: 'Close', onClick: () => setMaking(false) }
        : { icon: 'plus', title: 'New skill', onClick: () => setMaking(true) }]} />
      {making && <NewSkillForm done={(ok) => { setMaking(false); if (ok) created() }} />}
      <input className="side-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter skills and agents" />
      {nearby && (
        <details className="nearby">
          <summary>{nearby.on ? `Skills from ${nearby.dirs.length} nearby folder${nearby.dirs.length === 1 ? '' : 's'} load in every Claude session` : 'Nearby folder skills are off (Settings)'}</summary>
          {nearby.on && nearby.dirs.map((d) => <div key={d} className="ref" title={d}>+ {d.replace(/^\/Users\/[^/]+/, '~')}</div>)}
          {nearby.on && nearby.skipped.map((s) => <div key={s.dir} className="ref meta" title={`Same skills as ${s.sameAs}`}>skipped {s.dir.replace(/^\/Users\/[^/]+/, '~')} (same as {base(s.sameAs)})</div>)}
        </details>
      )}
      {catalog.length === 0 && <div className="side-empty">No skills found in ~/.claude, this folder's .claude, or enabled plugins.</div>}
      {groups.map(([title, items]) => items.length > 0 && (
        <div key={title}>
          <div className="side-group">{title} ({items.length})</div>
          {items.map((c) => (
            <div key={c.kind + c.name} className="side-item skill" onClick={() => run(c)} title={c.description}>
              <span className="name">{c.name}</span><span className="dir">{c.source}</span>
              <button className={'pin' + (pins.some((p) => p.key === itemKey(c)) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); togglePin(c) }} title="Pin to the top bar">{pins.some((p) => p.key === itemKey(c)) ? 'Pinned' : 'Pin'}</button>
              <div className="desc">{c.description}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// A new Claude Code skill, written as SKILL.md (works in every Claude session, not only this app).
function NewSkillForm({ done }: { done: (ok: boolean) => void }): React.JSX.Element {
  const [f, setF] = useState({ name: '', description: '', body: '', scope: 'user' as 'user' | 'project' })
  const [err, setErr] = useState<string | null>(null)
  const save = (): void => {
    window.api.catalog.create(f).then(() => done(true), (e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="integ-form">
      <label className="draft-field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} placeholder="start-my-day" /></label>
      <label className="draft-field"><span>When should Claude use it?</span><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="When I say start my day, or open the app in the morning" /></label>
      <label className="draft-field"><span>What should it do?</span>
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={7}
          placeholder={'1. Pull and show what changed on my branches since yesterday.\n2. List my open decisions and reviews.\n3. Give me standup points (use the standup skill).\n4. Check today\'s meetings.'} /></label>
      <label className="draft-field"><span>Save for</span>
        <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as 'user' | 'project' })}>
          <option value="user">Just me, in every project (~/.claude/skills)</option>
          <option value="project">This repo, for everyone (.claude/skills)</option>
        </select></label>
      <div className="bar"><button className="primary" onClick={save}>Create skill</button><button onClick={() => done(false)}>Cancel</button></div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}
