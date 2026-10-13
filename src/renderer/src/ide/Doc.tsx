// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { errText } from './types'
import { MdCode } from './CodeBlock'

// One flow doc, rendered, with the status of each code anchor in it.
type A = { heading: string; docLine: number; file: string; start: number | null; end: number | null; status: 'ok' | 'stale' | 'elsewhere' }

export default function DocView({ rel }: { rel: string }): React.JSX.Element {
  const [doc, setDoc] = useState<{ content: string; anchors: A[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    window.api.flows.doc(rel).then(setDoc, (e: unknown) => setErr(errText(e)))
  }, [rel])
  if (err) return <p className="err pad">{err}</p>
  if (!doc) return <p className="empty pad">Loading…</p>
  const stale = doc.anchors.filter((a) => a.status === 'stale')
  return (
    <div className="view doc">
      <div className="meta">{rel} · {doc.anchors.length} anchors{stale.length ? ` · ${stale.length} stale` : ''}</div>
      {stale.length > 0 && (
        <div className="card open">
          <b>Stale anchors</b> <span className="meta">(the line is past the end of the file)</span>
          {stale.map((a) => <div key={a.docLine + a.file} className="ref">line {a.docLine}: {a.file}:{a.start}{a.end !== a.start ? `-${a.end}` : ''} <span className="meta">{a.heading}</span></div>)}
        </div>
      )}
      <div className="md"><Markdown remarkPlugins={[remarkGfm]} components={{ code: MdCode }}>{doc.content}</Markdown></div>
    </div>
  )
}
