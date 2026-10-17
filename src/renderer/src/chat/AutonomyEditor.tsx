// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Icon } from '../ide/icons'

// The autonomy editor (SIGNOFF-24): presets, the plan switch, a "Claude | Ask me" switch per item (D8) and the locked
// always-ask rows. Used by a session's panel in the chat box and by the default in Settings.
import type { Autonomy, Catalog, Choice } from './autonomy-choice'

export function AutonomyEditor({ catalog, value, change }: { catalog: Catalog; value: Autonomy; change: (c: Choice) => void }): React.JSX.Element {
  const flip = (id: string, on: boolean): void => {
    if (on === value.items.includes(id)) return
    change({ items: on ? [...value.items, id] : value.items.filter((x) => x !== id), plan: value.plan })
  }
  return (
    <div className="autonomy-editor">
      <div className="auto-modes">
        {Object.entries(catalog.modes).map(([k, m]) => <button key={k} className={'sm' + (value.mode === k ? ' primary' : '')} onClick={() => change({ mode: k })}>{m.label}</button>)}
        {value.mode === 'custom' && <span className="meta">Custom</span>}
      </div>
      <Row label="Approve a plan before Claude runs on its own" left="Yes" right="No" on={value.plan} pick={(v) => change({ items: value.items, plan: v })} />
      {catalog.phases.map((p) => (
        <div key={p.id} className="auto-phase">
          <div className="side-group">{p.label}</div>
          {p.items.map((i) => <Row key={i.id} label={i.label} left="Claude" right="Ask me" on={value.items.includes(i.id)} pick={(v) => flip(i.id, v)} />)}
        </div>
      ))}
      <div className="auto-phase locked">
        <div className="side-group">Always asks you</div>
        {catalog.locked.map((i) => <div key={i.id} className="auto-row"><span>{i.label}</span><span className="auto-lock"><Icon name="lock" />Always asks you</span></div>)}
      </div>
      <p className="meta">Everything Claude decides alone is still recorded on the board, marked as decided by Claude.</p>
    </div>
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
