// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from '../ide/types'
import { Icon } from '../ide/icons'
import { AutonomyEditor } from './AutonomyEditor'
import { modeLabel, type Autonomy, type Catalog, type Choice } from './autonomy-choice'

// Autonomy for this session (SIGNOFF-24): a settings icon in the chat box opens the editor above it. A change is saved
// and told to the session at once. The default for new sessions is in Settings.
type Info = Catalog & { autonomy: Autonomy; claudeMode: string | null }

// place: where the panel opens from its icon (down from the session tab bar).
export default function AutonomyPanel({ session, place = 'down' }: { session: string | null; place?: 'up' | 'down' }): React.JSX.Element {
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
  const change = (choice: Choice): void => {
    if (!session) return
    setErr(null)
    window.api.autonomy.set(session, choice).then(() => { load(); window.dispatchEvent(new Event('autonomy-changed')) }, (e: unknown) => setErr(errText(e)))
  }
  const toAuto = (): void => {
    if (!session) return
    window.api.chat.setMode(session, 'auto').then(() => { load(); window.dispatchEvent(new Event('autonomy-changed')) }, (e: unknown) => setErr(errText(e)))
  }
  const paused = !!info && info.autonomy.items.length > 0 && info.claudeMode !== 'auto'
  const title = info ? `Autonomy: ${modeLabel(info, info.autonomy)}. What Claude may decide on your behalf in this session` : 'Autonomy'
  return (
    <span ref={box} className="autonomy">
      <button className="sm icon-btn" disabled={!session} title={title} aria-label={title} onClick={() => setOpen(!open)}><Icon name="gear" /></button>
      {open && info && (
        <div className={'autonomy-panel ' + place}>
          <div className="auto-title"><b>Autonomy</b><span className="meta">this session · {modeLabel(info, info.autonomy)}</span></div>
          {paused && <div className="auto-paused">Paused: this chat&apos;s Claude Code mode is {info.claudeMode ?? 'unknown'}, not Auto, so everything asks you.<button className="sm" onClick={toAuto}>Switch to Auto</button></div>}
          <AutonomyEditor catalog={info} value={info.autonomy} change={change} />
          {err && <div className="err">{err}</div>}
        </div>
      )}
    </span>
  )
}
