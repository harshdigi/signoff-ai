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
// - Stop shows only on leftovers, what no live session owns (D3).
// - Memory is the footprint (as Activity Monitor), compressed memory included; a session row lists its tools by memory
//   and has Suspend: Claude and its tools stop, the conversation stays (SIGNOFF-42-IDLE/D6).
const KINDS: [BgProc['kind'], string][] = [['leftover', 'Leftovers'], ['session', 'Claude sessions'], ['terminal', 'Terminals'], ['tool', 'Tools'], ['app', 'The app']]
const when = (ms: number | null): string => (ms ? ago(new Date(ms).toISOString()) : 'not yet')
const mb = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`)
const every = (ms: number): string => (ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`)

type Funes = { entry: string[] | null; shared: boolean; sessions: number; running: boolean }

export default function BackgroundView({ openSession, showTerminal }: { openSession: (id: string) => void; showTerminal: (id: string, title: string) => void }): React.JSX.Element {
  const [funes, setFunes] = useState<Funes | null>(null)
  const [v, setV] = useState<{ processes: BgProc[]; checks: BgCheck[]; memory: 'footprint' | 'resident' } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(() => {
    window.api.background.list().then((x: { processes: BgProc[]; checks: BgCheck[]; memory: 'footprint' | 'resident' }) => { setV(x); setErr(null) }, (e: unknown) => setErr(errText(e)))
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
  const suspend = (p: BgProc): void => {
    if (!p.session) return
    setBusy(p.key)
    window.api.background.suspend(p.session).then(load, (e: unknown) => setErr(errText(e))).finally(() => setBusy(null))
  }
  // funes state reads ~/.claude.json: on open and when a terminal finishes (the switch), not every 3 s.
  const loadFunes = useCallback(() => {
    window.api.background.funes().then(setFunes, (e: unknown) => setErr(errText(e)))
  }, [])
  useEffect(() => {
    loadFunes()
    return window.api.terminal.onExit(loadFunes)
  }, [loadFunes])
  // Shared funes (SIGNOFF-42-IDLE/D9): switched with claude mcp in a terminal you can watch; sessions pick it up when they start.
  const switchFunes = (share: boolean): void => {
    setErr(null)
    ;(share ? window.api.background.share() : window.api.background.unshare()).then((t) => showTerminal(t.id, t.title), (e: unknown) => setErr(errText(e)))
  }
  const total = v?.processes.reduce((n, p) => ({ cpu: n.cpu + p.cpu, mem: n.mem + p.memMB }), { cpu: 0, mem: 0 })
  const windowChecks = listWindowChecks()
  return (
    <div className="side-body bg">
      <SideHead title="BACKGROUND" hint="What the app runs and what wakes it" actions={[{ icon: 'refresh', title: 'Read again now', onClick: load }]} />
      {err && <div className="err">{err}</div>}
      {!v ? <div className="side-empty">Reading…</div> : (
        <>
          <div className="bg-total">CPU {Math.round(total!.cpu)}% · {mb(total!.mem)} in all{v.memory === 'resident' && ' (resident memory only: top could not be read)'}</div>
          {funes?.entry && (
            <div className="bg-group">
              <div className="side-group">funes</div>
              <div className="bg-hint">
                {funes.shared
                  ? `Shared: one funes serves every session (${funes.sessions} connected${funes.running ? '' : ', starts on first use'}). Sessions started before the switch keep their own until they resume.`
                  : 'Each session starts its own funes; one that ran a search can hold over 2 GB. Sharing runs one for all sessions while the app is open; outside the app, each still runs its own.'}
              </div>
              <button className="row-act" onClick={() => switchFunes(!funes.shared)}>{funes.shared ? 'One per session again' : 'Share one funes'}</button>
            </div>
          )}
          {KINDS.map(([kind, title]) => {
            const list = v.processes.filter((p) => p.kind === kind)
            if (!list.length) return null
            return (
              <div key={kind} className="bg-group">
                <div className="side-group">{title}</div>
                {kind === 'session' && <div className="bg-hint">Each session starts its own copy of your MCP tools. To turn one off in a folder: run /mcp in a session there, pick the tool, choose Disable (Claude Code saves it for that folder).</div>}
                {list.map((p) => (
                  <div key={p.key} className={'side-item bg-row' + (p.session && p.kind !== 'leftover' ? '' : ' plain')} title={`${p.detail} · running ${p.since}`}
                    onClick={() => p.session && p.kind !== 'leftover' && openSession(p.session)}>
                    <span className="name">{p.name}</span>
                    <span className="dir">{p.cpu}% · {mb(p.memMB)} · {p.since}</span>
                    {p.kind === 'session' && <button className="row-act" disabled={busy === p.key} title="Suspend: stop Claude and its tools to free memory; sending a message resumes it" onClick={(e) => { e.stopPropagation(); suspend(p) }}>Suspend</button>}
                    {p.stop && <button className="row-act" disabled={busy === p.key} title={`Stop: ${p.detail}`} onClick={(e) => { e.stopPropagation(); stop(p) }}>Stop</button>}
                    {p.tools.length > 1 && <div className="bg-tools">{p.tools.slice(0, 4).map((t) => `${t.name}${t.count > 1 ? ` ×${t.count}` : ''} ${mb(t.memMB)}`).join(' · ')}</div>}
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
