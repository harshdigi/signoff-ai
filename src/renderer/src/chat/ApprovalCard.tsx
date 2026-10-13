// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Approval } from '../board/types'
import { errText } from '../ide/types'
import { toolSummary } from './transcript'
import { CodeDiff, CodePre, MdCode } from '../ide/CodeBlock'
import { languageForPath } from '../ide/languages'
import { outsidePath } from './approval-scope'

type Question = { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean }

// A permission prompt from Claude Code, answered inline (IDE/D10). Claude waits until it is answered.
// who: the session asking, so it is clear the request comes from Claude, not from Signoff AI.
export default function ApprovalCard({ a, toTerminal, who, folder }: { a: Approval; toTerminal?: () => void; who?: string | null; folder?: string | null }): React.JSX.Element {
  const input = JSON.parse(a.input) as Record<string, unknown>
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const answer = (ans: unknown): void => {
    window.api.chat.answer(a.id, ans).catch((e: unknown) => setErr(errText(e)))
  }
  if (a.tool_name === 'AskUserQuestion') return <QuestionCard a={a} questions={(input.questions as Question[]) ?? []} answer={answer} err={err} />
  if (a.outward) return <DraftCard a={a} input={input} answer={answer} err={err} />
  if (a.tool_name === 'ExitPlanMode') return <PlanCard plan={String(input.plan ?? '')} answer={answer} err={err} />
  const edit = a.tool_name === 'Edit' && typeof input.old_string === 'string'
  const fileLanguage = typeof input.file_path === 'string' ? languageForPath(input.file_path) : null
  const outside = outsidePath(input, folder ?? null)
  return (
    <div className="ccard warn">
      <div className="ccard-head">{who ? <>Your Claude session <b>{who}</b> asks: allow</> : 'Your Claude session asks: allow'} <b>{a.tool_name}</b>?</div>
      {outside && <div className="outside-note">It wants a path outside the folder open in Signoff AI: <code>{outside}</code>. This is Claude asking, not the app; allow it only if you expect it.</div>}
      <CodePre className="cmd" code={toolSummary(a.tool_name, input) || JSON.stringify(input, null, 2)} language={a.tool_name === 'Bash' ? 'shell' : null} />
      {edit && <CodeDiff className="mini-diff" language={fileLanguage}
        diff={[...String(input.old_string).split('\n').map((l) => '-' + l), ...String(input.new_string).split('\n').map((l) => '+' + l)].join('\n')} />}
      {a.tool_name === 'Write' && typeof input.content === 'string' && <CodePre className="mini-diff" code={(input.content as string).slice(0, 2000)} language={fileLanguage} />}
      <div className="bar">
        <button className="primary" onClick={() => answer({ allow: true, scope: 'once' })}>Allow</button>
        <button onClick={() => answer({ allow: true, scope: 'chat' })} title={a.tool_name === 'Bash' ? 'This exact command, for the rest of this chat' : `${a.tool_name}, for the rest of this chat`}>Allow for this chat</button>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, or what to do instead" />
        <button onClick={() => answer({ allow: false, message: reason || 'The user denied this.' })}>Deny</button>
        {toTerminal && <button className="link" onClick={() => { void window.api.chat.answerInTerminal(a.id); toTerminal() }}>Answer in terminal</button>}
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

function QuestionCard({ a, questions, answer, err }: { a: Approval; questions: Question[]; answer: (x: unknown) => void; err: string | null }): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const toggle = (q: Question, label: string): void =>
    setPicked((p) => ({ ...p, [q.question]: q.multiSelect ? (p[q.question]?.includes(label) ? p[q.question].filter((x) => x !== label) : [...(p[q.question] ?? []), label]) : [label] }))
  const answers = Object.fromEntries(questions.map((q) => [q.question, other[q.question]?.trim() || (picked[q.question] ?? []).join(', ')]))
  const ready = questions.every((q) => answers[q.question])
  return (
    <div className="ccard warn" data-approval={a.id}>
      {questions.map((q) => (
        <div key={q.question} className="question">
          <div className="ccard-head">{q.header && <span className="chip">{q.header}</span>} {q.question}</div>
          <div className="options">
            {q.options.map((o) => (
              <button key={o.label} className={picked[q.question]?.includes(o.label) ? 'opt on' : 'opt'} onClick={() => toggle(q, o.label)}>
                <b>{o.label}</b>{o.description && <span>{o.description}</span>}
              </button>
            ))}
          </div>
          <input value={other[q.question] ?? ''} onChange={(e) => setOther({ ...other, [q.question]: e.target.value })} placeholder="Other (type your own answer)" />
        </div>
      ))}
      <div className="bar">
        <button className="primary" disabled={!ready} onClick={() => answer({ allow: true, updatedInput: { questions, answers } })}>Send answers</button>
        <button onClick={() => answer({ allow: false, message: 'The user skipped these questions.' })}>Skip</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// Something that leaves this machine (IDE/D16 I): the exact draft, editable, sent only on "Send". Never "allow for this chat".
function DraftCard({ a, input, answer, err }: { a: Approval; input: Record<string, unknown>; answer: (x: unknown) => void; err: string | null }): React.JSX.Element {
  const [fields, setFields] = useState<Record<string, unknown>>(input)
  const [reason, setReason] = useState('')
  const action = a.tool_name.split('__').pop()!.replace(/_/g, ' ')
  const strings = Object.entries(fields).filter(([, v]) => typeof v === 'string') as [string, string][]
  const others = Object.entries(fields).filter(([, v]) => typeof v !== 'string')
  return (
    <div className="ccard warn draft">
      <div className="ccard-head">Draft for <b>{a.service}</b> · {action}</div>
      <div className="meta">Nothing is sent until you press Send. Edit anything first.</div>
      {strings.map(([k, v]) => (
        <label key={k} className="draft-field">
          <span>{k.replace(/_/g, ' ')}</span>
          {v.length > 60 || v.includes('\n')
            ? <textarea value={v} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
            : <input value={v} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />}
        </label>
      ))}
      {others.length > 0 && <pre className="mini-diff">{JSON.stringify(Object.fromEntries(others), null, 2)}</pre>}
      <div className="bar">
        <button className="primary" onClick={() => answer({ allow: true, scope: 'once', updatedInput: fields })}>Send</button>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not, or what to change" />
        <button onClick={() => answer({ allow: false, message: reason || 'The user chose not to send this.' })}>Don't send</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// Plan mode: Claude's plan, approved before it starts changing things (Claude Code asks the same).
function PlanCard({ plan, answer, err }: { plan: string; answer: (x: unknown) => void; err: string | null }): React.JSX.Element {
  const [note, setNote] = useState('')
  return (
    <div className="ccard warn plan">
      <div className="ccard-head"><b>Claude's plan</b> · approve it to let Claude start</div>
      <div className="md plan-body"><Markdown remarkPlugins={[remarkGfm]} components={{ code: MdCode }}>{plan}</Markdown></div>
      <div className="bar">
        <button className="primary" onClick={() => answer({ allow: true, scope: 'once' })}>Approve plan</button>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change in the plan" />
        <button onClick={() => answer({ allow: false, message: note || 'Keep planning: the user did not approve this plan yet.' })}>Keep planning</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  )
}
