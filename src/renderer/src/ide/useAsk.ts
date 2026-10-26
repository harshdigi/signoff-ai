// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState } from 'react'

// Asking Claude from a panel (Test plan, Impact, Ship, Run): the request goes to the session's chat, and the panel
// shows that it was sent, that Claude is working, and then Claude's answer itself (read back from the chat).
export type AskState =
  | { phase: 'idle' }
  | { phase: 'working'; label: string }
  | { phase: 'done'; label: string; answer: string }
  | { phase: 'error'; label: string; error: string }

import { answerAfter, type Ev } from './answer'
import { pollWhileShown } from './hooks'

const ASK_TAIL = 300 // chat events looked at for the answer

export function useAsk(session: string | null, send: (text: string) => void): { state: AskState; ask: (text: string, label: string) => void; reset: () => void } {
  const [state, setState] = useState<AskState>({ phase: 'idle' })
  const sent = useRef<string | null>(null)
  const ask = (text: string, label: string): void => {
    if (!session) return setState({ phase: 'error', label, error: 'Open or start a session first: Claude works in its chat.' })
    sent.current = text
    send(text)
    setState({ phase: 'working', label })
  }
  // Check after every status change and chat event: done once the chat has our prompt and the end of its turn.
  useEffect(() => {
    if (state.phase !== 'working' || !session) return
    let alive = true
    const check = (): void => {
      const text = sent.current
      if (!text) return
      // The chat's end is enough: the prompt was sent moments ago (SIGNOFF-38-PERF/D1).
      void window.api.chat.tail(session, ASK_TAIL).then(({ events }: { events: Ev[] }) => {
        const answer = answerAfter(events, text)
        if (alive && answer !== null) setState({ phase: 'done', label: state.label, answer })
      })
    }
    const offStatus = window.api.chat.onStatus((st: { session: string; busy: boolean }) => st.session === session && !st.busy && check())
    const stop = pollWhileShown(check, 5000, 'Ask: waiting for an answer') // a turn can end without a status change reaching us (e.g. the window reloaded)
    return () => { alive = false; offStatus(); stop() }
  }, [state, session])
  return { state, ask, reset: () => setState({ phase: 'idle' }) }
}
