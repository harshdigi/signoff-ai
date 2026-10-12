// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState } from 'react'
import Rich from '../board/Rich'
import type { Session, TestCase } from '../board/types'
import AskStatus from './AskStatus'
import { isTest } from './review-order'
import { resultFor, specReport, type SpecFile, type SpecRun } from './spec-report'
import { base, errText, type Scoped } from './types'
import { useAsk } from './useAsk'

// Specs (Test plan tab): the spec / test files this ticket created or changed, in each repo with its own framework
// (RSpec, pytest, go test, Vitest, Jest). Run them, have Claude check they really test the change, and get a report.
const reviewPrompt = (files: string[]): string => [
  `Review these spec files changed for this ticket: ${files.join(', ')}.`,
  'For each: does it test the behaviour this change adds or alters (cite the decisions and test plan cases it covers)? Are the assertions exact (whole values, not partial matches)? What cases are missing (errors, permissions, edge cases)? Anything flaky (time, order, network) or over-mocked?',
  'Answer per file with file:line. Do not edit any files. If a spec covers a test plan case, record it with: signoff test set --idx N --status pass --evidence "<spec file:line>" only after running that spec and seeing it pass.'
].join(' ')

export default function Specs({ s, cases, send, openChat }: { s: Session; cases: TestCase[]; send: (text: string) => void; openChat: () => void }): React.JSX.Element {
  const [specs, setSpecs] = useState<SpecFile[] | null>(null)
  const [runs, setRuns] = useState<SpecRun[]>([])
  const [report, setReport] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const a = useAsk(s.id, send)
  const reportRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (report) reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [report])
  // The ticket's changed test files, by repo, kept to files the repo's framework treats as specs.
  const load = (): void => void window.api.workspace.scoped({ session: s.id, scope: 'ticket' }).then(async (t: Scoped) => {
    const found: SpecFile[] = []
    for (const g of t.groups) {
      const info = await window.api.tests.info(g.root).catch(() => ({ framework: null, specs: [] as string[] }))
      const known = new Set(info.specs)
      for (const f of g.files) if (f.status !== 'deleted' && isTest(f.path) && (!info.framework || known.has(f.path))) found.push({ repo: base(g.root), root: g.root, file: f.path, framework: info.framework })
    }
    setSpecs(found)
  }, (e: unknown) => setErr(errText(e)))
  useEffect(load, [s.id])
  useEffect(() => {
    void window.api.tests.runs().then(setRuns)
    return window.api.tests.onResult((r) => setRuns((rs) => [r as SpecRun, ...rs.filter((x) => x.id !== (r as SpecRun).id)]))
  }, [])
  const runFiles = (root: string, files: string[]): void => void window.api.tests.runMany(root, files).then(() => setErr(null), (e: unknown) => setErr(errText(e)))
  const running = (root: string, file: string): boolean => runs.some((r) => r.status === 'running' && r.root === root && r.target.split(' ').includes(file))
  const repos = [...new Set((specs ?? []).map((x) => x.root))]
  const busy = (root: string): boolean => runs.some((r) => r.status === 'running' && r.root === root)
  // A run that could not start fails the same way for every file in it: show its output once, under the repo.
  const broken = (root: string): SpecRun | undefined => runs.filter((r) => r.root === root && r.status !== 'running').sort((x, y) => y.started_at - x.started_at)[0]
  const makeReport = (): void => setReport(specReport({ title: s.ticket ?? s.title ?? s.id, at: new Date(), specs: specs ?? [], runs, cases, review: a.state.phase === 'done' ? a.state.answer : null }))
  return (
    <div className="specs">
      <div className="tp-head">
        <b>Specs changed in this ticket</b>{specs && <span className="meta">{specs.length}</span>}
        <span className="grow" />
        <button onClick={load} title="Look again for changed spec files">↻</button>
        {!!specs?.length && <button disabled={a.state.phase === 'working'} onClick={() => a.ask(reviewPrompt(specs.map((x) => `${x.repo}/${x.file}`)), 'Reviewing the specs')}>✦ Review specs with Claude</button>}
        {!!specs?.length && <button onClick={makeReport}>📄 Spec report</button>}
      </div>
      <AskStatus state={a.state} openChat={openChat} reset={a.reset} />
      {err && <div className="err">{err}</div>}
      {report && (
        <div className="spec-report" ref={reportRef}>
          <div className="row"><b>Spec report</b><span className="grow" />
            <button onClick={() => void navigator.clipboard.writeText(report).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy as Markdown'}</button>
            <button className="row-act" title="Close" onClick={() => { setReport(null); setCopied(false) }}>×</button></div>
          <Rich text={report} clampAt={60} />
        </div>
      )}
      {specs === null && <p className="meta">Looking for changed specs…</p>}
      {specs?.length === 0 && <p className="empty">No spec or test files changed in this ticket yet.</p>}
      {repos.map((root) => {
        const list = specs!.filter((x) => x.root === root)
        return (
          <div key={root} className="spec-repo">
            <div className="row"><span className="side-group">{base(root)} · {list[0].framework ?? 'no test framework found'}</span><span className="grow" />
              {list[0].framework && <button className="primary" disabled={busy(root)} onClick={() => runFiles(root, list.map((x) => x.file))}>{busy(root) ? 'Running…' : `▶ Run all ${list.length}`}</button>}</div>
            {broken(root)?.status === 'error' && <pre className="spec-fail err">Could not run the specs:{'\n'}{broken(root)!.error}</pre>}
            {list.map((x) => {
              const r = resultFor(runs, root, x.file)
              const failed = r?.examples.filter((e) => e.status === 'failed') ?? []
              return (
                <div key={x.file} className="spec-file">
                  <div className="row">
                    {running(root, x.file) ? <span className="spinner" /> : r ? <span className={r.run.status === 'error' ? 'err' : failed.length ? 'fail-mark' : 'ok-mark'}>{r.run.status === 'error' ? '!' : failed.length ? '✗' : '✓'}</span> : <span className="meta">○</span>}
                    <code className="inl">{x.file}</code>
                    <span className="meta">{running(root, x.file) ? 'running…' : r ? (r.run.status === 'error' ? 'could not run' : `${r.examples.length} examples${failed.length ? `, ${failed.length} failing` : ''}`) : 'not run'}</span>
                    <span className="grow" />
                    {x.framework && <button disabled={running(root, x.file)} onClick={() => runFiles(root, [x.file])}>▶ Run</button>}
                  </div>
                  {failed.map((e) => <div key={e.name} className="spec-fail"><b>{e.name}</b>{e.line ? <span className="meta"> line {e.line}</span> : null}<pre>{(e.message ?? '').slice(0, 1200)}</pre></div>)}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
