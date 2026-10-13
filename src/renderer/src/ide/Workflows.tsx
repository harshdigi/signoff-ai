// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { errText, type CatalogItem, type Role, type Workflow } from './types'
import { flowSteps, recommend, sessionsLine, warnings, type Answers } from './workflow-guide'
import { SideHead } from './SideHead'
import { Chev } from './icons'

// Workflows (IDE/D21): team setups to start a session with, and your routines (pinned skills).
// Each setup explains itself: how it runs, what it is good and not good for, and what it costs in sessions.
// "Which setup?" picks a built-in from three questions (no Claude call).

type Props = {
  workflows: Workflow[]; reload: () => void; trusted: boolean; start: (id: string) => void
  routines: { label: string; item: CatalogItem }[]; run: (c: CatalogItem) => void
}
type Draft = Omit<Workflow, 'builtIn' | 'line'>

const HOW = [
  'Pick a setup and press ▶. That starts the lead session; give it the task.',
  'The lead proposes a split as a decision: which pieces, and who does each.',
  'You approve it (and can drop pieces). The app starts one session per piece, up to the cap in Settings.',
  'Each implementer gets its own branch and worktree, so parallel work never overwrites.',
  'When a piece is done, the reviewer reads the diff. Problems come to you as decisions or reviews.',
  'The lead merges passed pieces into its branch, after asking you. Nothing merges or pushes on its own.'
]

export default function WorkflowsView({ workflows, reload, trusted, start, routines, run }: Props): React.JSX.Element {
  const [editing, setEditing] = useState<Draft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [cap, setCap] = useState(3)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void window.api.settings.get().then((s: { maxChildren: number }) => setCap(s.maxChildren))
  }, [])
  const remove = (id: string): void => void window.api.workflows.remove(id).then(reload, (e: unknown) => setErr(errText(e)))
  const [panel, setPanel] = useState<'how' | 'pick' | null>(null) // ⓘ how it works, ? which setup
  const newSetup = (): void => setEditing({ id: '', name: '', description: '', team: [{ role: 'implementer', count: 1, does: '' }, { role: 'reviewer', count: 1, does: 'Reads each diff from the implementers and posts findings as a review. Never edits code.' }], goodFor: [], notFor: [] })
  if (editing) return <Editor w={editing} cap={cap} done={(saved) => { setEditing(null); if (saved) reload() }} />
  return (
    <div className="side-body">
      <SideHead title="TEAMS" hint="Team setups: several sessions on one task, each on its own branch" actions={[
        { icon: 'info', title: 'How team setups work', on: panel === 'how', onClick: () => setPanel(panel === 'how' ? null : 'how') },
        { icon: 'help', title: 'Which setup should I use? Three questions', on: panel === 'pick', onClick: () => setPanel(panel === 'pick' ? null : 'pick') },
        { icon: 'plus', title: 'New team setup', onClick: newSetup }
      ]} />
      {panel === 'how' && (
        <div className="wf-how">
          <ol>{HOW.map((h) => <li key={h}>{h}</li>)}</ol>
          <div className="meta">Every session uses its own tokens. Teams need a git repo on a branch: start a team from a session inside a repo.</div>
        </div>
      )}
      {panel === 'pick' && <Picker workflows={workflows} reveal={(id) => { setOpen(id); setPanel(null) }} />}
      <div className="side-group">Team setups</div>
      {workflows.map((w) => (
        <div key={w.id} className={'wf-card' + (open === w.id ? ' on' : '')}>
          <div className="side-item wf-row" onClick={() => setOpen(open === w.id ? null : w.id)} title="Show how it works and when to use it">
            <span className="name"><Chev open={open === w.id} /> {w.name}</span><span className="dir">{w.line}</span>
            <span className="row-acts" onClick={(e) => e.stopPropagation()}>
              <button className="row-act" disabled={!trusted} title={trusted ? 'Start a session with this team' : 'Trust the folder first'} onClick={() => start(w.id)}>▶</button>
              <button className="row-act" title={w.builtIn ? 'Copy and edit' : 'Edit'} onClick={() => setEditing({ id: w.builtIn ? `${w.id}-copy` : w.id, name: w.builtIn ? `${w.name} (copy)` : w.name, description: w.description, team: w.team, goodFor: w.goodFor, notFor: w.notFor })}>✎</button>
              {!w.builtIn && <button className="row-act" title="Delete" onClick={() => remove(w.id)}>×</button>}
            </span>
          </div>
          {open === w.id && <Details w={w} cap={cap} />}
        </div>
      ))}
      <div className="side-group">Routines</div>
      {routines.length === 0 && <div className="side-empty">Pin a skill in Skills (✦), e.g. a start-my-day skill, and it shows here.</div>}
      {routines.map((r) => (
        <div key={r.item.name} className="side-item" onClick={() => run(r.item)} title={r.item.invoke}>
          <span className="st">▶</span><span className="name">{r.label}</span>
        </div>
      ))}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// A setup shown outside the Workflows tab (a session's proposal card), checked against the cap in Settings.
export function SetupPreview({ w }: { w: Pick<Workflow, 'description' | 'team' | 'goodFor' | 'notFor'> }): React.JSX.Element {
  const [cap, setCap] = useState<number | null>(null)
  useEffect(() => {
    void window.api.settings.get().then((s: { maxChildren: number }) => setCap(s.maxChildren))
  }, [])
  return cap === null ? <div className="meta">Loading…</div> : <Details w={w} cap={cap} />
}

// One setup, opened: its purpose, team, flow, when to use it, cost and warnings.
export function Details({ w, cap }: { w: Pick<Workflow, 'description' | 'team' | 'goodFor' | 'notFor'>; cap: number }): React.JSX.Element {
  const warn = warnings(w.team, cap)
  return (
    <div className="wf-details">
      {w.description && <p>{w.description}</p>}
      {w.team.length > 0 && (
        <><div className="ctx-h">Team</div><ul>{w.team.map((r) => <li key={r.role}><b>{r.count ?? 'N'} × {r.role}</b>: {r.does || <span className="meta">no description yet</span>}</li>)}</ul></>
      )}
      <div className="ctx-h">How it runs</div>
      <ol>{flowSteps(w.team).map((s) => <li key={s}>{s}</li>)}</ol>
      {w.goodFor.length > 0 && <><div className="ctx-h">Good for</div><ul className="wf-good">{w.goodFor.map((g) => <li key={g}>{g}</li>)}</ul></>}
      {w.notFor.length > 0 && <><div className="ctx-h">Not for</div><ul className="wf-not">{w.notFor.map((g) => <li key={g}>{g}</li>)}</ul></>}
      <div className="meta">Sessions: {sessionsLine(w.team)}{w.team.length ? '. Each one uses its own tokens.' : ''}</div>
      {warn.length > 0 && <ul className="wf-warn">{warn.map((x) => <li key={x}>{x}</li>)}</ul>}
    </div>
  )
}

// "Which setup?": three questions, an answer with the reason, and a link to that setup.
function Picker({ workflows, reveal }: { workflows: Workflow[]; reveal: (id: string) => void }): React.JSX.Element {
  const [a, setA] = useState<Partial<Answers>>({})
  const ask = <K extends keyof Answers>(k: K, label: string, opts: [Answers[K], string][]): React.JSX.Element => (
    <div className="wf-q"><span>{label}</span>
      <div className="mode-toggle">{opts.map(([v, t]) => <button key={v} className={a[k] === v ? 'on' : ''} onClick={() => setA({ ...a, [k]: v })}>{t}</button>)}</div>
    </div>
  )
  const done = a.size && a.parts && a.risk
  const pick = done ? recommend(a as Answers) : null
  const name = pick ? workflows.find((w) => w.id === pick.id)?.name ?? pick.id : ''
  return (
    <div className="wf-pick">
      {ask('size', 'How big is the task?', [['small', 'Small'], ['feature', 'A feature'], ['large', 'Large']])}
      {ask('parts', 'Does it split into parts that do not touch the same files?', [['one', 'No, one piece'], ['independent', 'Yes']])}
      {ask('risk', 'How costly is a mistake?', [['low', 'Low'], ['high', 'High (money, auth, data)']])}
      {pick && (
        <div className="wf-answer">
          <b>Use {name}.</b> {pick.why}
          <button className="link" onClick={() => reveal(pick.id)}>Show {name}</button>
        </div>
      )}
    </div>
  )
}

function Editor({ w, cap, done }: { w: Draft; cap: number; done: (saved: boolean) => void }): React.JSX.Element {
  const [f, setF] = useState(w)
  const [err, setErr] = useState<string | null>(null)
  const setRole = (i: number, patch: Partial<Role>): void => setF({ ...f, team: f.team.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const list = (s: string): string[] => s.split('\n')
  const save = (): void => {
    const id = f.id || f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    window.api.workflows.save({ ...f, id }).then(() => done(true), (e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="side-body wf-edit">
      <label>Name <input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>What it is for <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="side-group">Team</div>
      <div className="meta">{'The first role gets one session per piece the lead proposes. A role named exactly "reviewer" reads the others\' diffs and never edits code.'}</div>
      {f.team.map((r, i) => (
        <div key={i} className="wf-role">
          <input value={r.role} placeholder="role, e.g. reviewer" onChange={(e) => setRole(i, { role: e.target.value })} />
          <input type="number" min={1} max={10} value={r.count ?? ''} placeholder="N" title="Empty: the parent proposes how many"
            onChange={(e) => setRole(i, { count: e.target.value ? Number(e.target.value) : null })} />
          <button className="row-act" onClick={() => setF({ ...f, team: f.team.filter((_, j) => j !== i) })}>×</button>
          <textarea value={r.does} placeholder="What this role does" onChange={(e) => setRole(i, { does: e.target.value })} />
        </div>
      ))}
      <button className="link" onClick={() => setF({ ...f, team: [...f.team, { role: '', count: 1, does: '' }] })}>＋ Add role</button>
      <div className="meta">Leave the count empty and the parent session proposes how many, once it knows the task.</div>
      <label>Good for (one per line) <textarea value={f.goodFor.join('\n')} placeholder={'e.g. API + frontend + specs for one feature'} onChange={(e) => setF({ ...f, goodFor: list(e.target.value) })} /></label>
      <label>Not for (one per line) <textarea value={f.notFor.join('\n')} placeholder={'e.g. quick fixes'} onChange={(e) => setF({ ...f, notFor: list(e.target.value) })} /></label>
      <div className="side-group">Preview</div>
      <Details w={{ ...f, goodFor: f.goodFor.filter((x) => x.trim()), notFor: f.notFor.filter((x) => x.trim()) }} cap={cap} />
      <div className="bar"><button className="primary" onClick={save}>Save</button><button onClick={() => done(false)}>Cancel</button></div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}
