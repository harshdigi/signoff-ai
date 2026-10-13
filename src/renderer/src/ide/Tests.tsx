// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useMemo, useState } from 'react'
import { base, errText, type Changes } from './types'

// Test panel (IDE/D16 E): related specs first, run one file or one example in that worktree,
// and send a failure to Claude to analyse.
type Example = { name: string; status: 'passed' | 'failed' | 'pending'; file: string; line: number | null; message: string | null }
export type TestRun = {
  id: string; root: string; target: string; framework: string; command: string; terminal: string
  status: 'running' | 'passed' | 'failed' | 'error'; examples: Example[]; summary: string; error: string | null; started_at: number
}
type Info = { framework: string | null; specs: string[]; related: string[] }

type Props = { changes: Changes | null; trusted: boolean; analyse: (text: string) => void; showTerminal: (id: string, title: string) => void }

export default function TestsView({ changes, trusted, analyse, showTerminal }: Props): React.JSX.Element {
  const groups = changes?.groups ?? []
  const [root, setRoot] = useState<string | null>(null)
  const current = groups.find((g) => g.root === root) ?? groups[0]
  const [info, setInfo] = useState<Info | null>(null)
  const [runs, setRuns] = useState<TestRun[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const changedKey = current?.files.map((f) => f.path).join('|')

  useEffect(() => {
    if (!current) return
    setInfo(null)
    setErr(null)
    window.api.tests.info(current.root).then(setInfo, (e: unknown) => setErr(errText(e)))
  }, [current?.root, changedKey])
  useEffect(() => {
    window.api.tests.runs().then(setRuns)
    return window.api.tests.onResult((r) => setRuns((rs) => [r as TestRun, ...rs.filter((x) => x.id !== (r as TestRun).id)]))
  }, [])

  const lastFor = (target: string): TestRun | undefined => runs.find((r) => r.root === current?.root && r.target === target)
  const start = (target: string): void => {
    if (!current) return
    setErr(null)
    window.api.tests.run(current.root, target).then((r: TestRun) => showTerminal(r.terminal, `Test: ${base(target)}`), (e: unknown) => setErr(errText(e)))
  }
  const all = useMemo(() => (info?.specs ?? []).filter((s) => s.toLowerCase().includes(q.toLowerCase())).slice(0, 200), [info, q])

  if (!groups.length) return <div className="side-body"><div className="side-empty">Open a git folder to run tests.</div></div>
  return (
    <div className="side-body">
      {groups.length > 1 && (
        <select className="side-search" value={current?.root} onChange={(e) => setRoot(e.target.value)}>
          {groups.map((g) => <option key={g.root} value={g.root}>⎇ {g.branch ?? 'detached'} · {base(g.root)}</option>)}
        </select>
      )}
      {/* Tests run only in repos inside the open folder; a session can also have changed a repo outside it. */}
      {err && (err.startsWith('not a worktree of this folder')
        ? <div className="side-empty">Tests run only for repos inside the open folder. {base(current?.root ?? '')} is outside it.</div>
        : <div className="err">{err}</div>)}
      {err && !info ? null : !info ? <div className="side-empty">Finding specs…</div> : !info.framework ? (
        <div className="side-empty">No RSpec, Vitest or Jest setup found in this worktree.</div>
      ) : (
        <>
          <div className="side-group">Related to your changes ({info.related.length}) · {info.framework}</div>
          {info.related.length === 0 && <div className="side-empty">No spec matches the changed files by name.</div>}
          {info.related.map((s) => <SpecRow key={s} spec={s} run={lastFor(s)} start={start} trusted={trusted} analyse={analyse} branch={current?.branch} />)}
          <div className="side-group">All specs ({info.specs.length})</div>
          <input className="side-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter specs" />
          {all.map((s) => <SpecRow key={s} spec={s} run={lastFor(s)} start={start} trusted={trusted} analyse={analyse} branch={current?.branch} />)}
          {(info.specs.length > all.length && !q) && <div className="side-empty">Showing 200. Filter to find others.</div>}
        </>
      )}
    </div>
  )
}

function SpecRow({ spec, run, start, trusted, analyse, branch }: { spec: string; run?: TestRun; start: (t: string) => void; trusted: boolean; analyse: (t: string) => void; branch?: string | null }): React.JSX.Element {
  const failed = run?.examples.filter((e) => e.status === 'failed') ?? []
  const badge = !run ? null : run.status === 'running' ? '…' : run.status === 'passed' ? '✓' : '✗'
  return (
    <div className="spec">
      <div className="side-item" title={spec}>
        <button className="run" disabled={!trusted || run?.status === 'running'} onClick={() => start(spec)} title={trusted ? 'Run this file' : 'Trust the folder first'}>▶</button>
        <span className="name">{base(spec)}</span>
        {badge && <span className={'tbadge ' + run!.status}>{badge}</span>}
      </div>
      {run && run.status !== 'running' && (run.status !== 'passed') && (
        <div className="spec-result">
          {run.summary && <div className="meta">{run.summary}</div>}
          {run.error && <pre>{run.error}</pre>}
          {failed.map((e) => (
            <details key={`${e.file}:${e.line}:${e.name}`}>
              <summary>{e.name}</summary>
              {e.message && <pre>{e.message}</pre>}
              <div className="bar">
                {e.line && <button disabled={!trusted} onClick={() => start(`${e.file}:${e.line}`)}>▶ Just this one</button>}
                <button onClick={() => analyse(`This test fails on ${branch ?? 'this branch'}:\n\n${e.file}${e.line ? ':' + e.line : ''} — ${e.name}\n\n${e.message ?? ''}\n\nFind out why. Do not change code yet: say what is wrong, which decision or change it touches, and propose the fix as a review.`)}>Analyse in chat</button>
              </div>
            </details>
          ))}
          {run.error && <button onClick={() => analyse(`Running ${run.target} failed before any test ran:\n\n${run.error}\n\nFind out why and tell me how to fix the setup. Do not change code yet.`)}>Analyse in chat</button>}
        </div>
      )}
      {run?.status === 'passed' && <div className="spec-result meta">{run.summary}</div>}
    </div>
  )
}
