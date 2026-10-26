// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import { pollWhileShown } from './hooks'
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
type Asked = { app: string; where: string; found: boolean; in?: string; when?: string; link?: string; error?: string }
type Request = { app: string; place: string; state: 'sent' | 'found' | 'approved'; message: string | null; by: string | null; at: string }
type Mon = { id: string; stage: string; window_minutes: number; check_minutes: number; notify: number; session_id: string | null; events: Event[] }
type Pr = { number: number; url: string; title: string; state: string }
type View = {
  repo: string | null; problem: string | null; pr: Pr | null
  setup: { found: Found; foundAt: string; chosen: Chosen | null } | null
  monitor: Mon | null
  requests: Request[]
  team: { session: string; title: string | null; repo: string | null; pr: Pr | null; monitor: Mon | null }[]
}
const WINDOWS = [[60, '1 hour'], [240, '4 hours'], [1440, '24 hours']] as const
const CHECKS = [[15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour']] as const
const STAGE: Record<string, string> = { ci: 'CI running', merge: 'Waiting for merge', deploy: 'Waiting for deploy', stable: 'Watching production', done: 'Done', incident: 'Incident', stopped: 'Stopped' }
const TRACK: Record<string, string> = { ci: 'CI', merge: 'Merge', deploy: 'Production deploy', done: 'Done' }
const time = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// The panel's last view and your unsaved choices, per session (SIGNOFF-31/D8). Ship is dropped when you switch tabs;
// coming back shows these at once and refreshes quietly. Kept in memory only, until the app quits.
type Kept = { v: View | null; win: number; every: number; notify: boolean; recipients: Recipient[] | null; asked: Asked[] | null }
const kept = new Map<string, Kept>()

export default function MonitorPanel({ session }: { session: string }): React.JSX.Element {
  const k = kept.get(session)
  const [v, setV] = useState<View | null>(k?.v ?? null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
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
    return pollWhileShown(load, 10_000)
  }, [load])
  const act = (what: string, p: Promise<unknown>): void => {
    setBusy(what)
    setErr(null)
    p.then(load, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  if (!v) return <div className="monitor"><div className="meta">{err ?? 'Loading the monitor…'}</div></div>
  const found = v.setup?.found
  const chosen = v.setup?.chosen ?? {}
  // No saved default and nothing added yet: one empty row for the first app, so the channel box and Check are visible.
  const rows = recipients ?? (chosen.recipients?.length ? chosen.recipients : found?.messaging.length ? [{ app: found.messaging[0].app, where: '', tags: [] }] : [])
  const setRow = (i: number, r: Recipient | null): void => {
    const next = [...rows]
    if (r) next[i] = r; else next.splice(i, 1)
    setRecipients(next)
  }
  const apps = found?.messaging ?? []
  // Default recipients per repo (SIGNOFF-31/D4): a checkbox on each row saves or drops it at once; no separate button.
  const defaults = chosen.recipients ?? []
  const same = (a: Recipient, b: Recipient): boolean => a.app === b.app && a.where.trim() === b.where.trim()
  const isDefault = (r: Recipient): boolean => !!r.where.trim() && defaults.some((d) => same(d, r))
  const saveDefaults = (next: Recipient[]): void => act('choose', window.api.monitor.choose(v.repo!, { ...chosen, recipients: next }))
  const markDefault = (r: Recipient, on: boolean): void => saveDefaults(on ? [...defaults.filter((d) => !same(d, r)), r] : defaults.filter((d) => !same(d, r)))
  const track = ['ci', 'merge', 'deploy', 'stable', 'done']
  const deploy = chosen.deployWorkflow ?? found?.deploy.workflow ?? null
  // Steps (SIGNOFF-31/D1): 1 repo setup, 2 review request, 3 production watch; then team pull requests.
  const step = (n: number, title: string, done: boolean, body: React.ReactNode, side?: React.ReactNode): React.JSX.Element => (
    <li className={'mon-step' + (done ? ' done' : '')}>
      <span className="step-n">{done ? '✓' : n}</span>
      <div className="step-body"><div className="step-title"><b>{title}</b><span className="grow" />{side}</div>{body}</div>
    </li>
  )
  return (
    <div className="monitor">
      <div className="mon-head"><b>After the PR: monitor</b>{v.repo && <span className="meta">{v.repo}{v.pr ? ` #${v.pr.number}` : ''}</span>}</div>
      {v.problem && <div className="meta">{v.problem}</div>}
      {err && <div className="err">{err}</div>}

      {v.repo && (
        <ol className="mon-steps">
          {step(1, 'Repo setup', !!found, found ? (
            <>
              <div className="mon-chips">
                {apps.map((x) => <span key={x.app} className="chip ok">✓ {x.app}</span>)}
                {found.errors.map((x) => <span key={x.app} className="chip ok">✓ {x.app}</span>)}
                <span className={'chip ' + (deploy ? 'ok' : 'todo')} title={deploy ?? undefined}>{deploy ? `✓ ${deploy.replace(/\s*\(.*\)$/, '')}` : '○ no deploy workflow'}</span>
                {!apps.length && <span className="chip todo">○ no messaging app</span>}
                {!found.errors.length && <span className="chip todo">○ no error tool</span>}
              </div>
              <details className="fold mon-details">
                <summary className="meta">Details{found.notes.length ? ` · notes (${found.notes.length})` : ''}</summary>
                <label>Production deploy workflow <input defaultValue={deploy ?? ''} onBlur={(e) => act('choose', window.api.monitor.choose(v.repo!, { ...chosen, deployWorkflow: e.target.value.trim() || undefined }))} /></label>
                <div className="meta">Starts: {found.deploy.trigger}</div>
                {found.notes.length > 0 && <ul className="meta mon-notes">{found.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              </details>
            </>
          ) : <p className="meta">Claude checks which connected apps can post messages and show production errors, and how this repo deploys. It only reads.</p>,
          <button className="sm" disabled={!!busy} title="Scans your connected apps (messaging, errors) and this repo's deploy setup again. Read-only, about a minute. Use it after connecting an app in Tools." onClick={() => act('setup', window.api.monitor.setup(session))}>{busy === 'setup' ? 'Scanning (about a minute)…' : found ? 'Re-scan apps' : 'Set up'}</button>)}

          {v.monitor ? step(2, 'Watching', v.monitor.stage === 'done', (
            <>
              {track.includes(v.monitor.stage)
                ? <div className="mon-track">{track.map((t, i) => <span key={t} className={'chip ' + (t === v.monitor!.stage ? 'on' : i < track.indexOf(v.monitor!.stage) ? 'ok' : 'todo')}>{t === 'stable' ? `Watching (${v.monitor!.window_minutes} min)` : TRACK[t]}</span>)}</div>
                : <div className="mon-stage"><span className={'pill ' + v.monitor.stage}>{STAGE[v.monitor.stage] ?? v.monitor.stage}</span></div>}
              <span className="meta">Errors checked every {v.monitor.check_minutes} min while watching · {v.monitor.id}</span>
              <ol className="mon-events">{v.monitor.events.map((e, i) => <li key={i} className={e.kind}><span className="meta">{time(e.at)}</span> {e.text}</li>)}</ol>
            </>
          ), <button className="sm" disabled={!!busy} onClick={() => act('stop', window.api.monitor.stop(v.monitor!.id, 'stopped from Ship'))}>Stop</button>) : (
            <>
              {step(2, 'Review request', v.requests.some((r) => r.state === 'approved'), found ? (
                <>
                  {v.requests.length > 0 && <ul className="mon-raised">{v.requests.map((r) => (
                    <li key={r.app + r.place} className={r.state}>
                      {r.state === 'approved' ? '✓ Approved' : r.state === 'sent' ? '✓ Sent' : '✓ Found'} {r.app === 'GitHub' ? 'on GitHub' : `${r.state === 'sent' ? 'to' : 'in'} ${r.place} (${r.app})`}{r.by ? ` by ${r.by}` : ''}
                      <span className="meta"> · {time(r.at)}{r.message ? ` · ${r.message}` : ''}</span>
                    </li>
                  ))}</ul>}
                  <label className="inline"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Post &quot;PR is up for review&quot; when CI passes</label>
                  {(
                    <div className="mon-recipients">
                      {apps.length === 0 && <div className="meta">No connected app can post messages. Connect one in Tools, then Re-scan apps.</div>}
                      {rows.map((r, i) => {
                        const dests = apps.find((x) => x.app === r.app)?.destinations ?? []
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
                            {(() => {
                              const a = asked?.find((x) => x.app === r.app && x.where === r.where.trim())
                              return a && <div className={'mon-asked ' + (a.found ? 'found' : a.error ? 'err' : 'none')}>{a.error ? `Not checked: ${a.error}` : a.found ? <>Already asked{a.in && a.in !== r.where.trim() ? ` in ${a.in}` : ''}{a.when ? ` · ${a.when}` : ''}{a.link && <> · <a href={a.link} target="_blank" rel="noreferrer">open</a></>}</> : 'Not asked yet'}</div>
                            })()}
                          </div>
                        )
                      })}
                      <div className="bar">
                        {apps.length > 0 && <button className="sm" onClick={() => setRecipients([...rows, { app: apps[0].app, where: '', tags: [] }])}>+ Recipient</button>}
                        {apps.length > 0 && <button className="sm" disabled={!!busy || !v.pr || !rows.some((r) => r.where.trim())}
                          title={!v.pr ? 'Needs a pull request first' : !rows.some((r) => r.where.trim()) ? 'Add a channel above first' : 'Searches these channels for the PR link now; posts nothing'}
                          onClick={() => { setBusy('ask'); setErr(null); window.api.monitor.checkAsked(session, rows).then((x: Asked[]) => { setAsked(x); load() }, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null)) }}>
                          {busy === 'ask' ? 'Checking…' : `Check ${[...new Set((rows.some((r) => r.where.trim()) ? rows.filter((r) => r.where.trim()) : apps.slice(0, 1)).map((r) => r.app))].join(', ')}`}</button>}
                      </div>
                    </div>
                  )}
                  <div className="meta">{notify ? 'Posts when CI passes. Not posted again where it was already raised; each channel is searched for the PR link first.' : 'Off: nothing is posted. You can still check the channels above.'}</div>
                </>
              ) : <p className="meta">After setup.</p>)}
              {step(3, 'Watch production', false, found ? (
                <>
                  <div className="mon-form">
                    <label>For <select value={win} onChange={(e) => setWin(Number(e.target.value))}>{WINDOWS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select> after deploy</label>
                    <label>Check errors <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>{CHECKS.filter(([m]) => m <= win).map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
                  </div>
                  <div className="meta">Starts after the PR is merged and deployed to production; until then it follows CI and the merge.</div>
                  {!v.pr && <div className="meta">Needs a pull request: use Open PR above first.</div>}
                </>
              ) : <p className="meta">After setup.</p>,
              found && <button className="primary sm" disabled={!!busy || !v.pr || (notify && !rows.some((r) => r.where.trim()))}
                onClick={() => act('start', window.api.monitor.start({ session, windowMinutes: win, checkMinutes: every, notify, recipients: notify ? rows.filter((r) => r.where.trim()) : [] }))}>
                {busy === 'start' ? 'Starting…' : 'Start monitor'}
              </button>)}
            </>
          )}
        </ol>
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
    </div>
  )
}
