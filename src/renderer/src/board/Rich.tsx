// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Fragment, useState } from 'react'
import CodeRef from '../ide/CodeRef'
import { looksLikeRef } from '../ide/code-ref'

// Session replies are plain text with structure: ALL-CAPS or "#" headings, "- " bullets, "1." numbered points, `code`,
// **bold**, file:line refs.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\b[\w./-]+\.(?:rb|py|js|ts|tsx|jsx|md|yml|yaml|json|sql|sh|html|css)(?::\d+(?:-\d+)?)?)/g

// Code spans that name a file or definition become links with a hover preview (ide/CodeRef).
function Code({ text, session }: { text: string; session: string | null }): React.JSX.Element {
  return looksLikeRef(text) ? <CodeRef text={text} session={session} /> : <code className="inl">{text}</code>
}

function Inline({ text, session }: { text: string; session: string | null }): React.JSX.Element {
  const parts = text.split(INLINE)
  return <>{parts.map((p, i) => (i % 2 === 0 ? <Fragment key={i}>{p}</Fragment> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Code key={i} text={p.replace(/^`|`$/g, '')} session={session} />))}</>
}

// session: whose repo code references are looked up in first; without one, the open folder's repos.
export default function Rich({ text, clampAt = 14, session = null }: { text: string; clampAt?: number; session?: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n')
  const long = lines.length > clampAt || text.length > 1400
  const blocks: React.JSX.Element[] = []
  let list: string[] = []
  let ordered = false
  const flush = (): void => {
    const items = list.map((l, i) => <li key={i}><Inline text={l} session={session} /></li>)
    if (list.length) blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = []
  }
  for (const raw of lines) {
    const t = raw.trim()
    const bullet = /^[-*•]\s+(.*)$/.exec(t)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(t)
    const item = bullet ?? numbered
    if (item) {
      // a switch between bullets and numbers starts a new list
      if (list.length && ordered !== !!numbered) flush()
      ordered = !!numbered
      list.push(item[1])
      continue
    }
    flush()
    if (!t) continue
    const letters = t.replace(/[^A-Za-z]/g, '')
    if (t.startsWith('#')) blocks.push(<div key={blocks.length} className="rh">{t.replace(/^#+\s*/, '')}</div>)
    else if (letters.length >= 3 && letters === letters.toUpperCase() && t.length <= 90) blocks.push(<div key={blocks.length} className="rh">{t}</div>)
    else blocks.push(<p key={blocks.length}><Inline text={t} session={session} /></p>)
  }
  flush()
  return (
    <div>
      <div className={'rich' + (long && !open ? ' clamp' : '')}>{blocks}</div>
      {long && <button className="link" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  )
}
