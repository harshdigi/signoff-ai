// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { time } from '../board/types'
import { errText } from './types'

// Resume: pick an earlier Claude Code conversation in this folder (like `claude --resume`) and continue it here.
type Conversation = { id: string; title: string; at: string }

export default function ResumePicker({ close, opened }: { close: () => void; opened: (session: string) => void }): React.JSX.Element {
  const [all, setAll] = useState<Conversation[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    window.api.chat.conversations().then(setAll, (e: unknown) => setErr(errText(e)))
  }, [])
  const shown = (all ?? []).filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
  const pick = (c: Conversation): void => {
    window.api.chat.resume(c.id, c.title).then((id) => { close(); opened(id) }, (e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Resume a Claude conversation from this folder" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && close()} />
        <div className="palette-list">
          {all === null && !err && <div className="meta">Loading…</div>}
          {shown.map((c) => (
            <div key={c.id} onClick={() => pick(c)} title={c.id}>{c.title}<span className="meta"> {time(c.at)}</span></div>
          ))}
          {all !== null && !shown.length && <div className="meta">No saved Claude conversations{q ? ' match' : ' for this folder'}.</div>}
          {err && <div className="err">{err}</div>}
        </div>
        <div className="meta pad-s">If the conversation is still open in another terminal (not the shared one), close it there first.</div>
      </div>
    </div>
  )
}
