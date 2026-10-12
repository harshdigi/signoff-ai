// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import { errText } from './types'

// First-run setup (IDE/D16 H): Claude Code, sign-in, git, tmux. Shown on start when something is missing, and from the palette.
type Check = { ok: boolean; detail: string }
type State = { platform: string; claude: Check & { version: string | null }; auth: Check & { method: string | null; plan: string | null }; git: Check; tmux: Check & { brew: boolean } }

export function useSetup(): { state: State | null; recheck: () => void } {
  const [state, setState] = useState<State | null>(null)
  const recheck = useCallback(() => {
    window.api.setup.check().then(setState)
  }, [])
  useEffect(recheck, [recheck])
  return { state, recheck }
}

export default function SetupScreen({ state, recheck, showTerminal, close }: { state: State | null; recheck: () => void; showTerminal: (id: string, title: string) => void; close?: () => void }): React.JSX.Element {
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  // Re-check when the terminal running a setup step exits.
  useEffect(() => window.api.terminal.onExit((e) => {
    if (e.id === running) {
      setRunning(null)
      recheck()
    }
  }), [running, recheck])
  const act = (p: Promise<{ id: string; title: string } | null>): void => {
    setErr(null)
    p.then((t) => { if (t) { setRunning(t.id); showTerminal(t.id, t.title) } }, (e: unknown) => setErr(errText(e)))
  }
  const ready = !!state && state.claude.ok && state.auth.ok && state.git.ok && state.tmux.ok
  const step = (n: number, title: string, c: Check | undefined, action: React.ReactNode, note?: string): React.JSX.Element => (
    <div className={'setup-step' + (c?.ok ? ' ok' : '')}>
      <span className="setup-mark">{!c ? '…' : c.ok ? '✓' : n}</span>
      <div className="grow">
        <b>{title}</b>
        <div className="meta">{c?.detail ?? 'Checking…'}</div>
        {note && !c?.ok && <div className="meta">{note}</div>}
      </div>
      {c && !c.ok && action}
    </div>
  )
  return (
    // Leaves the bottom of the window free, so the installer's terminal stays visible.
    <div className="overlay above-panel">
      <div className="dialog setup">
        <h3>Set up Signoff AI</h3>
        <p className="meta">The app works on top of your own Claude Code. It never bundles Claude Code and never sees your login.</p>
        {step(1, 'Claude Code', state?.claude,
          <button className="primary" disabled={!!running} onClick={() => act(window.api.setup.installClaude())}>Install</button>,
          `Runs Anthropic's official installer in a terminal below: ${state?.platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'}`)}
        {step(2, 'Sign in to Claude', state?.claude.ok ? state.auth : undefined,
          <button className="primary" disabled={!!running || !state?.claude.ok} onClick={() => act(window.api.setup.login())}>Sign in</button>,
          'Opens Claude Code\'s own sign-in in your browser. Needs a Pro, Max, Team, Enterprise or Console account.')}
        {step(3, 'git', state?.git,
          <button disabled={!!running} onClick={() => act(window.api.setup.installGit())}>{state?.platform === 'darwin' ? 'Install' : 'Download'}</button>,
          state?.platform === 'darwin' ? "Installs Apple's Command Line Tools, which include git." : 'Opens git-scm.com.')}
        {step(4, 'tmux', state?.tmux,
          <button disabled={!!running} onClick={() => act(window.api.setup.installTmux())}>{state?.platform === 'darwin' ? 'Install' : 'How to install'}</button>,
          state?.platform !== 'darwin' ? 'Opens the tmux install guide.'
            : state?.tmux.brew ? 'Chats run in tmux, so the app and a Terminal window can share a session. Runs: brew install tmux'
            : 'Chats run in tmux. Installs Homebrew first (it asks for your Mac password in the terminal below), then tmux.')}
        {running && <p className="meta">Running in the terminal panel. This re-checks when it finishes.</p>}
        <div className="bar">
          <button onClick={recheck}>Check again</button>
          <span className="grow" />
          {close && <button className={ready ? 'primary' : ''} onClick={close}>{ready ? 'Start' : 'Skip for now'}</button>}
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  )
}
