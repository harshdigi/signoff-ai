// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import Monaco from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { languageOf } from './monaco'
import { base, errText } from './types'

// A file opened from Search: read-only, scrolled to the line, with that line marked.
// Edits go through Claude and reviews, so there is no save here.
export default function FileView({ root, path, line, dark }: { root: string; path: string; line?: number; dark: boolean }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ed = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const marks = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)
  useEffect(() => {
    window.api.code.read(root, path).then(setText, (e: unknown) => setErr(errText(e)))
  }, [root, path])
  const reveal = (): void => {
    if (!ed.current || !line) return
    ed.current.revealLineInCenter(line)
    ed.current.setPosition({ lineNumber: line, column: 1 })
    marks.current?.set([{ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { isWholeLine: true, className: 'fv-line' } }])
  }
  useEffect(reveal, [line, text])
  return (
    <div className="file-view">
      <div className="fv-head"><code className="inl" title={`${root}/${path}`}>{base(root)}/{path}</code>{line ? <span className="meta">line {line}</span> : null}<span className="meta">read-only</span></div>
      {err && <p className="err pad">{err}</p>}
      {text !== null && (
        <div className="fv-body"><Monaco height="100%" value={text} language={languageOf(path)} theme={dark ? 'vs-dark' : 'vs'}
          options={{ readOnly: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13 }}
          onMount={(e) => { ed.current = e; marks.current = e.createDecorationsCollection(); reveal() }} /></div>
      )}
    </div>
  )
}
