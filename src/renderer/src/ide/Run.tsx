// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import { errText, type Task } from './types'
import { useAsk } from './useAsk'
import AskStatus from './AskStatus'
import { Icon } from './icons'

// Run (left bar): what each repo in the folder can run, one folded group per repo (▶ on the header starts its app),
// each command tagged Launch / Console / Test / Data / Other.
// Each runs in a visible terminal tab. ✦ on a repo asks Claude to add what the files alone do not show.
const GROUPS: [Task['group'], string][] = [['launch', 'Launch'], ['console', 'Console'], ['test', 'Test'], ['seed', 'Data'], ['other', 'Other']]

const findPrompt = (root: string): string => [
  `Look at ${root} and work out how to run it for local development: the server(s), workers, the consoles this stack offers`,
  '(for example Rails console, Django shell, a REPL), the test runner, and how to start the server under a debugger.',
  `For each command the Run panel does not list yet, add it with: signoff run add --folder ${root} --label "..." --command "..." --group launch|console|test|other`,
  'Do not start anything; only add the commands, then list what you added.'
].join(' ')

export default function RunView({ tasks, trusted, run, ask, reload, session, openChat }: {
  tasks: Task[]; trusted: boolean; run: (t: Task) => void; ask: (text: string) => void; reload: () => void; session: string | null; openChat: () => void
}): React.JSX.Element {
  const a = useAsk(session, ask)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const remove = (t: Task): void => void window.api.tasks.removeRun(t.root, t.label).then(reload, (e: unknown) => setErr(errText(e)))
  // One folded group per repo, so a folder of many repos stays short. A filter shows when there is a lot to scan.
  const words = q.trim().toLowerCase()
  const shown = words ? tasks.filter((t) => `${t.repo} ${t.label} ${t.command}`.toLowerCase().includes(words)) : tasks
  const repos = [...new Map(tasks.map((t) => [t.root, t.repo])).entries()].filter(([root]) => !words || shown.some((t) => t.root === root))
  const order = (t: Task): number => GROUPS.findIndex(([g]) => g === t.group)
  return (
    <div className="side-body run">
      {tasks.length > 12 && <input className="side-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${tasks.length} commands`} />}
      {tasks.length === 0 && <div className="side-empty">Nothing to run found here. Open a project folder, or a folder of repos.</div>}
      {words && repos.length === 0 && <div className="side-empty">No command matches.</div>}
      {repos.map(([root, repo]) => {
        const list = shown.filter((t) => t.root === root).sort((x, y) => order(x) - order(y))
        const launch = list.find((t) => t.group === 'launch')
        return (
          <details key={root} className="fold run-repo" open={repos.length === 1 || !!words}>
            <summary className="side-item run-sum" title={root}>
              <span className="name">{repo}</span>
              <span className="dir">{list.length}</span>
              <button className="row-act" disabled={!trusted} title="Ask Claude to find more run commands (servers, consoles, tests, debug)"
                onClick={(e) => { e.preventDefault(); a.ask(findPrompt(root), `Finding run commands for ${repo}`) }}><Icon name="spark" /></button>
              {launch && <button className="row-act run-go" disabled={!trusted} title={trusted ? `${launch.label}: ${launch.command}` : 'Trust the folder first'}
                onClick={(e) => { e.preventDefault(); run(launch) }}>▶</button>}
            </summary>
            {list.map((t) => (
              <div key={t.id} className="side-item run-item" title={t.command}>
                <button className="row-act run-go" disabled={!trusted} onClick={() => run(t)} title={trusted ? `Run: ${t.command}` : 'Trust the folder first'}>▶</button>
                <span className="name">{t.label}</span>
                <span className="dir">{GROUPS[order(t)]?.[1]}</span>
                {t.source === 'custom' && <button className="row-act" title="Remove this command" onClick={() => remove(t)}>×</button>}
              </div>
            ))}
          </details>
        )
      })}
      <AskStatus state={a.state} openChat={openChat} reset={a.reset} />
      {err && <div className="err">{err}</div>}
    </div>
  )
}
