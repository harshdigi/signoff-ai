// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState } from 'react'

// Voice input for the chat box (main/speech.ts). What you say is added after what is already typed, live.
// - Hold to talk: press starts, release stops. Slide up to lock: it keeps listening after you let go.
// - Send or Enter while listening: stops the mic, waits for the last words, then sends everything.
// - off → starting (mic opening) → on (listening) → stopping (finishing the last words) → off.
// - autoSend (Settings) is read at each start: when on, stopping also sends.
export type VoiceState = 'off' | 'starting' | 'on' | 'stopping'
type Opts = { text: () => string; setText: (t: string) => void; send: (t: string) => void; error: (m: string) => void }
export type Voice = {
  state: VoiceState
  locked: boolean
  press: () => void
  release: () => void
  lock: () => void
  stop: () => void
  // true: the mic was on, so the message is sent once the last words arrive. false: send as usual.
  stopAndSend: () => boolean
}

export function useVoice(opts: Opts): Voice {
  const [state, setState] = useState<VoiceState>('off')
  const [locked, setLocked] = useState(false)
  const o = useRef(opts)
  const base = useRef('')
  const heard = useRef<string | null>(null)
  const autoSend = useRef(false)
  const sendAfter = useRef(false)
  const live = state === 'starting' || state === 'on'
  useEffect(() => { o.current = opts })
  useEffect(() => window.api.speech.onEvent((e) => {
    if (e.type === 'ready') setState('on')
    else if (e.type === 'partial' || e.type === 'final') {
      heard.current = base.current + e.text
      o.current.setText(heard.current)
    } else if (e.type === 'error') o.current.error(e.message)
    else if (e.type === 'ended') {
      // The box as it stands: typed text plus the last words heard (nothing heard, e.g. after an error: what was typed).
      const text = heard.current ?? o.current.text()
      if ((sendAfter.current || autoSend.current) && text.trim()) o.current.send(text)
      sendAfter.current = false
      setLocked(false)
      setState('off')
    }
  }), [])

  const start = (): void => {
    const typed = o.current.text()
    base.current = typed.trim() ? typed.replace(/\s*$/, ' ') : ''
    heard.current = null
    sendAfter.current = false
    setLocked(false)
    setState('starting')
    void window.api.settings.get().then((s: { speechAutoSend: boolean }) => {
      autoSend.current = s.speechAutoSend
      return window.api.speech.start()
    }).catch((e: unknown) => {
      o.current.error(e instanceof Error ? e.message : String(e))
      setState('off')
    })
  }
  const stop = (): void => {
    if (!live) return
    setState('stopping')
    void window.api.speech.stop()
  }
  return {
    state,
    locked,
    press: () => { if (state === 'off') start() },
    release: () => { if (!locked) stop() },
    lock: () => { if (live) setLocked(true) },
    stop,
    stopAndSend: () => {
      if (state === 'off') return false
      sendAfter.current = true
      stop()
      return true
    }
  }
}
