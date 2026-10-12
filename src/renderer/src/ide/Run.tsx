// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useState } from 'react'
import { errText, type Task } from './types'
import { useAsk } from './useAsk'
import AskStatus from './AskStatus'

// Run (left bar): what each repo in the folder can run, grouped Launch / Consoles / Tests / Other.
// Each runs in a visible terminal tab. "Find run commands" asks Claude to add what the files alone do not show.
const GROUPS: [Task['group'], string][] = [['launch', 'Launch'], ['console', 'Consoles'], ['test', 'Tests'], ['seed', 'Data'], ['other', 'Other']]

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
  const repos = [...new Map(tasks.map((t) => [t.root, t.repo])).entries()]
  const remove = (t: Task): void => void window.api.tasks.removeRun(t.root, t.label).then(reload, (e: unknown) => setErr(errText(e)))
  return (
    <div className="side-body run">
      {repos.length === 0 && <div className="side-empty">Nothing to run found here. Open a project folder, or a folder of repos.</div>}
      {repos.map(([root, repo]) => (
        <div key={root} className="run-repo">
          <div className="side-group" title={root}>{repo}</div>
          {GROUPS.map(([g, label]) => {
            const list = tasks.filter((t) => t.root === root && t.group === g)
            return list.length === 0 ? null : (
              <div key={g} className="run-group">
                <div className="run-h">{label}</div>
                {list.map((t) => (
                  <div key={t.id} className="side-item run-item" title={t.command}>
                    <button className="row-act run-go" disabled={!trusted} onClick={() => run(t)} title={trusted ? `Run: ${t.command}` : 'Trust the folder first'}>▶</button>
                    <span className="name">{t.label}</span>
                    {t.source === 'custom' && <button className="row-act" title="Remove this command" onClick={() => remove(t)}>×</button>}
                  </div>
                ))}
              </div>
            )
          })}
          <button className="link" disabled={!trusted} onClick={() => a.ask(findPrompt(root), `Finding run commands for ${repo}`)} title="Claude looks at the repo and adds run, console, test and debug commands">✦ Find run commands with Claude</button>
        </div>
      ))}
      <AskStatus state={a.state} openChat={openChat} reset={a.reset} />
      {err && <div className="err">{err}</div>}
    </div>
  )
}
