// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import { errText } from './types'

// Monitor (Ship, SIGNOFF-23 step 4): after the PR, one watch from CI through the production deploy to a stability
// window. The app follows GitHub itself; a failure opens fire fighting. Never two monitors on one pull request.
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
type Mon = { id: string; stage: string; window_minutes: number; check_minutes: number; notify: number; session_id: string | null; events: Event[] }
type Pr = { number: number; url: string; title: string; state: string }
type View = {
  repo: string | null; problem: string | null; pr: Pr | null
  setup: { found: Found; foundAt: string; chosen: Chosen | null } | null
  monitor: Mon | null
  team: { session: string; title: string | null; repo: string | null; pr: Pr | null; monitor: Mon | null }[]
}
const WINDOWS = [[60, '1 hour'], [240, '4 hours'], [1440, '24 hours']] as const
const CHECKS = [[15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour']] as const
const STAGE: Record<string, string> = { ci: 'CI running', merge: 'Waiting for merge', deploy: 'Waiting for deploy', stable: 'Watching production', done: 'Done', incident: 'Incident', stopped: 'Stopped' }
const time = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function MonitorPanel({ session }: { session: string }): React.JSX.Element {
  const [v, setV] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [win, setWin] = useState(60)
  const [every, setEvery] = useState(30)
  const [notify, setNotify] = useState(false) // D2: opt-in, off by default
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
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
  const chosen = v.setup?.chosen ?? {}
  const rows = recipients ?? chosen.recipients ?? []
  const setRow = (i: number, r: Recipient | null): void => {
    const next = [...rows]
    if (r) next[i] = r; else next.splice(i, 1)
    setRecipients(next)
  }
  const apps = found?.messaging ?? []
  return (
    <div className="monitor">
      <div className="mon-head"><b>After the PR: monitor</b>{v.repo && <span className="meta">{v.repo}{v.pr ? ` #${v.pr.number}` : ''}</span>}</div>
      {v.problem && <div className="meta">{v.problem}</div>}
      {err && <div className="err">{err}</div>}

      {v.repo && !v.setup && (
        <div className="mon-block">
          <p className="meta">First, Claude checks which of your connected apps can post messages and show production errors, and how this repo deploys. It only reads; it sends nothing.</p>
          <button disabled={!!busy} onClick={() => act('setup', window.api.monitor.setup(session))}>{busy === 'setup' ? 'Checking (about a minute)…' : 'Set up monitoring for this repo'}</button>
        </div>
      )}

      {found && (
        <details className="mon-block fold">
          <summary className="side-group">Repo setup: {apps.map((a) => a.app).join(', ') || 'no messaging app'} · {found.errors.map((e) => e.app).join(', ') || 'no error tool'} · deploy: {chosen.deployWorkflow ?? found.deploy.workflow ?? 'none found'}</summary>
          <label>Production deploy workflow <input defaultValue={chosen.deployWorkflow ?? found.deploy.workflow ?? ''} onBlur={(e) => act('choose', window.api.monitor.choose(v.repo!, { ...chosen, deployWorkflow: e.target.value.trim() || undefined }))} /></label>
          <div className="meta">{found.deploy.trigger}</div>
          {found.notes.length > 0 && <ul className="meta">{found.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <button className="sm" disabled={!!busy} onClick={() => act('setup', window.api.monitor.setup(session))}>{busy === 'setup' ? 'Checking…' : 'Check again'}</button>
        </details>
      )}

      {v.monitor ? (
        <div className="mon-block">
          <div className="mon-stage"><span className={'pill ' + v.monitor.stage}>{STAGE[v.monitor.stage] ?? v.monitor.stage}</span>
            <span className="meta">{v.monitor.id} · {v.monitor.window_minutes} min after deploy · checks every {v.monitor.check_minutes} min</span>
            <span className="grow" />
            <button className="sm" disabled={!!busy} onClick={() => act('stop', window.api.monitor.stop(v.monitor!.id, 'stopped from Ship'))}>Stop</button>
          </div>
          <ol className="mon-events">{v.monitor.events.map((e, i) => <li key={i} className={e.kind}><span className="meta">{time(e.at)}</span> {e.text}</li>)}</ol>
        </div>
      ) : v.repo && v.setup && (
        <div className="mon-block">
          {!v.pr && <p className="meta">This branch has no pull request yet. Open it first (Open PR above), then start the monitor.</p>}
          <div className="mon-form">
            <label>Watch production for <select value={win} onChange={(e) => setWin(Number(e.target.value))}>{WINDOWS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
            <label>Error check <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>{CHECKS.filter(([m]) => m <= win).map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
          </div>
          <label className="inline"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Post a review request when CI passes</label>
          {notify && (
            <div className="mon-recipients">
              {apps.length === 0 && <div className="meta">No connected app can post messages. Connect one in Tools, then Check again.</div>}
              {rows.map((r, i) => {
                const dests = apps.find((a) => a.app === r.app)?.destinations ?? []
                return (
                  <div key={i} className="mon-row">
                    <select value={r.app} onChange={(e) => setRow(i, { ...r, app: e.target.value })}>{apps.map((a) => <option key={a.app}>{a.app}</option>)}</select>
                    <input list={`dest-${i}`} placeholder="channel or person" value={r.where} onChange={(e) => setRow(i, { ...r, where: e.target.value })} />
                    <datalist id={`dest-${i}`}>{dests.filter((d) => d.kind !== 'group').map((d) => <option key={d.name} value={d.name} />)}</datalist>
                    <input list={`tag-${i}`} placeholder="tag: @team, @person (comma separated)" value={r.tags.join(', ')} onChange={(e) => setRow(i, { ...r, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                    <datalist id={`tag-${i}`}>{dests.filter((d) => d.kind !== 'channel').map((d) => <option key={d.name} value={d.name} />)}</datalist>
                    <button className="sm" title="Remove" onClick={() => setRow(i, null)}>×</button>
                  </div>
                )
              })}
              {apps.length > 0 && <button className="sm" onClick={() => setRecipients([...rows, { app: apps[0].app, where: '', tags: [] }])}>+ Recipient</button>}
              {rows.length > 0 && <button className="sm" onClick={() => act('choose', window.api.monitor.choose(v.repo!, { ...chosen, recipients: rows }))}>Save as the default for this repo</button>}
            </div>
          )}
          <div className="bar">
            <button className="primary" disabled={!!busy || !v.pr || (notify && !rows.some((r) => r.where.trim()))}
              onClick={() => act('start', window.api.monitor.start({ session, windowMinutes: win, checkMinutes: every, notify, recipients: notify ? rows.filter((r) => r.where.trim()) : [] }))}>
              {busy === 'start' ? 'Starting…' : 'Start monitor'}
            </button>
          </div>
        </div>
      )}

      {v.team.length > 0 && (
        <div className="mon-block">
          <div className="side-group">Team pull requests</div>
          {v.team.map((t) => (
            <div key={t.session} className="mon-row">
              <span className="name">{t.title ?? t.session.slice(0, 8)}</span>
              <span className="meta">{t.pr ? `#${t.pr.number}` : 'no PR yet'}</span>
              <span className="grow" />
              {t.monitor ? <span className="meta">{STAGE[t.monitor.stage]} · {t.monitor.id}{t.monitor.session_id === session ? '' : ' (watched by its session)'}</span>
                : t.pr && <button className="sm" disabled={!!busy || !v.setup} onClick={() => act('start', window.api.monitor.start({ session: t.session, owner: session, windowMinutes: win, checkMinutes: every, notify: false, recipients: [] }))}>Watch</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
