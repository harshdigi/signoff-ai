// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef, useState } from 'react'

// Command palette (⇧⌘P / ⌘K): every action, task and skill in one filtered list.
export type Command = { id: string; label: string; detail?: string; run: () => void }

export default function Palette({ commands, close }: { commands: Command[]; close: () => void }): React.JSX.Element {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = commands.filter((c) => words.every((w) => (c.label + ' ' + (c.detail ?? '')).toLowerCase().includes(w))).slice(0, 40)
  const go = (c: Command | undefined): void => {
    if (!c) return
    close()
    c.run()
  }
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} value={q} placeholder="Type a command, task or skill" onChange={(e) => { setQ(e.target.value); setI(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((i + 1) % Math.max(shown.length, 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((i - 1 + shown.length) % Math.max(shown.length, 1)) }
            if (e.key === 'Enter') go(shown[i])
          }} />
        <div className="palette-list">
          {shown.map((c, n) => (
            <div key={c.id} className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => go(c)}>
              {c.label}{c.detail && <span className="meta"> {c.detail}</span>}
            </div>
          ))}
          {shown.length === 0 && <div className="meta">No match.</div>}
        </div>
      </div>
    </div>
  )
}
