// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from '../ide/types'
import { Icon } from '../ide/icons'

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
          <Row label="Approve a plan before Claude runs on its own" left="Yes" right="No" on={a.plan} pick={(v) => set({ items: a.items, plan: v })} />
          {info.phases.map((p) => (
            <div key={p.id} className="auto-phase">
              <div className="side-group">{p.label}</div>
              {p.items.map((i) => <Row key={i.id} label={i.label} left="Claude" right="Ask me" on={a.items.includes(i.id)} pick={(v) => { if (v !== a.items.includes(i.id)) toggle(i.id) }} />)}
            </div>
          ))}
          <div className="auto-phase locked">
            <div className="side-group">Always asks you</div>
            {info.locked.map((i) => <div key={i.id} className="auto-row"><span>{i.label}</span><span className="auto-lock"><Icon name="lock" />Always asks you</span></div>)}
          </div>
          <p className="meta">Everything Claude decides alone is still recorded on the board, marked as decided by Claude.</p>
          {err && <div className="err">{err}</div>}
        </div>
      )}
    </span>
  )
}

// One row: what it is, and a two-way switch saying who decides (SIGNOFF-24/D8). The lit side is the current choice.
function Row({ label, left, right, on, pick }: { label: string; left: string; right: string; on: boolean; pick: (v: boolean) => void }): React.JSX.Element {
  return (
    <div className="auto-row">
      <span>{label}</span>
      <span className="auto-switch" role="radiogroup" aria-label={label}>
        <button role="radio" aria-checked={on} className={on ? 'lit claude' : ''} onClick={() => pick(true)}>{left}</button>
        <button role="radio" aria-checked={!on} className={!on ? 'lit ask' : ''} onClick={() => pick(false)}>{right}</button>
      </span>
    </div>
  )
}
