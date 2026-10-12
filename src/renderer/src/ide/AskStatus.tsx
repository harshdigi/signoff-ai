// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import Rich from '../board/Rich'
import type { AskState } from './useAsk'

// The visible side of useAsk: sent and working (with a spinner), then Claude's answer, with a way to the chat.
export default function AskStatus({ state, openChat, reset }: { state: AskState; openChat?: () => void; reset: () => void }): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  if (state.phase === 'idle') return null
  return (
    <div className={'ask-status ' + state.phase}>
      <div className="row">
        {state.phase === 'working' && <><span className="spinner" /> <b>{state.label}</b><span className="meta">Sent to Claude, working…</span></>}
        {state.phase === 'done' && <><span className="ok-mark">✓</span> <b>{state.label}</b><span className="meta">Claude answered</span></>}
        {state.phase === 'error' && <><b>{state.label}</b><span className="err">{state.error}</span></>}
        <span className="grow" />
        {openChat && state.phase !== 'error' && <button className="link" onClick={openChat}>Open chat</button>}
        {state.phase === 'done' && <button className="link" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} answer</button>}
        {state.phase !== 'working' && <button className="row-act" title="Dismiss" onClick={reset}>×</button>}
      </div>
      {state.phase === 'done' && open && <div className="ask-answer"><Rich text={state.answer} clampAt={18} /></div>}
    </div>
  )
}
