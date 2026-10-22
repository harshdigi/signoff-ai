// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { errText } from '../ide/types'

// Discuss or Decide (SIGNOFF-35), on the session tab bar next to the autonomy icon.
// - Discuss: the session talks it through in the chat and posts nothing (no decisions, reviews or actions).
// - Decide: as usual. New sessions start in the default from Settings (Decide unless changed there).
export default function DiscussSwitch({ session }: { session: string | null }): React.JSX.Element | null {
  const [on, setOn] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!session) return
    let gone = false
    const read = (): void => { window.api.autonomy.get(session).then((i: { discuss: boolean }) => { if (!gone) setOn(i.discuss) }, () => {}) }
    read()
    window.addEventListener('autonomy-changed', read)
    return () => { gone = true; window.removeEventListener('autonomy-changed', read) }
  }, [session])
  if (!session || on === null) return null
  const pick = (next: boolean): void => {
    if (next === on) return
    setErr(null)
    window.api.autonomy.discuss(session, next).then(() => { setOn(next); window.dispatchEvent(new Event('autonomy-changed')) }, (e: unknown) => setErr(errText(e)))
  }
  return (
    <span className="discuss-switch" role="radiogroup" aria-label="Discuss or Decide" title={err ?? 'Discuss: talk it through in the chat, nothing is posted. Decide: decisions and reviews go on the board.'}>
      <button role="radio" aria-checked={on} className={on ? 'lit' : ''} onClick={() => pick(true)}>Discuss</button>
      <button role="radio" aria-checked={!on} className={!on ? 'lit' : ''} onClick={() => pick(false)}>Decide</button>
    </span>
  )
}
