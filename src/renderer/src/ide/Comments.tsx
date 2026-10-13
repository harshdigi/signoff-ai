// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import Rich from '../board/Rich'
import { time, type Comment } from '../board/types'
import { errText } from './types'
import { CodePre } from './CodeBlock'
import { languageForPath } from './languages'

// Code comments in review: write one on selected lines, keep it as a draft to batch, or send it straight to the chat.
// Claude's answer (signoff comment reply) shows here, next to the code, as well as in the chat.
export type Selection = { start: number; end: number; code: string }
const lines = (c: { start_line: number; end_line: number }): string => (c.end_line > c.start_line ? `L${c.start_line}–${c.end_line}` : `L${c.start_line}`)

export function CommentBox({ sel, add, cancel }: { sel: Selection; add: (text: string, send: boolean) => Promise<void>; cancel: () => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const go = (send: boolean): void => void add(text, send).then(() => setText(''), (e: unknown) => setErr(errText(e)))
  return (
    <div className="cm-box">
      <div className="meta">Comment on {sel.end > sel.start ? `lines ${sel.start}–${sel.end}` : `line ${sel.start}`}</div>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change, or what do you want to know?"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(true); if (e.key === 'Escape') cancel() }} />
      <div className="bar">
        <button className="primary" disabled={!text.trim()} onClick={() => go(true)} title="⌘Enter">Send now</button>
        <button disabled={!text.trim()} onClick={() => go(false)} title="Keep it with other comments and send them together">Add to batch</button>
        <button onClick={cancel}>Cancel</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// The comments on this file, newest first, with their state and Claude's reply.
export function CommentsPanel({ list, reveal }: { list: Comment[]; reveal: (line: number) => void }): React.JSX.Element {
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const run = (p: Promise<unknown>): void => void p.then(() => setErr(null), (e: unknown) => setErr(errText(e)))
  return (
    <div className="cm-panel">
      <div className="cm-h">Comments ({list.length})</div>
      {list.length === 0 && <div className="meta pad-s">Select lines in the new version to comment on them.</div>}
      {[...list].reverse().map((c) => (
        <div key={c.id} className={'cm-item st-' + c.status}>
          <div className="row"><button className="link" onClick={() => reveal(c.start_line)}>#c{c.id} · {lines(c)}</button><span className={'pill ' + (c.status === 'answered' ? 'answered' : c.status === 'sent' ? 'open' : '')}>{c.status === 'sent' ? 'waiting for Claude' : c.status}</span></div>
          <CodePre className="cm-code" code={c.code.split('\n').slice(0, 4).join('\n') + (c.code.split('\n').length > 4 ? '\n…' : '')} language={languageForPath(c.path)} />
          {editing?.id === c.id
            ? <><textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} /><div className="bar"><button className="primary" onClick={() => { run(window.api.comments.edit(c.id, editing.text)); setEditing(null) }}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></div></>
            : <div className="cm-text">{c.text}</div>}
          {c.reply && <div className="cm-reply"><div className="meta">Claude · {time(c.updated_at)}</div><Rich text={c.reply} clampAt={10} /></div>}
          {c.status === 'draft' && editing?.id !== c.id && (
            <div className="bar"><button onClick={() => setEditing({ id: c.id, text: c.text })}>Edit</button><button className="danger" onClick={() => run(window.api.comments.remove(c.id))}>Delete</button></div>
          )}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// Drafts across all files of the session: send them as one message, or clear them.
export function DraftBar({ session, drafts }: { session: string; drafts: Comment[] }): React.JSX.Element | null {
  const [err, setErr] = useState<string | null>(null)
  if (!drafts.length) return null
  const files = new Set(drafts.map((d) => d.path)).size
  return (
    <div className="cm-drafts">
      <span>{drafts.length} comment{drafts.length === 1 ? '' : 's'} not sent{files > 1 ? ` (${files} files)` : ''}</span>
      <button className="primary" onClick={() => void window.api.comments.send(session, drafts.map((d) => d.id)).then(() => setErr(null), (e: unknown) => setErr(errText(e)))}>Send all to chat</button>
      <button onClick={() => void Promise.all(drafts.map((d) => window.api.comments.remove(d.id)))}>Discard</button>
      {err && <span className="err">{err}</span>}
    </div>
  )
}
