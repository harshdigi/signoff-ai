// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { useAsk } from './useAsk'
import AskStatus from './AskStatus'
import { errText, type ChangeSet, type DiffMode, type ReviewView } from './types'

// Impact panel (IDE/D16 F): where a changed file fits and what can break. Facts first; Claude only on request.
type Ref = { file: string; line: number; text: string; kind: string }
export type Impact = {
  path: string; symbols: { name: string; removed: boolean; refs: Ref[] }[]
  entryPoints: { file: string; kind: string }[]; specs: string[]; risks: string[]
  flows: { doc: string; line: number; heading: string; anchor: string; touched: boolean }[]
}

export function impactPrompt(i: Impact, set: ChangeSet): string {
  return [
    `Assess the impact of my change to ${i.path}${set.branch ? ` on ${set.branch}` : ''}${set.base ? ` (against ${set.base})` : ''}.`,
    'Facts the IDE found (git grep and naming conventions, not verified by you yet):',
    `- Changed definitions: ${i.symbols.map((s) => s.name + (s.removed ? ' (removed)' : '') + ` [${s.refs.length} refs]`).join(', ') || 'none found'}`,
    `- Reached from: ${i.entryPoints.map((e) => `${e.file} (${e.kind})`).join(', ') || 'no route, controller, job or webhook found'}`,
    `- Specs: ${i.specs.join(', ') || 'none found'}`,
    ...(i.flows.length ? [`- Flow docs: ${i.flows.map((f) => `${f.doc} (${f.heading}, anchor ${f.anchor}${f.touched ? ', the changed lines' : ''})`).join('; ')}`] : []),
    ...i.risks.map((r) => `- Flag: ${r}`),
    '',
    'Tell me, in plain words: what this change does to behaviour, what can go wrong (callers, data, jobs, webhooks, other flows), what to test, and whether any decision should be revisited. Do not change code.'
  ].join('\n')
}

export default function ImpactPanel({ set, path, view, mode, ask, openDoc, session, openChat }: {
  set: ChangeSet; path: string; view?: ReviewView; mode: DiffMode; ask: (text: string) => void; openDoc: (doc: string) => void
  session: string | null; openChat: () => void
}): React.JSX.Element {
  const a = useAsk(session, ask)
  const [i, setI] = useState<Impact | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setI(null)
    window.api.workspace.impact(set.root, path, mode, view).then(setI, (e: unknown) => setErr(errText(e)))
  }, [set.root, path, mode, view])
  if (err) return <div className="impact"><div className="err">{err}</div></div>
  if (!i) return <div className="impact"><p className="meta">Looking for callers, entry points and specs…</p></div>
  return (
    <div className="impact">
      <button className="primary wide" disabled={a.state.phase === 'working'} onClick={() => a.ask(impactPrompt(i, set), 'What can go wrong')}>What can go wrong? (ask Claude)</button>
      <AskStatus state={a.state} openChat={openChat} reset={a.reset} />
      {i.risks.length > 0 && (<><div className="side-group">Flags</div>{i.risks.map((r) => <div key={r} className="risk">{r}</div>)}</>)}
      <div className="side-group">Reached from ({i.entryPoints.length})</div>
      {i.entryPoints.length === 0 && <div className="side-empty">No route, controller, job, webhook or migration references it.</div>}
      {i.entryPoints.map((e) => <div key={e.file + e.kind} className="ref"><span className="kind">{e.kind}</span> {e.file}</div>)}
      {i.flows.length > 0 && (<><div className="side-group">Flow docs ({i.flows.length})</div>{i.flows.map((f) => <div key={f.doc + f.line} className="ref link" onClick={() => openDoc(f.doc)} title={f.heading}>{f.touched && <span className="kind">changed lines</span>}{f.doc} · {f.heading || 'top'} <span className="meta">{f.anchor}</span></div>)}</>)}
      <div className="side-group">Specs ({i.specs.length})</div>
      {i.specs.length === 0 && <div className="side-empty">None found.</div>}
      {i.specs.map((s) => <div key={s} className="ref">{s}</div>)}
      <div className="side-group">Changed definitions ({i.symbols.length})</div>
      {i.symbols.map((s) => (
        <details key={s.name} className="sym">
          <summary><code>{s.name}</code>{s.removed && <span className="pill reject">removed</span>} <span className="meta">{s.refs.length} references</span></summary>
          {s.refs.map((r) => <div key={`${r.file}:${r.line}`} className="ref" title={r.text}><span className="kind">{r.kind}</span> {r.file}:{r.line} <span className="meta">{r.text}</span></div>)}
        </details>
      ))}
    </div>
  )
}
