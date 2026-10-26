// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import { ago } from '../board/types'
import { listWindowChecks, pollWhileShown } from './hooks'
import { SideHead } from './SideHead'
import { errText, type BgCheck, type BgProc } from './types'

// Background (left bar): what the app runs and what wakes it (SIGNOFF-39-PROCS).
// - Processes, with CPU and memory; a session's row includes the tools it runs. Read every 3 s while open and on screen.
// - Checks: the app's timers, how often they run, and whether they are paused (window off screen).
// - Stop shows only on leftovers, what no live session owns (D3). Sessions are stopped from their own page.
const KINDS: [BgProc['kind'], string][] = [['leftover', 'Leftovers'], ['session', 'Claude sessions'], ['terminal', 'Terminals'], ['tool', 'Tools'], ['app', 'The app']]
const when = (ms: number | null): string => (ms ? ago(new Date(ms).toISOString()) : 'not yet')
const every = (ms: number): string => (ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`)

export default function BackgroundView({ openSession }: { openSession: (id: string) => void }): React.JSX.Element {
  const [v, setV] = useState<{ processes: BgProc[]; checks: BgCheck[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => {
    window.api.background.list().then((x: { processes: BgProc[]; checks: BgCheck[] }) => { setV(x); setErr(null) }, (e: unknown) => setErr(errText(e)))
  }, [])
  useEffect(() => {
    load()
    return pollWhileShown(load, 3000, 'Background view')
  }, [load])
  const stop = (p: BgProc): void => {
    if (!p.stop || !confirm(`Stop ${p.name}?\n\n${p.detail}.`)) return
    setBusy(p.key)
    window.api.background.stop(p.stop).then(load, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  const total = v?.processes.reduce((n, p) => ({ cpu: n.cpu + p.cpu, mem: n.mem + p.memMB }), { cpu: 0, mem: 0 })
  const windowChecks = listWindowChecks()
  return (
    <div className="side-body bg">
      <SideHead title="BACKGROUND" hint="What the app runs and what wakes it" actions={[{ icon: 'refresh', title: 'Read again now', onClick: load }]} />
      {err && <div className="err">{err}</div>}
      {!v ? <div className="side-empty">Reading…</div> : (
        <>
          <div className="bg-total">CPU {Math.round(total!.cpu)}% · {total!.mem} MB in all</div>
          {KINDS.map(([kind, title]) => {
            const list = v.processes.filter((p) => p.kind === kind)
            if (!list.length) return null
            return (
              <div key={kind} className="bg-group">
                <div className="side-group">{title}</div>
                {list.map((p) => (
                  <div key={p.key} className={'side-item bg-row' + (p.session && p.kind !== 'leftover' ? '' : ' plain')} title={`${p.detail} · running ${p.since}`}
                    onClick={() => p.session && p.kind !== 'leftover' && openSession(p.session)}>
                    <span className="name">{p.name}</span>
                    <span className="dir">{p.cpu}% · {p.memMB} MB · {p.since}</span>
                    {p.stop && <button className="row-act" disabled={busy === p.key} title={`Stop: ${p.detail}`} onClick={(e) => { e.stopPropagation(); stop(p) }}>Stop</button>}
                  </div>
                ))}
              </div>
            )
          })}
          <div className="bg-group">
            <div className="side-group">Checks</div>
            {v.checks.map((c) => (
              <div key={c.id} className="side-item bg-row plain" title={c.pausesWhenHidden ? 'Pauses while the window is off screen' : 'Keeps running while the window is off screen'}>
                <span className="name">{c.label}</span>
                <span className="dir">{c.paused ? 'paused' : c.every} · last {when(c.lastRun)}</span>
              </div>
            ))}
            {windowChecks.map((c) => (
              <div key={c.label} className="side-item bg-row plain" title="Runs only while this panel is open and the window is on screen">
                <span className="name">{c.label}</span>
                <span className="dir">{every(c.everyMs)} · last {when(c.lastRun)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
