// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useRef, useState } from 'react'
import type { Voice } from './use-voice'
import { Icon } from '../ide/icons'

// The chat's mic: hold to talk, release to stop. Slide up onto the lock to keep listening hands-free;
// then click ■ (or Send / Enter) to stop. A quick tap only shows how it works.
const LOCK_AT = 48 // px dragged up that locks it
const TAP_MS = 300

export function MicButton({ voice, disabled }: { voice: Voice; disabled: boolean }): React.JSX.Element {
  const from = useRef<{ y: number; at: number } | null>(null)
  const [holding, setHolding] = useState(false)
  const [near, setNear] = useState(false)
  const [hint, setHint] = useState(false)
  const end = (): void => {
    const f = from.current
    from.current = null
    setHolding(false)
    setNear(false)
    if (!f || voice.locked) return
    voice.release()
    if (Date.now() - f.at < TAP_MS) {
      setHint(true)
      setTimeout(() => setHint(false), 2500)
    }
  }
  const title = voice.locked ? 'Listening (locked): click to stop, or press Send'
    : voice.state === 'off' ? 'Hold to talk, slide up to lock. Or hold ⌥Space. On this Mac only.'
    : voice.state === 'stopping' ? 'Finishing your last words…' : 'Listening: release to stop, slide up to lock'
  return (
    <span className="mic-wrap">
      {holding && !voice.locked && <span className={'mic-lock' + (near ? ' near' : '')}>🔒<br />↑</span>}
      <button className={'mic mic-' + voice.state + (voice.locked ? ' locked' : '')} disabled={disabled} title={title}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (voice.state !== 'off') return voice.stop() // locked (or finishing): a click stops it
          e.currentTarget.setPointerCapture(e.pointerId)
          from.current = { y: e.clientY, at: Date.now() }
          setHolding(true)
          voice.press()
        }}
        onPointerMove={(e) => {
          if (!from.current) return
          const up = from.current.y - e.clientY >= LOCK_AT
          setNear(up)
          if (up) {
            voice.lock()
            from.current = null
            setHolding(false)
          }
        }}
        onPointerUp={end} onPointerCancel={end}>
        {voice.state === 'stopping' ? '…' : <Icon name={voice.locked ? 'stop' : 'mic'} />}
      </button>
      {hint && <span className="mic-hint">Hold to talk · slide up to lock</span>}
    </span>
  )
}
