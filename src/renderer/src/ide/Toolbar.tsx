// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import { base, type CatalogItem, type Task, type Workspace } from './types'

// Top bar: folder menu, run buttons (IDE/D13), skill quick actions (IDE/D14), palette.
// A button shows only when the folder or the user's setup has something behind it.

type Props = {
  ws: Workspace; tasks: Task[]; catalog: CatalogItem[]; trusted: boolean
  pickFolder: () => void; openFolder: (p: string) => void
  runTask: (t: Task) => void; runSkill: (c: CatalogItem) => void; review: () => void; palette: () => void; search: () => void; startTicket: () => void
  pinned: { label: string; item: CatalogItem }[]; runPinned: (c: CatalogItem) => void
}

// Start ticket is built in (the pipeline); these appear when you have a skill for them.
const QUICK: [CatalogItem['role'], string][] = [['describe-ticket', 'Describe ticket'], ['create-pr', 'Create PR'], ['docs', 'Update docs']]

export default function Toolbar({ ws, tasks, catalog, trusted, pickFolder, openFolder, runTask, runSkill, review, palette, search, startTicket, pinned, runPinned }: Props): React.JSX.Element {
  const [menu, setMenu] = useState<'folder' | 'tasks' | 'review' | null>(null)
  const first = (g: Task['group']): Task | undefined => tasks.find((t) => t.group === g)
  const launch = first('launch')
  const test = first('test')
  const seed = first('seed')
  const toggle = (m: 'folder' | 'tasks' | 'review'): void => setMenu(menu === m ? null : m)
  return (
    <div className="toolbar" onMouseLeave={() => setMenu(null)}>
      <div className="tb-menu">
        <button className="tb-folder" onClick={() => toggle('folder')}>{ws.current ? base(ws.current) : 'Open Folder…'} ▾</button>
        {menu === 'folder' && (
          <div className="dropdown">
            <div onClick={() => { setMenu(null); pickFolder() }}>Open Folder…</div>
            {ws.recent.length > 0 && <div className="dd-head">Recent</div>}
            {ws.recent.map((p) => <div key={p} onClick={() => { setMenu(null); openFolder(p) }} title={p}>{base(p)} <span className="meta">{p}</span></div>)}
          </div>
        )}
      </div>
      <div className="tb-group">
        {launch && <button className="tb-run" disabled={!trusted} onClick={() => runTask(launch)} title={launch.command}>▶ Launch</button>}
        {test && <button disabled={!trusted} onClick={() => runTask(test)} title={test.command}>Run tests</button>}
        {seed && <button disabled={!trusted} onClick={() => runTask(seed)} title={seed.command}>Seed DB</button>}
        {tasks.length > 0 && (
          <div className="tb-menu">
            <button disabled={!trusted} onClick={() => toggle('tasks')}>Tasks ▾</button>
            {menu === 'tasks' && (
              <div className="dropdown">
                {tasks.map((t) => <div key={t.id} onClick={() => { setMenu(null); runTask(t) }} title={t.command}>{t.label} <span className="meta">{t.command}</span></div>)}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="tb-group">
        <button disabled={!trusted} onClick={startTicket} title="Plan a ticket, then a branch, worktree and chat per subtask">Start ticket</button>
        <div className="tb-menu">
          <button disabled={!trusted} onClick={() => toggle('review')}>Review changes ▾</button>
          {menu === 'review' && (
            <div className="dropdown">
              <div onClick={() => { setMenu(null); review() }}>Review uncommitted changes <span className="meta">plain prompt</span></div>
              {catalog.filter((c) => c.role === 'review').map((c) => (
                <div key={c.kind + c.name} onClick={() => { setMenu(null); runSkill(c) }} title={c.description}>{c.name} <span className="meta">{c.kind} · {c.source}</span></div>
              ))}
            </div>
          )}
        </div>
        {QUICK.map(([role, label]) => {
          const c = catalog.find((x) => x.role === role)
          return c && <button key={role} disabled={!trusted} onClick={() => runSkill(c)} title={`${c.invoke} — ${c.description}`}>{label}</button>
        })}
      </div>
      {pinned.length > 0 && (
        <div className="tb-group">
          {pinned.map((p) => <button key={p.item.kind + p.item.name} className="tb-pin" disabled={!trusted} onClick={() => runPinned(p.item)} title={`${p.item.invoke}: ${p.item.description}`}>{p.label}</button>)}
        </div>
      )}
      <span className="grow" />
      <button className="tb-palette" onClick={search} title="Search decisions, reviews, chats and docs (⌘K)">⌕ Search</button>
      <button className="tb-palette" onClick={palette} title="Command palette (⇧⌘P)">⌘ Commands</button>
    </div>
  )
}
