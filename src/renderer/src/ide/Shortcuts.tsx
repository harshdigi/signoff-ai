// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useState } from 'react'

// Siri & Shortcuts: Siri runs a Shortcut by its name ("Hey Siri, standup points"). Two kinds of Shortcut:
// a spoken answer (signoff ask, no window) and "open the app and run a skill" (a decision-ide:// link).
type Info = { ask: string; runUrl: string; askUrl: string }

function Copy({ text }: { text: string }): React.JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <div className="copy-row">
      <pre className="cmd">{text}</pre>
      <button onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>{done ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

export default function ShortcutsHelp({ close, pinned }: { close: () => void; pinned: string[] }): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  useEffect(() => {
    window.api.shortcuts.info().then(setInfo)
  }, [])
  const example = pinned[0] ?? 'standup'
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Siri &amp; Shortcuts</h3>
        <p className="meta">Siri runs a Shortcut when you say its name. Make one in the Shortcuts app with the steps below. With Apple Intelligence, Siri also finds Shortcuts from similar phrasing.</p>
        {!info ? <p className="meta">Loading…</p> : (
          <>
            <h4>1. Ask by voice, hear the answer</h4>
            <p className="meta">For "give me points for today's standup" or "what's the update on ABC-9015". Runs Claude in your open project with your skills and tools; nothing is edited and nothing waits for approval.</p>
            <ol>
              <li>Shortcuts → New Shortcut. Its name is what you say to Siri, e.g. <b>Standup points</b>.</li>
              <li>Add <b>Run Shell Script</b> (Shell: zsh). Paste one of these:</li>
            </ol>
            <div className="meta">A fixed question with a skill:</div>
            <Copy text={`${info.ask} --skill ${example} "today"`} />
            <div className="meta">Or any question: first add <b>Ask for Text</b>, set the script's "Pass input" to "as arguments", then use:</div>
            <Copy text={`${info.ask} "$1"`} />
            <ol start={3}>
              <li>Add <b>Speak Text</b> with the Shell Script Result (or <b>Show Result</b> to see it).</li>
              <li>Say "Hey Siri, Standup points".</li>
            </ol>
            <p className="meta">"Find my meeting" needs Claude to read your calendar: turn on the Google Calendar or Microsoft 365 connector on claude.ai (Integrations), and allow its read tool once in Claude Code.</p>

            <h4>2. Open the app and run a skill</h4>
            <p className="meta">Add <b>Open URLs</b> to a Shortcut with:</p>
            <Copy text={`${info.runUrl}${example}`} />
            <p className="meta">Only skills you pinned to the top bar run straight away from a link. Anything else, and <code>{info.askUrl}…</code> links, land in the chat box for you to send, so a web page cannot make Claude act on its own.</p>
          </>
        )}
        <div className="bar"><button className="primary" onClick={close}>Done</button></div>
      </div>
    </div>
  )
}
