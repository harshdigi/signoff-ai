// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from '../ide/types'

// Autonomy (SIGNOFF-24, step 5): what Claude may settle on your behalf in this session. Modes are presets that tick
// the boxes; a changed box makes it Custom. The locked list always asks and cannot be ticked. A change is told to the
// session at once. Opens above the composer.
type Item = { id: string; label: string }
type Autonomy = { mode: string; items: string[]; plan: boolean }
type Info = { autonomy: Autonomy; phases: { id: string; label: string; items: Item[] }[]; locked: Item[]; modes: Record<string, { label: string; items: string[] }> }

export default function AutonomyPanel({ session }: { session: string | null }): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const load = useCallback(() => {
    if (session) window.api.autonomy.get(session).then((i: Info) => setInfo(i), (e: unknown) => setErr(errText(e)))
  }, [session])
  useEffect(load, [load])
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc) }
  }, [open])
  const set = (choice: { mode?: string; items?: string[]; plan?: boolean }): void => {
    if (!session) return
    setErr(null)
    window.api.autonomy.set(session, choice).then(load, (e: unknown) => setErr(errText(e)))
  }
  const a = info?.autonomy
  const label = !a ? 'Autonomy' : a.mode === 'custom' ? 'Custom autonomy' : info!.modes[a.mode]?.label ?? a.mode
  const toggle = (id: string): void => { if (a) set({ items: a.items.includes(id) ? a.items.filter((x) => x !== id) : [...a.items, id], plan: a.plan }) }
  return (
    <span ref={box} className="autonomy">
      <button className="sm" disabled={!session} title="What Claude may decide on your behalf in this session" onClick={() => setOpen(!open)}>{label}</button>
      {open && info && a && (
        <div className="autonomy-panel">
          <div className="auto-modes">
            {Object.entries(info.modes).map(([k, m]) => <button key={k} className={'sm' + (a.mode === k ? ' primary' : '')} onClick={() => set({ mode: k })}>{m.label}</button>)}
            {a.mode === 'custom' && <span className="meta">Custom</span>}
          </div>
          <label className="inline auto-plan"><input type="checkbox" checked={a.plan} onChange={(e) => set({ items: a.items, plan: e.target.checked })} /> Approve a plan before Claude runs on its own</label>
          {info.phases.map((p) => (
            <div key={p.id} className="auto-phase">
              <div className="side-group">{p.label}</div>
              {p.items.map((i) => <label key={i.id} className="inline"><input type="checkbox" checked={a.items.includes(i.id)} onChange={() => toggle(i.id)} /> {i.label}</label>)}
            </div>
          ))}
          <div className="auto-phase locked">
            <div className="side-group">Always asks you</div>
            {info.locked.map((i) => <label key={i.id} className="inline"><input type="checkbox" checked={false} disabled /> {i.label}</label>)}
          </div>
          <p className="meta">Everything Claude decides alone is still recorded on the board, marked as decided by Claude.</p>
          {err && <div className="err">{err}</div>}
        </div>
      )}
    </span>
  )
}
