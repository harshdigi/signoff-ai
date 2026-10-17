// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { modeLabel, type Autonomy, type Catalog } from './autonomy-choice'

// The grey line above the chat box: this session's mode (Ask as you go, Plan first then run, Full auto, Custom).
// Re-read when the session changes and after a change in the autonomy panel.
export function useAutonomyLine(session: string | null): string | null {
  const [line, setLine] = useState<string | null>(null)
  useEffect(() => {
    if (!session) return
    let gone = false
    const read = (): void => {
      window.api.autonomy.get(session).then((i: Catalog & { autonomy: Autonomy }) => {
        if (gone) return
        setLine(`Mode: ${modeLabel(i, i.autonomy)}`)
      }, () => { if (!gone) setLine(null) })
    }
    read()
    window.addEventListener('autonomy-changed', read)
    return () => { gone = true; window.removeEventListener('autonomy-changed', read) }
  }, [session])
  return session ? line : null
}
