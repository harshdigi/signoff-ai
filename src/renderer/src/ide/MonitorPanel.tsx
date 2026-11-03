// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import { errText } from './types'

// Monitor tab (SIGNOFF-34-WATCH/D4): the watches running for this session first, as cards; then + New watch, for a
// change (no PR needed) or this branch's pull request. Repo setup is one Connections line, run when first needed.
// The app follows GitHub itself; a failure opens fire fighting (PR) or asks the session to undo it (change).
type Recipient = { app: string; where: string; tags: string[] }
type Destination = { kind: 'channel' | 'person' | 'group'; name: string; id?: string }
type Found = {
  messaging: { app: string; destinations: Destination[]; needs: string[] }[]
  errors: { app: string; services: string[] }[]
  deploy: { workflow: string | null; trigger: string; postDeploy: string | null }
  notes: string[]
}
type Chosen = { deployWorkflow?: string; recipients?: Recipient[]; errors?: { app: string; services: string[] } }
type Event = { at: string; kind: string; text: string }
type Asked = { app: string; where: string; found: boolean; in?: string; when?: string; link?: string; error?: string }
type Request = { app: string; place: string; state: 'sent' | 'found' | 'approved'; message: string | null; by: string | null; at: string }
type Mon = { id: string; stage: string; window_minutes: number; check_minutes: number; notify: number; session_id: string | null; deployed_at: string | null; events: Event[] }
type Change = Mon & { subject: string; focus: string | null; deployed_at: string }
type Pr = { number: number; url: string; title: string; state: string }
type View = {
  repo: string | null; problem: string | null; pr: Pr | null
  setup: { found: Found; foundAt: string; chosen: Chosen | null } | null
  monitor: Mon | null
  requests: Request[]
  changes: Change[]
  team: { session: string; title: string | null; repo: string | null; pr: Pr | null; monitor: Mon | null }[]
}
type Described = { subject: string; focus: string | null; since: string | null; windowMinutes: number | null }
const WINDOWS = [[60, '1 hour'], [240, '4 hours'], [1440, '24 hours']] as const
const CHECKS = [[15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour']] as const
const STAGE: Record<string, string> = { ci: 'CI running', merge: 'Waiting for merge', deploy: 'Waiting for deploy', stable: 'Watching production', done: 'Done', incident: 'Incident', stopped: 'Stopped' }
const TRACK: Record<string, string> = { ci: 'CI', merge: 'Merge', deploy: 'Production deploy', done: 'Done' }
const LIVE = (m: Mon): boolean => m.stage !== 'done' && m.stage !== 'stopped'
const time = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
// "38 min left" while watching production; the window runs from the deploy (PR) or the change time.
const left = (m: Mon): string | null => {
  if (m.stage !== 'stable' || !m.deployed_at) return null
  const min = Math.ceil((Date.parse(m.deployed_at) + m.window_minutes * 60_000 - Date.now()) / 60_000)
  return min <= 0 ? 'window ending' : min >= 120 ? `${Math.round(min / 60)} h left` : `${min} min left`
}

// The panel's last view and your unsaved choices, per session (SIGNOFF-31/D8). The tab is dropped when you switch;
// coming back shows these at once and refreshes quietly. Kept in memory only, until the app quits.
type Kept = { v: View | null; win: number; every: number; notify: boolean; recipients: Recipient[] | null; asked: Asked[] | null }
const kept = new Map<string, Kept>()

export default function MonitorPanel({ session }: { session: string }): React.JSX.Element {
  const k = kept.get(session)
  const [v, setV] = useState<View | null>(k?.v ?? null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<'change' | 'pr' | null>(null)
  const [win, setWin] = useState(k?.win ?? 60)
  const [every, setEvery] = useState(k?.every ?? 30)
  const [notify, setNotify] = useState(k?.notify ?? false) // D2: opt-in, off by default
  const [recipients, setRecipients] = useState<Recipient[] | null>(k?.recipients ?? null)
  const [asked, setAsked] = useState<Asked[] | null>(k?.asked ?? null)
  useEffect(() => { kept.set(session, { v, win, every, notify, recipients, asked }) }, [session, v, win, every, notify, recipients, asked])
  const load = useCallback(() => {
    window.api.monitor.forSession(session).then((x: View) => { setV(x); setErr(null) }, (e: unknown) => setErr(errText(e)))
  }, [session])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])
  const act = (what: string, p: Promise<unknown>): void => {
    setBusy(what)
    setErr(null)
    p.then(load, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  if (!v) return <div className="monitor"><div className="meta">{err ?? 'Loading the monitor…'}</div></div>
  const found = v.setup?.found
  // Picking a kind of watch runs the repo setup first when it never ran (D4: no separate Set up step).
  const pick = (kind: 'change' | 'pr'): void => {
    setAdding(kind)
    if (!found && v.repo && busy !== 'setup') act('setup', window.api.monitor.setup(session))
  }
  const cards: { m: Mon; title: string; tag: string; focus?: string | null; requests?: Request[] }[] = [
    ...(v.monitor ? [{ m: v.monitor, title: v.pr?.title ?? `Pull request #${v.pr?.number}`, tag: `PR #${v.pr?.number}`, requests: v.requests }] : []),
    ...v.changes.map((c) => ({ m: c as Mon, title: c.subject, tag: 'Change', focus: c.focus }))
  ]
  const live = cards.filter((c) => LIVE(c.m))
  const finished = cards.filter((c) => !LIVE(c.m))
  return (
    <div className="monitor">
      <div className="mon-head">
        <b>Monitor</b>{v.repo && <span className="meta">{v.repo}</span>}<span className="grow" />
        {v.repo && <button className="sm primary" onClick={() => (adding ? setAdding(null) : pick('change'))}>{adding ? 'Close' : '+ New watch'}</button>}
      </div>
      {v.problem && <div className="meta">{v.problem}</div>}
      {err && <div className="err">{err}</div>}
      {v.repo && <Connections v={v} busy={busy} rescan={() => act('setup', window.api.monitor.setup(session))} choose={(c) => act('choose', window.api.monitor.choose(v.repo!, c))} />}

      <div className="mon-cards">
        {live.length === 0 && !adding && <div className="mon-empty meta">Nothing is being watched. Use + New watch for a change you made (e.g. a merchant config) or for this branch&apos;s pull request.</div>}
        {live.map((c) => <WatchCard key={c.m.id} {...c} reload={load} />)}
      </div>

      {adding && v.repo && (
        <div className="mon-new">
          <div className="mon-kinds">
            <button className={'mon-kind' + (adding === 'change' ? ' on' : '')} onClick={() => pick('change')}><b>A change</b><span className="meta">Config, data or a deploy outside a PR. No PR needed.</span></button>
            <button className={'mon-kind' + (adding === 'pr' ? ' on' : '')} onClick={() => pick('pr')}><b>A pull request</b><span className="meta">{v.pr ? `#${v.pr.number}: review request, then CI, merge and production.` : 'This branch has no pull request yet.'}</span></button>
          </div>
          {busy === 'setup' && <div className="meta">Checking which connected apps can post messages and show production errors, and how this repo deploys (read-only, about a minute)…</div>}
          {found && adding === 'change' && <ChangeForm session={session} done={() => { setAdding(null); load() }} />}
          {found && adding === 'pr' && (v.monitor
            ? <div className="meta">#{v.pr?.number} is already watched: see its card above.</div>
            : !v.pr ? <div className="meta">Open the pull request from Ship first; then start its watch here.</div>
              : <PrForm session={session} v={v} busy={busy} setBusy={setBusy} setErr={setErr} act={act} reload={load}
                  win={win} setWin={setWin} every={every} setEvery={setEvery} notify={notify} setNotify={setNotify}
                  recipients={recipients} setRecipients={setRecipients} asked={asked} setAsked={setAsked} started={() => setAdding(null)} />)}
        </div>
      )}

      {v.team.length > 0 && (
        <div className="mon-team">
          <div className="side-group">Team pull requests</div>
          {v.team.map((t) => (
            <div key={t.session} className="mon-team-row">
              <span className="name">{t.title ?? t.session.slice(0, 8)}</span>
              <span className="meta">{t.pr ? `#${t.pr.number}` : 'no PR yet'}</span>
              <span className="meta">{t.monitor ? `${STAGE[t.monitor.stage]}${t.monitor.session_id === session ? '' : ' (its session)'}` : ''}</span>
              {!t.monitor && t.pr ? <button className="sm" disabled={!!busy || !v.setup} onClick={() => act('start', window.api.monitor.start({ session: t.session, owner: session, windowMinutes: win, checkMinutes: every, notify: false, recipients: [] }))}>Watch</button> : <span />}
            </div>
          ))}
        </div>
      )}

      {finished.length > 0 && (
        <details className="fold mon-finished">
          <summary className="meta">Finished ({finished.length})</summary>
          {finished.map((c) => <WatchCard key={c.m.id} {...c} reload={load} />)}
        </details>
      )}
    </div>
  )
}

// What the repo's monitoring can use, on one line: apps found, the deploy workflow, and Re-scan.
function Connections({ v, busy, rescan, choose }: { v: View; busy: string | null; rescan: () => void; choose: (c: Chosen) => void }): React.JSX.Element {
  const found = v.setup?.found
  const chosen = v.setup?.chosen ?? {}
  const deploy = chosen.deployWorkflow ?? found?.deploy.workflow ?? null
  return (
    <div className="mon-conn">
      <span className="meta">Connections</span>
      {found ? (
        <>
          {found.messaging.map((x) => <span key={x.app} className="chip ok">✓ {x.app}</span>)}
          {found.errors.map((x) => <span key={x.app} className="chip ok">✓ {x.app}</span>)}
          <span className={'chip ' + (deploy ? 'ok' : 'todo')} title={deploy ?? undefined}>{deploy ? `✓ ${deploy.replace(/\s*\(.*\)$/, '')}` : '○ no deploy workflow'}</span>
          {!found.messaging.length && <span className="chip todo">○ no messaging app</span>}
          {!found.errors.length && <span className="chip todo">○ no error tool</span>}
        </>
      ) : <span className="meta">not checked yet; runs when you start a watch</span>}
      <span className="grow" />
      <button className="sm" disabled={!!busy} title="Scans your connected apps (messaging, errors) and this repo's deploy setup again. Read-only, about a minute. Use it after connecting an app in Tools." onClick={rescan}>{busy === 'setup' ? 'Scanning…' : found ? 'Re-scan' : 'Check now'}</button>
      {found && (
        <details className="fold mon-details">
          <summary className="meta">Details{found.notes.length ? ` · notes (${found.notes.length})` : ''}</summary>
          <label>Production deploy workflow <input defaultValue={deploy ?? ''} onBlur={(e) => choose({ ...chosen, deployWorkflow: e.target.value.trim() || undefined })} /></label>
          <div className="meta">Starts: {found.deploy.trigger}</div>
          {found.notes.length > 0 && <ul className="meta mon-notes">{found.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </details>
      )}
    </div>
  )
}

// One watch as a card (D5): status, time left, the last check, and Check now / Extend / Stop while it runs.
function WatchCard({ m, title, tag, focus, requests, reload }: { m: Mon; title: string; tag: string; focus?: string | null; requests?: Request[]; reload: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const run = (what: string, p: Promise<unknown>): void => {
    setBusy(what)
    setErr(null)
    p.then(reload, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  const track = ['ci', 'merge', 'deploy', 'stable', 'done']
  const pr = tag !== 'Change'
  const last = [...m.events].reverse().find((e) => e.kind === 'error-check' || e.kind === 'error-check-failed')
  const rest = left(m)
  return (
    <div className={'mon-card ' + m.stage}>
      <div className="mon-card-head">
        <span className="tag">{tag}</span><b className="title" title={title}>{title}</b>
        <span className={'pill ' + m.stage}>{m.stage === 'stable' ? 'Watching' : STAGE[m.stage] ?? m.stage}</span>
        {rest && <span className="meta">{rest}</span>}
      </div>
      {focus && <div className="meta">Focus: {focus}</div>}
      {!!requests?.length && <Requests requests={requests} />}
      {pr && track.includes(m.stage) && <div className="mon-track">{track.map((t, i) => <span key={t} className={'chip ' + (t === m.stage ? 'on' : i < track.indexOf(m.stage) ? 'ok' : 'todo')}>{t === 'stable' ? `Production (${m.window_minutes} min)` : TRACK[t]}</span>)}</div>}
      <div className={'mon-last ' + (last?.kind ?? '')}>{last ? <><span className="meta">{time(last.at)}</span> {last.text}</> : <span className="meta">{m.stage === 'stable' ? `First error check ${m.check_minutes} min in` : pr ? `Errors are checked every ${m.check_minutes} min once it is in production` : ''}</span>}</div>
      {LIVE(m) && (
        <div className="bar mon-controls">
          <button className="sm" disabled={!!busy || m.stage !== 'stable'} title={m.stage === 'stable' ? 'Runs an error check now (a minute or two); the result shows here' : 'Available once it is watching production'}
            onClick={() => run('check', window.api.monitor.checkNow(m.id))}>{busy === 'check' ? 'Checking errors…' : 'Check now'}</button>
          <select value="" disabled={!!busy} title="Watch for longer" onChange={(e) => e.target.value && run('extend', window.api.monitor.extend(m.id, Number(e.target.value)))}>
            <option value="">Extend…</option>{WINDOWS.map(([n, l]) => <option key={n} value={n}>+ {l}</option>)}
          </select>
          <span className="grow" />
          <button className="sm" disabled={!!busy} onClick={() => run('stop', window.api.monitor.stop(m.id, 'stopped from the Monitor tab'))}>Stop</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      <details className="fold">
        <summary className="meta">History ({m.events.length}) · {m.id}</summary>
        <ol className="mon-events">{m.events.map((e, i) => <li key={i} className={e.kind}><span className="meta">{time(e.at)}</span> {e.text}</li>)}</ol>
      </details>
    </div>
  )
}

// A change watch (SIGNOFF-34/D2), started from a description (D5): Claude fills the fields from your words; you check
// them and start it. What changed and its focus steer each error check.
function ChangeForm({ session, done }: { session: string; done: () => void }): React.JSX.Element {
  const local = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [focus, setFocus] = useState('')
  const [since, setSince] = useState(() => local(new Date()))
  const [win, setWin] = useState(60)
  const [every, setEvery] = useState(15)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fill = (): void => {
    setBusy('fill'); setErr(null)
    window.api.monitor.describe(session, text).then((d: Described) => {
      setSubject(d.subject)
      setFocus(d.focus ?? '')
      if (d.since) setSince(local(new Date(d.since)))
      if (d.windowMinutes) { setWin(d.windowMinutes); setEvery((e) => Math.min(e, d.windowMinutes!)) }
    }, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  const start = (): void => {
    setBusy('start'); setErr(null)
    window.api.monitor.startChange({ session, subject, focus, since: new Date(since).toISOString(), windowMinutes: win, checkMinutes: every })
      .then(done, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  return (
    <div className="mon-change-form">
      <div className="mon-describe">
        <textarea rows={2} placeholder="Describe it in your words, e.g. 'At 3pm I enabled instant payout for merchant X; watch for 4 hours'" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="sm" disabled={!!busy || !text.trim()} title="Claude fills the fields below from your words; you check them before starting" onClick={fill}>{busy === 'fill' ? 'Filling in…' : 'Fill in'}</button>
      </div>
      <input placeholder="What changed, e.g. merchant X: enabled instant payout" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <input placeholder="Focus (optional), e.g. a merchant id or an endpoint" value={focus} onChange={(e) => setFocus(e.target.value)} />
      <div className="mon-form">
        <label>Changed at <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} /></label>
        <label>Watch for <select value={win} onChange={(e) => setWin(Number(e.target.value))}>{WINDOWS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></label>
        <label>Check errors <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>{CHECKS.filter(([n]) => n <= win).map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></label>
        <button className="primary sm" disabled={!!busy || !subject.trim()} onClick={start}>{busy === 'start' ? 'Starting…' : 'Start watching'}</button>
      </div>
      <div className="meta">Each check compares errors since the change with the same time before it. On a problem: a notification, and this session proposes undoing the change (it asks you first).</div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// A watch on this branch's pull request: the review request (SIGNOFF-31) and how long to watch production after the
// deploy. The choices are the panel's, so they survive switching tabs (SIGNOFF-31/D8).
type PrFormProps = {
  session: string; v: View; busy: string | null; setBusy: (b: string | null) => void; setErr: (e: string | null) => void; act: (what: string, p: Promise<unknown>) => void; reload: () => void
  win: number; setWin: (n: number) => void; every: number; setEvery: (n: number) => void; notify: boolean; setNotify: (b: boolean) => void
  recipients: Recipient[] | null; setRecipients: (r: Recipient[]) => void; asked: Asked[] | null; setAsked: (a: Asked[]) => void; started: () => void
}
function PrForm({ session, v, busy, setBusy, setErr, act, reload, win, setWin, every, setEvery, notify, setNotify, recipients, setRecipients, asked, setAsked, started }: PrFormProps): React.JSX.Element {
  const found = v.setup!.found
  const chosen = v.setup?.chosen ?? {}
  const apps = found.messaging
  // No saved default and nothing added yet: one empty row for the first app, so the channel box and Check are visible.
  const rows = recipients ?? (chosen.recipients?.length ? chosen.recipients : apps.length ? [{ app: apps[0].app, where: '', tags: [] }] : [])
  const setRow = (i: number, r: Recipient | null): void => {
    const next = [...rows]
    if (r) next[i] = r; else next.splice(i, 1)
    setRecipients(next)
  }
  // Default recipients per repo (SIGNOFF-31/D4): a checkbox on each row saves or drops it at once; no separate button.
  const defaults = chosen.recipients ?? []
  const same = (a: Recipient, b: Recipient): boolean => a.app === b.app && a.where.trim() === b.where.trim()
  const isDefault = (r: Recipient): boolean => !!r.where.trim() && defaults.some((d) => same(d, r))
  const markDefault = (r: Recipient, on: boolean): void =>
    act('choose', window.api.monitor.choose(v.repo!, { ...chosen, recipients: on ? [...defaults.filter((d) => !same(d, r)), r] : defaults.filter((d) => !same(d, r)) }))
  const named = rows.filter((r) => r.where.trim())
  return (
    <div className="mon-pr-form">
      <div className="mon-sub"><b>Review request</b></div>
      {v.requests.length > 0 && <Requests requests={v.requests} />}
      <label className="inline"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Post &quot;PR is up for review&quot; when CI passes</label>
      <div className="mon-recipients">
        {apps.length === 0 && <div className="meta">No connected app can post messages. Connect one in Tools, then Re-scan.</div>}
        {rows.map((r, i) => {
          const dests = apps.find((x) => x.app === r.app)?.destinations ?? []
          const a = asked?.find((x) => x.app === r.app && x.where === r.where.trim())
          return (
            <div key={i} className="mon-row">
              <select value={r.app} onChange={(e) => setRow(i, { ...r, app: e.target.value })}>{apps.map((x) => <option key={x.app}>{x.app}</option>)}</select>
              <input list={`dest-${i}`} placeholder="channel or person" value={r.where} onChange={(e) => setRow(i, { ...r, where: e.target.value })} />
              <datalist id={`dest-${i}`}>{dests.filter((d) => d.kind !== 'group').map((d) => <option key={d.name} value={d.name} />)}</datalist>
              <input list={`tag-${i}`} placeholder="tag: @team, @person" value={r.tags.join(', ')} onChange={(e) => setRow(i, { ...r, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                onBlur={() => { if (isDefault(r)) markDefault(r, true) }} />
              <datalist id={`tag-${i}`}>{dests.filter((d) => d.kind !== 'channel').map((d) => <option key={d.name} value={d.name} />)}</datalist>
              <label className="inline mon-default" title="Saved for this repo and filled in next time"><input type="checkbox" disabled={!r.where.trim() || !!busy} checked={isDefault(r)} onChange={(e) => markDefault(r, e.target.checked)} /> Default</label>
              <button className="sm" title="Remove" onClick={() => setRow(i, null)}>×</button>
              {a && <div className={'mon-asked ' + (a.found ? 'found' : a.error ? 'err' : 'none')}>{a.error ? `Not checked: ${a.error}` : a.found ? <>Already asked{a.in && a.in !== r.where.trim() ? ` in ${a.in}` : ''}{a.when ? ` · ${a.when}` : ''}{a.link && <> · <a href={a.link} target="_blank" rel="noreferrer">open</a></>}</> : 'Not asked yet'}</div>}
            </div>
          )
        })}
        {apps.length > 0 && (
          <div className="bar">
            <button className="sm" onClick={() => setRecipients([...rows, { app: apps[0].app, where: '', tags: [] }])}>+ Recipient</button>
            <button className="sm" disabled={!!busy || !named.length} title={!named.length ? 'Add a channel above first' : 'Searches these channels for the PR link now; posts nothing'}
              onClick={() => { setBusy('ask'); setErr(null); window.api.monitor.checkAsked(session, rows).then((x: Asked[]) => { setAsked(x); reload() }, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null)) }}>
              {busy === 'ask' ? 'Checking…' : `Check ${[...new Set((named.length ? named : apps.slice(0, 1)).map((r) => r.app))].join(', ')}`}</button>
          </div>
        )}
      </div>
      <div className="meta">{notify ? 'Posts when CI passes. Not posted again where it was already raised; each channel is searched for the PR link first.' : 'Off: nothing is posted. You can still check the channels above.'}</div>
      <div className="mon-sub"><b>Production</b></div>
      <div className="mon-form">
        <label>Watch for <select value={win} onChange={(e) => setWin(Number(e.target.value))}>{WINDOWS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select> after deploy</label>
        <label>Check errors <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>{CHECKS.filter(([n]) => n <= win).map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></label>
        <button className="primary sm" disabled={!!busy || (notify && !named.length)}
          onClick={() => act('start', window.api.monitor.start({ session, windowMinutes: win, checkMinutes: every, notify, recipients: notify ? named : [] }).then(started))}>
          {busy === 'start' ? 'Starting…' : `Watch #${v.pr!.number}`}
        </button>
      </div>
      <div className="meta">Follows CI and the merge first; the production watch starts once it is merged and deployed.</div>
    </div>
  )
}

// Where the review request went and who approved it (SIGNOFF-31/D13).
function Requests({ requests }: { requests: Request[] }): React.JSX.Element {
  return (
    <ul className="mon-raised">{requests.map((r) => (
      <li key={r.app + r.place} className={r.state}>
        {r.state === 'approved' ? '✓ Approved' : r.state === 'sent' ? '✓ Sent' : '✓ Found'} {r.app === 'GitHub' ? 'on GitHub' : `${r.state === 'sent' ? 'to' : 'in'} ${r.place} (${r.app})`}{r.by ? ` by ${r.by}` : ''}
        <span className="meta"> · {time(r.at)}{r.message ? ` · ${r.message}` : ''}</span>
      </li>
    ))}</ul>
  )
}
