// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import TerminalView from '../components/TerminalView'
import type { Term } from './types'

// Terminal tabs, like VS Code's terminal panel. Used for the bottom panel (shells, tasks) and a session's Terminals tab.
// - Buttons and the title show only when given.
type Props = {
  terms: Term[]; active: string | null; setActive: (id: string) => void; close: (id: string) => void
  newShell?: () => void; newClaude?: () => void; hide?: () => void; title?: string; empty: string
}

export default function BottomPanel({ terms, active, setActive, close, newShell, newClaude, hide, title, empty }: Props): React.JSX.Element {
  const current = terms.find((t) => t.id === active) ?? terms[terms.length - 1]
  return (
    <div className="bottom">
      <div className="bottom-tabs">
        {title && <span className="bottom-title">{title}</span>}
        {terms.map((t) => (
          <div key={t.id} className={'btab' + (t.id === current?.id ? ' on' : '')} onClick={() => setActive(t.id)}>
            {t.title}{t.exited ? ' (exited)' : ''}<span className="x" onClick={(e) => { e.stopPropagation(); close(t.id) }}>×</span>
          </div>
        ))}
        {newShell && <button onClick={newShell} title="New shell">＋ Shell</button>}
        {newClaude && <button onClick={newClaude} title="Interactive Claude Code in a terminal">＋ Claude</button>}
        <span className="grow" />
        {hide && <button onClick={hide} title="Hide panel (⌘J)">⌄</button>}
      </div>
      <div className="bottom-body">
        {current ? <TerminalView key={current.id} id={current.id} /> : <p className="empty pad">{empty}</p>}
      </div>
    </div>
  )
}
