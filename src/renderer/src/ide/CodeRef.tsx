// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useRef, useState } from 'react'
import { around } from './code-ref'
import { base, errText } from './types'

// A code reference in a message: it looks like a link. Hover shows the code around it; click opens the file there.
// - Looked up only on hover or click (main/code-search.ts resolveRef), then remembered while the app runs.
// - Not found: the hover says so and the click does nothing; nothing is guessed.
type Ref = { root: string; path: string; line: number }
type State = { phase: 'idle' } | { phase: 'loading' } | { phase: 'none' } | { phase: 'error'; error: string } | { phase: 'found'; ref: Ref; lines: { n: number; text: string }[] }
const refs = new Map<string, Promise<Ref | null>>()
const files = new Map<string, Promise<string>>()
const lookup = (text: string, session: string | null): Promise<Ref | null> => {
  const k = `${session ?? ''}|${text}`
  if (!refs.has(k)) refs.set(k, window.api.code.resolve(text, session))
  const p = refs.get(k)!
  p.catch(() => refs.delete(k)) // a failed lookup (folder closed, git error) is tried again next time
  return p
}
const fileText = (r: Ref): Promise<string> => {
  const k = `${r.root}::${r.path}`
  if (!files.has(k)) files.set(k, window.api.code.read(r.root, r.path))
  const p = files.get(k)!
  p.catch(() => files.delete(k))
  return p
}
function Preview({ ref_, lines }: { ref_: Ref; lines: { n: number; text: string }[] }): React.JSX.Element {
  return (
    <>
      <span className="cref-head">{base(ref_.root)}/{ref_.path}:{ref_.line}</span>
      <span className="cref-code">{lines.map((l) => <span key={l.n} className={'cref-ln' + (l.n === ref_.line ? ' on' : '')}><i>{l.n}</i>{l.text || ' '}</span>)}</span>
    </>
  )
}
const openCode = (r: Ref): void => void window.dispatchEvent(new CustomEvent('open-code', { detail: r }))

export default function CodeRef({ text, session }: { text: string; session: string | null }): React.JSX.Element {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = async (): Promise<Ref | null> => {
    try {
      const r = await lookup(text, session)
      if (!r) { setState({ phase: 'none' }); return null }
      setState({ phase: 'found', ref: r, lines: around(await fileText(r), r.line) })
      return r
    } catch (e) {
      setState({ phase: 'error', error: errText(e) })
      return null
    }
  }
  const enter = (): void => {
    timer.current = setTimeout(() => {
      setShow(true)
      if (state.phase === 'idle') { setState({ phase: 'loading' }); void load() }
    }, 250)
  }
  const leave = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setShow(false)
  }
  const click = async (): Promise<void> => {
    const r = state.phase === 'found' ? state.ref : await load()
    if (r) openCode(r)
  }
  return (
    <span className="cref" onMouseEnter={enter} onMouseLeave={leave}>
      <code className="inl cref-link" onClick={() => void click()} title="Click to open the file">{text}</code>
      {show && (
        <span className="cref-pop" onClick={(e) => e.stopPropagation()}>
          {state.phase === 'loading' || state.phase === 'idle' ? <span className="meta">Looking it up…</span>
            : state.phase === 'none' ? <span className="meta">No file or definition found for {text}.</span>
            : state.phase === 'error' ? <span className="err">{state.error}</span>
            : <Preview ref_={state.ref} lines={state.lines} />}
        </span>
      )}
    </span>
  )
}
