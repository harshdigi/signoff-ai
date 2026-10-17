// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { type BoardState, type Session } from '../board/types'
import { ordered } from './review-order'
import type { Scoped } from './types'
import { useAsk } from './useAsk'
import AskStatus from './AskStatus'
import MonitorPanel from './MonitorPanel'

// Ship (session page): how ready the change is (review, test plan, open decisions), then Commit / Push / Open PR.
// The buttons ask the session; it posts each step for your approval before doing it.
const commitPrompt = 'Commit the work on this branch that is not committed yet. Follow the repo\'s commit message convention. Post the exact message for my approval first (signoff post --action consent) and commit only after I approve. Do not push.'
const pushPrompt = 'Push this branch to origin. Ask for my approval first (signoff post --action consent) and push only after I approve. Never force-push.'
const prPrompt = (ticket: string | null): string => [
  `Open a pull request for ${ticket ?? 'this branch'}.`,
  'Description: the problem first; what changed, grouped by area; the decisions it implements (cite their ids); the test plan with each case\'s status and evidence (signoff test list); what is not included.',
  'Use a create-pr skill if one is available. Show me the final title and description for approval (signoff post --action consent) before creating it.'
].join(' ')

export default function Ship({ s, b, ask: send, openChat }: { s: Session; b: BoardState; ask: (text: string) => void; openChat: () => void }): React.JSX.Element {
  const a = useAsk(s.id, send)
  // Readiness always looks at the whole ticket (the Ticket scope), whatever the Files changed tab shows.
  const [ticket, setTicket] = useState<Scoped | null>(null)
  useEffect(() => {
    let last = ''
    const load = (): void => void window.api.workspace.scoped({ session: s.id, scope: 'ticket' }).then((t: Scoped) => {
      const json = JSON.stringify(t)
      if (json !== last) { last = json; setTicket(t) }
    })
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [s.id])
  const files = ordered(ticket)
  const reviewed = files.filter((e) => e.file.reviewed === 'done').length
  const plan = b.tests.filter((t) => t.plan === (s.ticket ?? s.id))
  const passing = plan.filter((t) => t.status === 'pass').length
  const failing = plan.filter((t) => t.status === 'fail' || t.status === 'blocked')
  const open = b.decisions.filter((d) => (d.session === s.id || (s.ticket && d.ticket === s.ticket)) && d.status === 'open')
  const row = (ok: boolean, label: string, detail: string): React.JSX.Element => (
    <div className={'ship-row ' + (ok ? 'ok' : 'todo')}><span className="ship-mark">{ok ? '✓' : '○'}</span><b>{label}</b><span className="meta">{detail}</span></div>
  )
  const ready = files.length > 0 && reviewed === files.length && plan.length > 0 && passing === plan.length && open.length === 0
  return (
    <div className="view ship">
      {row(files.length > 0 && reviewed === files.length, 'Review', ticket ? `${reviewed} of ${files.length} files reviewed` : 'Loading…')}
      {row(plan.length > 0 && passing === plan.length, 'Test plan', plan.length ? `${passing} of ${plan.length} passing${failing.length ? `; not passing: ${failing.map((f) => `#${f.idx}`).join(', ')}` : ''}` : 'No test cases yet')}
      {row(open.length === 0, 'Decisions', open.length ? `${open.length} still open` : 'Nothing open')}
      {!ready && <p className="meta">Not everything is done. You can still ship; it is your call.</p>}
      <div className="bar ship-actions">
        <button className={ready ? 'primary' : ''} disabled={a.state.phase === 'working'} onClick={() => a.ask(commitPrompt, 'Preparing the commit')}>Commit…</button>
        <button disabled={a.state.phase === 'working'} onClick={() => a.ask(pushPrompt, 'Preparing the push')}>Push…</button>
        <button disabled={a.state.phase === 'working'} onClick={() => a.ask(prPrompt(s.ticket), 'Preparing the pull request')}>Open PR…</button>
      </div>
      <AskStatus state={a.state} openChat={openChat} reset={a.reset} />
      <p className="meta">Each step comes back as an approval card before it happens.</p>
      <MonitorPanel session={s.id} />
    </div>
  )
}
