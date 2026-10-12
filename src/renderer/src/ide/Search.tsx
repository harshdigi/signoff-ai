// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState } from 'react'
import { base, errText, type EditorTab } from './types'

// Search tab (⌘K): one box over the code and the project memory.
// - Files: file names in the open folder's git repos. In files: matching lines (git grep).
// - Decisions, reviews, chats (project memory) and flow doc names, as before (IDE/D16 G).
// A file opens read-only at the matching line.
type Hit = { kind: 'decision' | 'review' | 'chat'; ref: string; session: string | null; ticket: string | null; at: string; title: string; snippet: string }
type FileHit = { root: string; path: string }
type LineHit = FileHit & { line: number; text: string }
type Found<T> = { hits: T[]; truncated: boolean }
const none = { hits: [], truncated: false }

export default function SearchView({ openTab, openChat, focus }: { openTab: (t: EditorTab) => void; openChat: (s: string) => void; focus: number }): React.JSX.Element {
  const [q, setQ] = useState('')
  const [caseSensitive, setCase] = useState(false)
  const [word, setWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [include, setInclude] = useState('')
  const [files, setFiles] = useState<Found<FileHit>>(none)
  const [lines, setLines] = useState<Found<LineHit>>(none)
  const [hits, setHits] = useState<Hit[]>([])
  const [docs, setDocs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [focus])
  useEffect(() => {
    window.api.flows.list().then(setDocs)
  }, [])
  // Each search waits 250 ms after typing stops; an older search that finishes late is ignored.
  // - If one part fails (say code search in a folder with no repo), its error shows and the other results still do.
  useEffect(() => {
    let stale = false
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setFiles(none); setLines(none); setHits([]); setErr(null); return }
      setBusy(true)
      const errors: string[] = []
      const part = <T,>(p: Promise<T>, empty: T): Promise<T> => p.catch((e: unknown) => { errors.push(errText(e)); return empty })
      void Promise.all([
        part(window.api.code.files(q.trim(), include) as Promise<Found<FileHit>>, none),
        part(window.api.code.grep({ q, regex, caseSensitive, word, include }) as Promise<Found<LineHit>>, none),
        part(window.api.memory.search(q) as Promise<Hit[]>, [])
      ]).then(([f, l, m]) => {
        if (stale) return
        setFiles(f); setLines(l); setHits(m); setErr(errors.length ? [...new Set(errors)].join('\n') : null); setBusy(false)
      })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [q, caseSensitive, word, regex, include])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const docHits = words.length ? docs.filter((d) => words.every((w) => d.toLowerCase().includes(w))) : []
  const openHit = (h: Hit): void => {
    if (h.kind === 'review') openTab({ kind: 'review', id: h.ref })
    else if (h.session) openChat(h.session)
  }
  // snippet() marks memory matches with [ ]; show them bold.
  const marked = (s: string): React.ReactNode[] => s.split(/(\[[^\]]*\])/).map((p, i) => (p.startsWith('[') && p.endsWith(']') ? <b key={i}>{p.slice(1, -1)}</b> : p))
  // The match inside a code line, highlighted. A regex git accepts but JavaScript does not is shown unmarked.
  const highlight = (text: string): React.ReactNode => {
    let re: RegExp
    try {
      re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
    } catch {
      return text
    }
    const out: React.ReactNode[] = []
    let last = 0
    for (const m of text.matchAll(re)) {
      if (!m[0]) break
      out.push(text.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>)
      last = m.index! + m[0].length
    }
    out.push(text.slice(last))
    return out
  }
  const byFile = new Map<string, LineHit[]>()
  for (const l of lines.hits) {
    const k = `${l.root}::${l.path}`
    byFile.set(k, [...(byFile.get(k) ?? []), l])
  }
  const roots = new Set([...files.hits, ...lines.hits].map((h) => h.root))
  const where = (h: FileHit): string => (roots.size > 1 ? `${base(h.root)}/` : '')
  const nothing = q.trim().length > 1 && !busy && !err && !files.hits.length && !lines.hits.length && !hits.length && !docHits.length
  return (
    <div className="side-body">
      <input ref={input} className="side-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, files, decisions, chats, docs" />
      <div className="search-opts">
        <button className={caseSensitive ? 'on' : ''} title="Match case" onClick={() => setCase(!caseSensitive)}>Aa</button>
        <button className={word ? 'on' : ''} title="Whole word" onClick={() => setWord(!word)}>ab|</button>
        <button className={regex ? 'on' : ''} title="Regular expression" onClick={() => setRegex(!regex)}>.*</button>
        <input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="files to include: *.rb, app/" />
      </div>
      {busy && <div className="meta pad-s"><span className="spinner" /> Searching…</div>}
      {err && <div className="err">{err}</div>}
      {nothing && <div className="side-empty">Nothing found.</div>}

      {files.hits.length > 0 && <div className="side-group">Files ({files.hits.length}{files.truncated ? '+' : ''})</div>}
      {files.hits.map((f) => (
        <div key={`${f.root}::${f.path}`} className="side-item" title={`${f.root}/${f.path}`} onClick={() => openTab({ kind: 'file', root: f.root, path: f.path })}>
          <span className="name">{base(f.path)}</span><span className="dir">{where(f)}{f.path.slice(0, -base(f.path).length - 1)}</span>
        </div>
      ))}

      {lines.hits.length > 0 && <div className="side-group">In files ({lines.hits.length}{lines.truncated ? '+, refine the search' : ''})</div>}
      {[...byFile.entries()].map(([k, ls]) => (
        <div key={k}>
          <div className="side-item sr-file" title={`${ls[0].root}/${ls[0].path}`} onClick={() => openTab({ kind: 'file', root: ls[0].root, path: ls[0].path, line: ls[0].line })}>
            <span className="name">{base(ls[0].path)}</span><span className="dir">{where(ls[0])}{ls[0].path}</span><span className="count">{ls.length}</span>
          </div>
          {ls.map((l) => (
            <div key={l.line} className="sr-line" onClick={() => openTab({ kind: 'file', root: l.root, path: l.path, line: l.line })}>
              <span className="n">{l.line}</span><span>{highlight(l.text.trim())}</span>
            </div>
          ))}
        </div>
      ))}

      {docHits.length > 0 && <div className="side-group">Flow docs</div>}
      {docHits.map((d) => <div key={d} className="side-item" onClick={() => openTab({ kind: 'doc', id: d })}><span className="st pending">D</span><span className="name">{d}</span></div>)}
      {hits.length > 0 && <div className="side-group">Decisions, reviews, chats ({hits.length})</div>}
      {hits.map((h, i) => (
        <div key={i} className="side-item skill" onClick={() => openHit(h)}>
          <span className="name">{h.kind === 'decision' ? h.ref : h.kind === 'review' ? `${h.ref} review` : h.title}{h.ticket ? ` · ${h.ticket}` : ''}</span>
          <span className="dir">{h.at.slice(0, 10)}</span>
          <div className="desc">{h.kind !== 'chat' && <>{h.title} — </>}{marked(h.snippet)}</div>
        </div>
      ))}
    </div>
  )
}
