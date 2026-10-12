// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'
import { errText, itemKey, type CatalogItem, type Pin } from './types'

// Settings dialog. Values apply to sessions started after saving (the system prompt is set at start).
type S = { profile: 'developer' | 'product'; preferences: string; autoHandoff: boolean; handoffAt: number; branching: 'main' | 'stacked'; branchTemplate: string; flowDocs: string; nearbySkills: boolean; pins: Pin[]; onOpen: string | null; askTicket: boolean; maxChildren: number }

export default function Settings({ close, catalog, openShortcuts }: { close: () => void; catalog: CatalogItem[]; openShortcuts: () => void }): React.JSX.Element {
  const [s, setS] = useState<S | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    window.api.settings.get().then(setS)
  }, [])
  const save = (): void => {
    window.api.settings.save(s as never).then(close, (e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        {!s ? <p className="meta">Loading…</p> : (
          <>
            <div className="field">
              <div className="label">Who is deciding?</div>
              {([['developer', 'Developer', 'You read code. Claude asks about design choices too, and you review diffs.'],
                ['product', 'No code context', 'Claude asks only about behaviour, in plain words. It settles code-level choices itself and tells you, with evidence.']] as const).map(([v, l, d]) => (
                <label key={v} className={'choice' + (s.profile === v ? ' on' : '')}>
                  <input type="radio" checked={s.profile === v} onChange={() => setS({ ...s, profile: v })} />
                  <b>{l}</b><span>{d}</span>
                </label>
              ))}
            </div>
            <div className="field">
              <div className="label">Tickets</div>
              <label className="inline"><input type="checkbox" checked={s.askTicket} onChange={(e) => setS({ ...s, askTicket: e.target.checked })} /> Always start a task with a ticket: when there is none, Claude asks whether to create a Jira ticket, use an existing one, or go without</label>
            </div>
            <div className="field">
              <div className="label">Your preferences</div>
              <textarea value={s.preferences} onChange={(e) => setS({ ...s, preferences: e.target.value })}
                placeholder="How Claude should write and work for you, e.g. 'Short sentences. Always cite file:line. Ask before adding dependencies.'" />
            </div>
            <div className="field">
              <div className="label">When a chat's context fills up</div>
              <label className="inline"><input type="checkbox" checked={s.autoHandoff} onChange={(e) => setS({ ...s, autoHandoff: e.target.checked })} /> Continue in a fresh chat by itself, with a handoff note from the board</label>
              <label className="inline">at <input type="number" min={40} max={95} value={s.handoffAt} disabled={!s.autoHandoff} onChange={(e) => setS({ ...s, handoffAt: Number(e.target.value) })} /> % full</label>
            </div>
            <div className="field">
              <div className="label">Branches for ticket subtasks</div>
              <label className="inline"><input type="radio" checked={s.branching === 'main'} onChange={() => setS({ ...s, branching: 'main' })} /> Each subtask from the base branch (independent PRs)</label>
              <label className="inline"><input type="radio" checked={s.branching === 'stacked'} onChange={() => setS({ ...s, branching: 'stacked' })} /> Stacked: each subtask on top of the previous one</label>
              <label className="inline">Branch name <input value={s.branchTemplate} onChange={(e) => setS({ ...s, branchTemplate: e.target.value })} /></label>
              <div className="meta">{'{KEY}'} = the subtask's Jira key (else the ticket's), {'{TICKET}'}, {'{n}'}, {'{slug}'} from the title.</div>
            </div>
            <div className="field">
              <div className="label">Top bar and "when the app opens"</div>
              {s.pins.length === 0 && <div className="meta">Pin skills from the Skills view (✦) to put them on the top bar.</div>}
              {s.pins.map((p, i) => (
                <div key={p.key} className="inline pin-row">
                  <input value={p.label} onChange={(e) => setS({ ...s, pins: s.pins.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <span className="meta">{catalog.find((c) => itemKey(c) === p.key)?.invoke ?? p.key}</span>
                  <label className="inline"><input type="radio" name="onopen" checked={s.onOpen === p.key} onChange={() => setS({ ...s, onOpen: p.key })} /> run on open</label>
                  <button onClick={() => setS({ ...s, pins: s.pins.filter((_, j) => j !== i), onOpen: s.onOpen === p.key ? null : s.onOpen })}>Unpin</button>
                </div>
              ))}
              {s.pins.length > 0 && <label className="inline"><input type="radio" name="onopen" checked={!s.onOpen} onChange={() => setS({ ...s, onOpen: null })} /> Run nothing when the app opens</label>}
            </div>
            <div className="field">
              <div className="label">Team sessions</div>
              <label className="inline">At most <input type="number" min={1} max={10} value={s.maxChildren} onChange={(e) => setS({ ...s, maxChildren: Number(e.target.value) })} /> child sessions per lead session at once</label>
              <div className="meta">Each child is a full Claude Code session on your plan. A lead's proposed split cannot start more than this.</div>
            </div>
            <TerminalIntegration />
            <div className="field">
              <div className="label">Siri &amp; Shortcuts</div>
              <button onClick={openShortcuts}>Set up voice commands…</button>
            </div>
            <div className="field">
              <div className="label">Skills from nearby folders</div>
              <label className="inline"><input type="checkbox" checked={s.nearbySkills} onChange={(e) => setS({ ...s, nearbySkills: e.target.checked })} /> Load skills, commands and agents from parent and child folders in every Claude session</label>
              <div className="meta">Passed to Claude Code as --add-dir, which also lets Claude read and edit files in those folders. Copies with the same skills as one already added are skipped.</div>
            </div>
            <div className="field">
              <div className="label">Flow docs folder</div>
              <label className="inline"><input value={s.flowDocs} onChange={(e) => setS({ ...s, flowDocs: e.target.value })} placeholder="None: flow features stay off" />
                <button onClick={() => window.api.workspace.pickDir().then((d) => d && setS({ ...s, flowDocs: d }))}>Choose…</button></label>
              <div className="meta">Markdown docs with `path:line` anchors into the code (like Claude Docs). Used for Impact, "docs to update" and stale anchors.</div>
              <DocsTools />
            </div>
            <StartFresh />
            <p className="meta about">Signoff AI · written by <a href="https://github.com/harshdigi" target="_blank" rel="noreferrer">harshdigi</a></p>
            <p className="meta">Profile and preferences apply to chats and Claude terminals started after saving.</p>
            <div className="bar"><button className="primary" onClick={save}>Save</button><button onClick={close}>Cancel</button></div>
            {err && <div className="err">{err}</div>}
          </>
        )}
      </div>
    </div>
  )
}

type Plan = { on: boolean; settingsPath: string; launcher: string; before: string; after: string; removed: string[]; added: string[]; prototypeBoard: string | null; shellFile: string | null; shellBlock: string }

// Terminal integration (IDE/D19). Acts at once, not on Save: it changes your Claude Code settings file.
function TerminalIntegration(): React.JSX.Element {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    window.api.integration.plan().then(setPlan, (e: unknown) => setErr(errText(e)))
  }, [])
  const enable = (): void => {
    window.api.integration.enable().then((r: { plan: Plan; copied: Record<string, number> | null }) => {
      setPlan(r.plan)
      setDone(r.copied ? `On. Copied from the prototype board: ${Object.entries(r.copied).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing new'}.` : 'On.')
    }, (e: unknown) => setErr(errText(e)))
  }
  const undo = (): void => {
    window.api.integration.disable().then((p: Plan) => { setPlan(p); setDone('Off. Your settings are back as they were.') }, (e: unknown) => setErr(errText(e)))
  }
  return (
    <div className="field">
      <div className="label">Claude sessions in your own terminal</div>
      {!plan ? <div className="meta">Loading…</div> : (
        <>
          <div className="meta">
            {plan.on
              ? 'On: Claude sessions you start in any terminal register here and follow the decision protocol.'
              : 'Off: only sessions started in this app are decision-based. Turning it on changes your Claude Code settings as shown; Undo puts them back.'}
          </div>
          {!plan.on && (
            <>
              <ul className="meta">
                {plan.added.map((l) => <li key={l}>Adds hook: {l}</li>)}
                {plan.removed.map((l) => <li key={l}>Removes hook: {l}</li>)}
                <li>Installs {plan.launcher}</li>
                <li>{plan.shellFile ? `Adds a claude wrapper to ${plan.shellFile}: claude runs in a shared session you can also use from this app` : 'Your shell is not zsh or bash: no claude wrapper, so sessions from your terminal are listed but not shared'}</li>
                {plan.prototypeBoard && <li>Copies sessions, decisions and reviews from {plan.prototypeBoard}</li>}
              </ul>
              <details><summary>Show {plan.settingsPath} before and after</summary>
                <div className="before-after"><pre>{plan.before}</pre><pre>{plan.after}</pre></div>
              </details>
              {plan.shellFile && <details><summary>Show the block added to {plan.shellFile}</summary><pre className="cmd">{plan.shellBlock}</pre></details>}
            </>
          )}
          <div className="bar">{plan.on ? <button onClick={undo}>Undo terminal integration</button> : <button className="primary" onClick={enable}>Turn on</button>}</div>
        </>
      )}
      {done && <div className="meta">{done}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// Reset: two clicks, with what goes and what stays spelled out. The app restarts empty.
function StartFresh(): React.JSX.Element {
  const [sure, setSure] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="field">
      <div className="label">Start fresh</div>
      {!sure ? <button className="danger" onClick={() => setSure(true)}>Reset app…</button> : (
        <>
          <div className="meta">Deletes: all decisions, reviews and approvals; tickets; the sessions list, chat notes and search history; settings, pins and team setups; recent and trusted folders; pasted images. Sessions the app started are stopped.</div>
          <div className="meta">Keeps: your code; Claude Code&apos;s own saved conversations (you can resume them); terminal integration (it has its own Undo); a backup copy of the old data in the app&apos;s data folder.</div>
          <div className="bar"><button className="danger" onClick={() => window.api.reset().catch((e: unknown) => setErr(errText(e)))}>Delete everything and restart</button><button onClick={() => setSure(false)}>Cancel</button></div>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}

// Generate (or add to) the flow docs from the open folder's code, and check their anchors.
function DocsTools(): React.JSX.Element {
  const [msg, setMsg] = useState<string | null>(null)
  const [broken, setBroken] = useState<{ doc: string; docLine: number; anchor: string; problem: string }[] | null>(null)
  const generate = (): void => void window.api.flows.generate().then(() => setMsg('Started a "Flow docs" session in Sessions. It asks which flows to write before writing anything.'), (e: unknown) => setMsg(errText(e)))
  const verify = (): void => void window.api.flows.verify().then((v) => {
    setBroken(v.broken)
    setMsg(`${v.checked} anchors checked, ${v.broken.length} broken${v.skipped ? `, ${v.skipped} not checked (outside docs-meta.json prefixes)` : ''}.`)
  }, (e: unknown) => setMsg(errText(e)))
  return (
    <div className="docs-tools">
      <div className="bar"><button onClick={generate}>Generate flow docs…</button><button onClick={verify}>Verify anchors</button></div>
      {msg && <div className="meta">{msg}</div>}
      {broken && broken.length > 0 && <ul className="err">{broken.slice(0, 20).map((x) => <li key={`${x.doc}:${x.docLine}:${x.anchor}`}>{x.doc}:{x.docLine} · {x.anchor} · {x.problem}</li>)}{broken.length > 20 && <li>…and {broken.length - 20} more</li>}</ul>}
    </div>
  )
}
