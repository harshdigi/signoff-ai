// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { SESSION_VARS } from './terminals'
import { SOCKET } from './tmux'

// Terminal integration (IDE/D19): Claude sessions you start in your own terminal follow the decision protocol too.
// - Opt-in from Settings, like VS Code's "Install 'code' command in PATH". The change is shown before it is made.
// - Adds two global hooks to ~/.claude/settings.json and a `signoff` launcher in ~/.local/bin (plus `decide`, its old
//   name, which the hooks call).
// - Replaces the prototype board's hooks (decision-board/hooks/*.sh), if present. Other hooks are not touched.
// - No permission hook: in your own terminal it would hold Claude Code's prompt until you answered in the app.
// - Wraps `claude` in your shell (~/.zshrc or ~/.bashrc) so it runs in the app's tmux: one session, usable from both.
// - Undo removes what was added and puts back what was removed.

type Hook = { type: string; command?: string; timeout?: number; statusMessage?: string }
type Entry = { matcher?: string; hooks: Hook[] }
type Settings = { hooks?: Record<string, Entry[]> } & Record<string, unknown>
type Removed = { event: string; hook: Hook }
type State = { launcher: string; removed: Removed[]; backup: string; at: string; shellFile?: string | null }
export type App = { node: string; cli: string; resources: string; db: string; shell: string }
export type Plan = {
  on: boolean; settingsPath: string; launcher: string; before: string; after: string; removed: string[]; added: string[]; prototypeBoard: string | null
  shellFile: string | null; shellBlock: string
}

const PROTOTYPE = /(\S*decision-board)\/hooks\/(session-start|stop)\.sh/
const MARKER = '# Decision IDE terminal integration'
const EVENTS = [['SessionStart', 'session-start'], ['Stop', 'stop']] as const

// launcher: what the hooks call (decide, the old name). alias: the same launcher under the current name, signoff.
const paths = (home: string): { settings: string; launcher: string; alias: string } => ({ settings: join(home, '.claude', 'settings.json'), launcher: join(home, '.local', 'bin', 'decide'), alias: join(home, '.local', 'bin', 'signoff') })
const readSettings = (p: string): Settings => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Settings) : {})
const show = (s: Settings): string => JSON.stringify(s, null, 2) + '\n'
const ours = (launcher: string, h: Hook): boolean => !!h.command?.startsWith(`'${launcher}' hook `)
const readState = (file: string): State | null => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as State) : null)
const q = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`

// ---- the `claude` wrapper in your shell -------------------------------------
const START = '# >>> Decision IDE: claude runs in a shared tmux session (Settings → Undo removes this) >>>'
const END = '# <<< Decision IDE <<<'
// zsh or bash; other shells get no wrapper (their sessions still register, but are not shared).
const shellFile = (home: string, shell: string): string | null => (shell.endsWith('zsh') ? join(home, '.zshrc') : shell.endsWith('bash') ? join(home, '.bashrc') : null)
export const shellBlock = (conf: string): string => [
  START,
  'claude() {',
  '  # Plain claude when not at a terminal, in print mode, already shared, or without tmux or the app.',
  `  if [[ ! -t 0 || ! -t 1 || -n "$DECISION_IDE_TMUX" || " $* " == *" -p "* || " $* " == *" --print "* || ! -f ${q(conf)} ]] || ! command -v tmux >/dev/null; then`,
  '    command claude "$@"; return',
  '  fi',
  '  local name="claude-$(date +%Y%m%d-%H%M%S)-$$"',
  `  tmux -L ${SOCKET} -f ${q(conf)} new-session -s "$name" -c "$PWD" -e DECISION_IDE_TMUX="$name" -- env ${SESSION_VARS.map((v) => `-u ${v}`).join(' ')} claude "$@"`,
  '}',
  END
].join('\n')
const withoutBlock = (text: string): string => text.replace(new RegExp(`\\n?${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}\\n?`), '')

// The settings with the prototype hooks taken out and ours added (once). Pure: nothing is written.
function apply(s: Settings, launcher: string, home: string): { next: Settings; removed: Removed[]; board: string | null } {
  const hooks: Record<string, Entry[]> = JSON.parse(JSON.stringify(s.hooks ?? {}))
  const removed: Removed[] = []
  let board: string | null = null
  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = entries
      .map((e) => ({
        ...e,
        hooks: e.hooks.filter((h) => {
          const m = h.command ? PROTOTYPE.exec(h.command) : null
          if (!m) return true
          board = join(m[1].replace(/^"?\$HOME/, home).replace(/^"/, ''), 'data', 'board.json')
          removed.push({ event, hook: h })
          return false
        })
      }))
      .filter((e) => e.hooks.length)
  }
  for (const [event, name] of EVENTS) {
    const list = hooks[event] ?? []
    if (!list.some((e) => e.hooks.some((h) => ours(launcher, h)))) {
      list.push({ hooks: [{ type: 'command', command: `'${launcher}' hook ${name} --terminal`, timeout: 10 }] })
    }
    hooks[event] = list
  }
  return { next: { ...s, hooks }, removed, board }
}

export function integrationPlan(home: string, stateFile: string, app: Pick<App, 'resources' | 'shell'>): Plan {
  const p = paths(home)
  const before = readSettings(p.settings)
  const { next, removed, board } = apply(before, p.launcher, home)
  const added = EVENTS.map(([event, name]) => `${event}: '${p.launcher}' hook ${name} --terminal`)
  return {
    on: !!readState(stateFile), settingsPath: p.settings, launcher: p.launcher, before: show(before), after: show(next),
    removed: removed.map((r) => `${r.event}: ${r.hook.command}`), added, prototypeBoard: board && existsSync(board) ? board : null,
    shellFile: shellFile(home, app.shell), shellBlock: shellBlock(join(app.resources, 'tmux.conf'))
  }
}

// Writes the launcher and the settings. Refuses to replace a `decide` it did not write.
export function enableIntegration(home: string, stateFile: string, app: App): Plan {
  const p = paths(home)
  if (existsSync(p.launcher) && !readFileSync(p.launcher, 'utf8').includes(MARKER)) {
    throw new Error(`${p.launcher} already exists and is not Signoff AI's; move it away first`)
  }
  const before = readSettings(p.settings)
  const { next, removed } = apply(before, p.launcher, home)
  mkdirSync(dirname(p.launcher), { recursive: true })
  writeFileSync(p.launcher, [
    '#!/bin/sh', MARKER, '# Lets Claude sessions in your own terminal use the decision board. Undo in the app\'s Settings removes it.',
    `DECISION_IDE_DB=${q(app.db)} DECISION_IDE_RESOURCES=${q(app.resources)} ELECTRON_RUN_AS_NODE=1 exec ${q(app.node)} ${q(app.cli)} "$@"`, ''
  ].join('\n'))
  chmodSync(p.launcher, 0o755)
  // signoff: the same launcher under the current name. A `signoff` that is not ours (another tool) is left alone.
  if (!existsSync(p.alias) || readFileSync(p.alias, 'utf8').includes(MARKER)) {
    copyFileSync(p.launcher, p.alias)
    chmodSync(p.alias, 0o755)
  }
  mkdirSync(dirname(stateFile), { recursive: true })
  const backup = `${stateFile}.settings-${Date.now()}.json`
  if (existsSync(p.settings)) copyFileSync(p.settings, backup)
  mkdirSync(dirname(p.settings), { recursive: true })
  writeFileSync(p.settings, show(next))
  // The wrapper: replaces an earlier copy of the block, never anything else in the file.
  const rc = shellFile(home, app.shell)
  if (rc) writeFileSync(rc, withoutBlock(existsSync(rc) ? readFileSync(rc, 'utf8') : '').replace(/\n*$/, '\n\n') + shellBlock(join(app.resources, 'tmux.conf')) + '\n')
  // Removed hooks from an earlier enable are kept, so Undo still restores them.
  const prev = readState(stateFile)
  writeFileSync(stateFile, JSON.stringify({ launcher: p.launcher, removed: [...(prev?.removed ?? []), ...removed], backup, at: new Date().toISOString(), shellFile: rc } satisfies State, null, 2))
  return integrationPlan(home, stateFile, app)
}

// The app moved (renamed or reinstalled elsewhere) while Terminal integration was on: the launcher and the shell
// wrapper still point into the old app. Rewrite them for this app. Only when it is on, our launcher is still there,
// and it names another app; a launcher you removed stays removed.
export function repairIntegration(home: string, stateFile: string, app: App): boolean {
  const p = paths(home)
  if (!readState(stateFile) || !existsSync(p.launcher)) return false
  const text = readFileSync(p.launcher, 'utf8')
  // Also when the signoff launcher (added after the rename) is still missing.
  const aliasMissing = !existsSync(p.alias)
  if (!text.includes(MARKER) || (text.includes(app.resources) && !aliasMissing)) return false
  enableIntegration(home, stateFile, app)
  return true
}

// Takes out our hooks wherever they are now, puts the removed ones back (each as its own entry), deletes the launcher.
export function disableIntegration(home: string, stateFile: string, app: Pick<App, 'resources' | 'shell'>): Plan {
  const p = paths(home)
  const state = readState(stateFile)
  if (!state) throw new Error('terminal integration is not on')
  const s = readSettings(p.settings)
  const hooks: Record<string, Entry[]> = s.hooks ?? {}
  for (const event of Object.keys(hooks)) {
    hooks[event] = hooks[event].map((e) => ({ ...e, hooks: e.hooks.filter((h) => !ours(state.launcher, h)) })).filter((e) => e.hooks.length)
    if (!hooks[event].length) delete hooks[event]
  }
  for (const r of state.removed) (hooks[r.event] ??= []).push({ hooks: [r.hook] })
  writeFileSync(p.settings, show({ ...s, hooks }))
  if (existsSync(state.launcher) && readFileSync(state.launcher, 'utf8').includes(MARKER)) unlinkSync(state.launcher)
  const alias = paths(home).alias
  if (existsSync(alias) && readFileSync(alias, 'utf8').includes(MARKER)) unlinkSync(alias)
  if (state.shellFile && existsSync(state.shellFile)) writeFileSync(state.shellFile, withoutBlock(readFileSync(state.shellFile, 'utf8')))
  unlinkSync(stateFile)
  return integrationPlan(home, stateFile, app)
}
