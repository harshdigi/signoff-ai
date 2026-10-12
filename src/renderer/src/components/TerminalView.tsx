// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// One embedded terminal, bound to a pty in the main process by id. Replays earlier output on mount,
// so switching tabs or reloading the window loses nothing.
export default function TerminalView({ id }: { id: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, cursorBlink: true, scrollback: 10000 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    const sync = (): void => {
      fit.fit()
      window.api.terminal.resize(id, term.cols, term.rows)
    }
    let live = true
    window.api.terminal.replay(id).then((text) => live && term.write(text))
    const offData = window.api.terminal.onData((e) => e.id === id && term.write(e.data))
    const offExit = window.api.terminal.onExit((e) => e.id === id && term.write(`\r\n[process exited with code ${e.exitCode}]\r\n`))
    const offInput = term.onData((d) => window.api.terminal.write(id, d))
    const ro = new ResizeObserver(sync)
    ro.observe(host.current!)
    sync()
    term.focus()
    return () => {
      live = false
      ro.disconnect()
      offData()
      offExit()
      offInput.dispose()
      term.dispose()
    }
  }, [id])

  return <div ref={host} style={{ position: 'absolute', inset: 0, padding: 6 }} />
}
