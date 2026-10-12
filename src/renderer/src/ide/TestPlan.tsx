// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import Rich from '../board/Rich'
import { time, type BoardState, type Session, type TestCase } from '../board/types'
import { errText } from './types'
import { useAsk } from './useAsk'
import AskStatus from './AskStatus'
import Specs from './Specs'

// Test plan (session page): the cases this change must pass. Claude drafts them from the diff and the decisions,
// then verifies each with evidence; or you verify by hand. One plan per ticket, else per session.
const STATUS: TestCase['status'][] = ['pending', 'pass', 'fail', 'blocked']
const draftPrompt = 'Draft the test plan for this change: read the diff of the ticket (or this session) and its decisions, then add one test case per behaviour that matters (happy path, each rule and error, permissions, edge cases) with: signoff test add --title "..." --steps "..." --expected "...". Keep each case checkable by a person. Do not run them yet.'
const verifyPrompt = (cs: TestCase[]): string => `Verify these test cases now, one by one: ${cs.map((c) => `#${c.idx} (${c.title})`).join(', ')}. For each, run what proves it (a spec, a request, a console check), then record it with: signoff test set --idx N --status pass|fail|blocked --evidence "what you ran and what it showed". Do not change code to make a case pass; if one fails, say why.`

export default function TestPlan({ s, b, ask: send, openChat }: { s: Session; b: BoardState; ask: (text: string) => void; openChat: () => void }): React.JSX.Element {
  const a = useAsk(s.id, send)
  const [verifying, setVerifying] = useState<number[]>([])
  const verify = (cs: TestCase[]): void => {
    setVerifying(cs.map((c) => c.idx))
    a.ask(verifyPrompt(cs), cs.length === 1 ? `Verifying #${cs[0].idx}` : `Verifying ${cs.length} cases`)
  }
  const plan = s.ticket ?? s.id
  const list = b.tests.filter((t) => t.plan === plan)
  const [draft, setDraft] = useState({ title: '', steps: '', expected: '' })
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = (p: Promise<unknown>): void => void p.then(() => setErr(null), (e: unknown) => setErr(errText(e)))
  const pending = list.filter((c) => c.status === 'pending')
  const passed = list.filter((c) => c.status === 'pass').length
  return (
    <div className="view testplan">
      <div className="tp-head">
        <b>{plan === s.id ? 'This session' : plan}</b>
        {list.length > 0 && <span className="meta">{passed} of {list.length} passing</span>}
        <span className="grow" />
        <button disabled={a.state.phase === 'working'} onClick={() => a.ask(draftPrompt, 'Drafting the test plan')} title="Claude drafts cases from the diff and the decisions">✦ Draft with Claude</button>
        {pending.length > 0 && <button className="primary" disabled={a.state.phase === 'working'} onClick={() => verify(pending)}>✦ Verify {pending.length} pending with Claude</button>}
        <button onClick={() => setAdding(!adding)}>＋ Add case</button>
      </div>
      <AskStatus state={a.state} openChat={openChat} reset={a.reset} />
      {adding && (
        <div className="tp-add">
          <input autoFocus placeholder="What to check" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea placeholder="Steps" value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} />
          <textarea placeholder="Expected result" value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} />
          <div className="bar"><button className="primary" disabled={!draft.title.trim()} onClick={() => { run(window.api.plan.add(plan, draft)); setDraft({ title: '', steps: '', expected: '' }); setAdding(false) }}>Add</button><button onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      {list.length === 0 && !adding && <p className="empty">No test cases yet. Draft them with Claude, or add your own.</p>}
      {list.map((c) => (
        <div key={c.idx} className={'tp-case st-' + c.status}>
          <div className="tp-row">
            <span className="id">#{c.idx}</span>
            <b className="tp-title">{c.title}</b>
            <select value={c.status} onChange={(e) => run(window.api.plan.set(plan, c.idx, { status: e.target.value }))}>
              {STATUS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            {a.state.phase === 'working' && verifying.includes(c.idx) && c.status === 'pending'
              ? <span className="meta"><span className="spinner" /> verifying…</span>
              : <button disabled={a.state.phase === 'working'} onClick={() => verify([c])} title="Claude runs it and records the result">✦ Verify</button>}
            <button className="row-act" title="Delete this case" onClick={() => run(window.api.plan.remove(plan, c.idx))}>×</button>
          </div>
          {c.steps && <div className="tp-field"><span className="meta">Steps</span><Rich text={c.steps} clampAt={8} /></div>}
          {c.expected && <div className="tp-field"><span className="meta">Expected</span><Rich text={c.expected} clampAt={6} /></div>}
          {c.evidence && <div className="tp-field"><span className="meta">Evidence</span><Rich text={c.evidence} clampAt={8} /></div>}
          {c.verified_by && <div className="meta">{c.status} · verified by {c.verified_by === 'claude' ? 'Claude' : 'you'} · {time(c.updated_at)}</div>}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
      <Specs s={s} cases={list} send={send} openChat={openChat} />
    </div>
  )
}
