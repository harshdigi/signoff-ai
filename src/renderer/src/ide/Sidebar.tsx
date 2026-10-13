// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Fragment, useEffect, useState } from 'react'
import { forLater, forProduct, waitingOn, type BoardState } from '../board/types'
import { base, errText, itemKey, type CatalogItem, type EditorTab, type Pin } from './types'

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
      <div className="side-item" onClick={openAll}><span className="st">◆</span><span className="name">All decisions</span></div>
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
  const tree = (s: (typeof here)[number], depth: number): React.JSX.Element => {
    const children = grouped ? kids(s.id) : []
    const shut = folded.has(s.id)
    const fold = (): void => setFolded((f) => { const n = new Set(f); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })
    return (
      <Fragment key={s.id}>
        <div className="sess-tree" style={{ paddingLeft: depth * 14 }}>
          {children.length > 0
            ? <button className="row-act fold" title={shut ? `Show ${children.length}` : 'Collapse'} onClick={fold}>{shut ? '▸' : '▾'}</button>
            : depth > 0 ? <span className="fold-gap" /> : null}
          <SessionRow s={s} label={s.title || s.ticket || s.id.slice(0, 8)} where={place(s.cwd)} active={current === s.id} count={open(s.id)} onOpen={() => openSession(s.id)} onRemove={() => removeIt(s.id)} />
          {shut && <span className="count" title="Sessions under this one">{children.length}</span>}
        </div>
        {!shut && children.map((c) => tree(c, depth + 1))}
      </Fragment>
    )
  }
  return (
    <div className="side-body">
      <div className="side-group">Tickets</div>
      {board.tickets.filter((t) => t.folder === folder).length === 0 && <div className="side-empty">Start one with "Start ticket" in the toolbar.</div>}
      {board.tickets.filter((t) => t.folder === folder).map((t) => (
        <div key={t.key} className="side-item" onClick={() => openTab({ kind: 'ticket', id: t.key })}>
          <span className="st pending">T</span><span className="name">{t.key}{t.title ? ` · ${t.title}` : ''}</span>
          <span className="dir">{t.subtasks.filter((s) => s.status === 'done').length}/{t.subtasks.length}</span>
        </div>
      ))}
      <div className="side-group">Sessions</div>
      <div className="side-item" onClick={newSession}><span className="st">＋</span><span className="name">New session</span></div>
      <div className="side-item" onClick={resume} title="Continue a conversation Claude Code saved for this folder, like claude --resume"><span className="st">↺</span><span className="name">Resume a Claude conversation…</span></div>
      <div className="mode-toggle sess-view">
        <button className={grouped ? 'on' : ''} onClick={() => setView('grouped')} title="Team members and subtask sessions under the session that started them">Grouped</button>
        <button className={grouped ? '' : 'on'} onClick={() => setView('flat')} title="Every session on its own line">Individual</button>
      </div>
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
export function SessionRow({ s, label, where, active, count, onOpen, onRemove }: {
  s: BoardState['sessions'][number]; label: string; where: string | null; active: boolean; count: number; onOpen: () => void; onRemove: () => void
}): React.JSX.Element {
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
      <span className={'state-dot ' + s.state} /><span className="name">{label}</span>
      {s.role && <span className="pill role-pill">{s.role}</span>}
      {where && <span className="dir" title={`Runs in ${s.cwd}: its MCPs and settings come from there`}>{where}</span>}
      {s.via !== 'chat' && <span className="tag" title={s.tmux ? 'Started in a Terminal window; shared, so you can use it here too' : 'Started in a Terminal window without the shared wrapper; the app can only leave it messages'}>Terminal</span>}
      {count > 0 && <span className="count">{count}</span>}
      {confirm ? (
        <span className="row-confirm" onClick={(e) => e.stopPropagation()}>
          <button className="danger row-act" onClick={() => { setConfirm(false); onRemove() }}>Remove</button>
          <button className="row-act" onClick={() => setConfirm(false)}>Keep</button>
        </span>
      ) : (
        <span className="row-acts" onClick={(e) => e.stopPropagation()}>
          <button className="row-act" title="Rename" onClick={() => { setName(label); setEditing(true) }}>✎</button>
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
      {making ? <NewSkillForm done={(ok) => { setMaking(false); if (ok) created() }} /> : <button className="wide" onClick={() => setMaking(true)}>New skill…</button>}
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
