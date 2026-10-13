// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import { Chev, Icon } from './icons'
import { base, type CatalogItem, type Task, type Workspace } from './types'

// Top bar, one line at a fixed height:
// - left: where you are (folder ▾, and the git branch when the folder is a repo);
// - middle: one search box (⌘K);
// - right: icons for Run ▾, Review ▾, Skills ▾ and Commands, then Start ticket as the main action.
// Pinned and quick skills (Describe ticket, Create PR, Update docs) live in the Skills menu, so long names never
// widen or grow the bar. Every icon has a tooltip with its name and shortcut.

type Props = {
  fullScreen: boolean; ws: Workspace; branch: string | null
  sessionName: string | null // shown when the left menu is closed, so you still see which session is open
   tasks: Task[]; catalog: CatalogItem[]; trusted: boolean
  pickFolder: () => void; openFolder: (p: string) => void
  runTask: (t: Task) => void; runSkill: (c: CatalogItem) => void; review: () => void; palette: () => void; search: () => void; startTicket: () => void
  pinned: { label: string; item: CatalogItem }[]; runPinned: (c: CatalogItem) => void; browseSkills: () => void
}

// Start ticket is built in (the pipeline); these show in the Skills menu when you have a skill for them.
const QUICK: [CatalogItem['role'], string][] = [['describe-ticket', 'Describe ticket'], ['create-pr', 'Create PR'], ['docs', 'Update docs']]
type Menu = 'folder' | 'run' | 'review' | 'skills'

export default function Toolbar(p: Props): React.JSX.Element {
  const { ws, branch, tasks, catalog, trusted } = p
  const [menu, setMenu] = useState<Menu | null>(null)
  const toggle = (m: Menu): void => setMenu(menu === m ? null : m)
  const pick = (f: () => void) => (): void => { setMenu(null); f() }
  const launch = tasks.find((t) => t.group === 'launch')
  const quick = QUICK.flatMap(([role, label]) => { const c = catalog.find((x) => x.role === role); return c ? [{ label, c }] : [] })
  return (
    <div className={'toolbar' + (p.fullScreen ? ' full' : '')} onMouseLeave={() => setMenu(null)}>
      <div className="tb-where">
        <div className="tb-menu">
          <button className="tb-btn tb-folder" onClick={() => toggle('folder')} title={ws.current ?? 'Open a folder'}>
            <Icon name="folder" />{ws.current ? base(ws.current) : 'Open Folder…'}<Chev open />
          </button>
          {menu === 'folder' && (
            <div className="dropdown">
              <div onClick={pick(p.pickFolder)}>Open Folder…</div>
              {ws.recent.length > 0 && <div className="dd-head">Recent</div>}
              {ws.recent.map((r) => <div key={r} onClick={pick(() => p.openFolder(r))} title={r}>{base(r)} <span className="meta">{r}</span></div>)}
            </div>
          )}
        </div>
        {branch && <><span className="tb-sep">/</span><span className="tb-branch" title={`Current git branch: ${branch}`}><Icon name="branch" />{branch}</span></>}
        {p.sessionName && <><span className="tb-sep">/</span><span className="tb-branch" title={`Open session: ${p.sessionName}`}><Icon name="chat" />{p.sessionName}</span></>}
      </div>

      <button className="tb-search" onClick={p.search} title="Search code, files, decisions and chats (⌘K)">
        <Icon name="search" /><span>Search</span><kbd>⌘K</kbd>
      </button>

      <div className="tb-actions">
        <div className="tb-menu">
          <button className="tb-btn tb-icon tb-run" disabled={!trusted || !tasks.length}
            onClick={() => (launch ? p.runTask(launch) : toggle('run'))}
            title={!tasks.length ? 'Run: no app, test or seed command found in this folder' : launch ? `Run the app: ${launch.command}` : 'Run a task'}>
            <Icon name="play" />
          </button>
          {tasks.length > 0 && <button className="tb-btn tb-caret" disabled={!trusted} onClick={() => toggle('run')} title="Tests, seed and every task"><Chev open /></button>}
          {menu === 'run' && (
            <div className="dropdown right">
              {tasks.map((t) => <div key={t.id} onClick={pick(() => p.runTask(t))} title={t.command}>{t.label} <span className="meta">{t.command}</span></div>)}
            </div>
          )}
        </div>
        <div className="tb-menu">
          <button className="tb-btn tb-icon" disabled={!trusted} onClick={() => toggle('review')} title="Review changes"><Icon name="review" /></button>
          {menu === 'review' && (
            <div className="dropdown right">
              <div onClick={pick(p.review)}>Review uncommitted changes <span className="meta">plain prompt</span></div>
              {catalog.filter((c) => c.role === 'review').map((c) => (
                <div key={c.kind + c.name} onClick={pick(() => p.runSkill(c))} title={c.description}>{c.name} <span className="meta">{c.kind} · {c.source}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="tb-menu">
          <button className="tb-btn tb-icon" onClick={() => toggle('skills')} title="Skills: pinned and quick actions"><Icon name="spark" /></button>
          {menu === 'skills' && (
            <div className="dropdown right">
              {p.pinned.length > 0 && <div className="dd-head">Pinned</div>}
              {p.pinned.map((x) => <div key={x.item.kind + x.item.name} className={trusted ? '' : 'off'} onClick={trusted ? pick(() => p.runPinned(x.item)) : undefined} title={`${x.item.invoke}: ${x.item.description}`}>★ {x.label}</div>)}
              {quick.length > 0 && <div className="dd-head">Quick</div>}
              {quick.map(({ label, c }) => <div key={label} className={trusted ? '' : 'off'} onClick={trusted ? pick(() => p.runSkill(c)) : undefined} title={`${c.invoke}: ${c.description}`}>{label}</div>)}
              <div className="dd-head">All skills</div>
              <div onClick={pick(p.browseSkills)}>Browse and pin skills…</div>
            </div>
          )}
        </div>
        <button className="tb-btn tb-icon" onClick={p.palette} title="Commands (⇧⌘P)"><Icon name="command" /></button>
        <span className="tb-div" />
        <button className="tb-btn tb-primary" disabled={!trusted} onClick={p.startTicket} title="Plan a ticket, then a branch, worktree and chat per subtask">
          <Icon name="ticket" />Start ticket
        </button>
      </div>
    </div>
  )
}
