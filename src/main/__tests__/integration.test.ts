// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { disableIntegration, enableIntegration, integrationPlan, repairIntegration, shellBlock } from '../integration'

// A settings.json shaped like a real one: other settings, a docs hook, and the prototype board's hooks.
const SETTINGS = {
  model: 'opus',
  hooks: {
    SessionStart: [
      { hooks: [{ type: 'command', command: 'bash "$HOME/docs/hook-session-start.sh"' }] },
      { hooks: [{ type: 'command', command: 'bash "$HOME/Project/decision-board/hooks/session-start.sh"' }] }
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'bash "$HOME/Project/decision-board/hooks/stop.sh"', timeout: 5 }] }]
  }
}
const app = { node: '/Apps/Signoff AI.app/Contents/MacOS/Signoff AI', cli: '/Apps/x/decide.cjs', resources: '/Apps/x/resources', db: '/data/board.db', shell: '/bin/zsh' }

let home: string
let state: string
const settings = (): typeof SETTINGS => JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8'))
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'home-'))
  state = join(home, 'appdata', 'terminal-integration.json')
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify(SETTINGS, null, 2))
  mkdirSync(join(home, 'Project/decision-board/data'), { recursive: true })
  writeFileSync(join(home, 'Project/decision-board/data/board.json'), '{}')
  writeFileSync(join(home, '.zshrc'), 'export EDITOR=vim\n')
})

describe('terminal integration', () => {
  it('shows the change first and writes nothing', () => {
    const p = integrationPlan(home, state, app)
    const launcher = join(home, '.local/bin/decide')
    expect(p).toMatchObject({
      on: false, launcher,
      removed: ['SessionStart: bash "$HOME/Project/decision-board/hooks/session-start.sh"', 'Stop: bash "$HOME/Project/decision-board/hooks/stop.sh"'],
      added: [`SessionStart: '${launcher}' hook session-start --terminal`, `Stop: '${launcher}' hook stop --terminal`],
      prototypeBoard: join(home, 'Project/decision-board/data/board.json')
    })
    expect(JSON.parse(p.before)).toEqual(SETTINGS)
    expect(existsSync(launcher)).toBe(false)
  })

  it('enable swaps the board hooks, keeps everything else, and installs the launcher; undo puts it all back', () => {
    const launcher = join(home, '.local/bin/decide')
    enableIntegration(home, state, app)
    expect(settings()).toEqual({
      model: 'opus',
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'bash "$HOME/docs/hook-session-start.sh"' }] },
          { hooks: [{ type: 'command', command: `'${launcher}' hook session-start --terminal`, timeout: 10 }] }
        ],
        Stop: [{ hooks: [{ type: 'command', command: `'${launcher}' hook stop --terminal`, timeout: 10 }] }]
      }
    })
    expect(readFileSync(launcher, 'utf8')).toContain(`DECISION_IDE_DB='/data/board.db' DECISION_IDE_RESOURCES='/Apps/x/resources' ELECTRON_RUN_AS_NODE=1 exec '/Apps/Signoff AI.app/Contents/MacOS/Signoff AI' '/Apps/x/decide.cjs' "$@"`)
    expect(statSync(launcher).mode & 0o111).toBeTruthy()
    expect(integrationPlan(home, state, app).on).toBe(true)
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(`export EDITOR=vim\n\n${shellBlock('/Apps/x/resources/tmux.conf')}\n`)
    // Enabling again adds nothing twice.
    enableIntegration(home, state, app)
    expect(settings().hooks.SessionStart).toHaveLength(2)
    expect(readFileSync(join(home, '.zshrc'), 'utf8').split('>>> Decision IDE') /* internal marker kept on purpose: existing installs are found by it */).toHaveLength(2)

    disableIntegration(home, state, app)
    expect(settings()).toEqual({
      model: 'opus',
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'bash "$HOME/docs/hook-session-start.sh"' }] },
          { hooks: [{ type: 'command', command: 'bash "$HOME/Project/decision-board/hooks/session-start.sh"' }] }
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'bash "$HOME/Project/decision-board/hooks/stop.sh"', timeout: 5 }] }]
      }
    })
    expect(existsSync(launcher)).toBe(false)
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('export EDITOR=vim\n')
    expect(integrationPlan(home, state, app).on).toBe(false)
  })

  it('never replaces a decide it did not write', () => {
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    writeFileSync(join(home, '.local/bin/decide'), '#!/bin/sh\necho mine\n')
    expect(() => enableIntegration(home, state, app)).toThrow(`${join(home, '.local/bin/decide')} already exists and is not Signoff AI's; move it away first`)
    expect(settings()).toEqual(SETTINGS)
  })

  it('the claude wrapper is valid zsh and bash, and runs plain claude when not at a terminal (scripts, Claude tool calls)', () => {
    const conf = join(home, 'tmux.conf')
    writeFileSync(conf, '')
    const rc = join(home, 'rc.sh')
    writeFileSync(rc, shellBlock(conf))
    execFileSync('zsh', ['-n', rc])
    execFileSync('bash', ['-n', rc])
    const bin = join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "plain claude $*"\n')
    chmodSync(join(bin, 'claude'), 0o755)
    const out = execFileSync('zsh', ['-c', `source ${rc}; claude --version`], { env: { PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin` } }).toString()
    expect(out).toBe('plain claude --version\n')
  })

  it('points the launcher and wrapper at the app after it moves (a rename); leaves off or removed integration alone', () => {
    expect(repairIntegration(home, state, app)).toBe(false) // never turned on
    const old = { ...app, node: '/Apps/Decision IDE.app/Contents/MacOS/Decision IDE', resources: '/Apps/old/resources', cli: '/Apps/old/decide.cjs' }
    enableIntegration(home, state, old)
    const launcher = join(home, '.local', 'bin', 'decide')
    expect(readFileSync(launcher, 'utf8')).toContain('/Apps/old/resources')
    expect(repairIntegration(home, state, app)).toBe(true)
    expect(readFileSync(launcher, 'utf8')).toContain('/Apps/x/resources')
    expect(readFileSync(join(home, '.zshrc'), 'utf8').split('/Apps/x/resources/tmux.conf').length - 1).toBe(2)
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).not.toContain('/Apps/old/')
    expect(repairIntegration(home, state, app)).toBe(false) // already right
  })

  it('also installs the launcher as signoff (the current name), leaves a foreign signoff alone, and Undo removes ours', () => {
    const alias = join(home, '.local', 'bin', 'signoff')
    enableIntegration(home, state, app)
    expect(readFileSync(alias, 'utf8')).toBe(readFileSync(join(home, '.local', 'bin', 'decide'), 'utf8'))
    expect(statSync(alias).mode & 0o111).not.toBe(0)
    disableIntegration(home, state, app)
    expect(existsSync(alias)).toBe(false)
    writeFileSync(alias, '#!/bin/sh\necho another tool\n')
    enableIntegration(home, state, app)
    expect(readFileSync(alias, 'utf8')).toBe('#!/bin/sh\necho another tool\n')
    disableIntegration(home, state, app)
    expect(readFileSync(alias, 'utf8')).toBe('#!/bin/sh\necho another tool\n')
  })

  it('the startup repair adds the signoff launcher to an integration made before the rename', () => {
    enableIntegration(home, state, app)
    const alias = join(home, '.local', 'bin', 'signoff')
    unlinkSync(alias)
    expect(repairIntegration(home, state, app)).toBe(true)
    expect(existsSync(alias)).toBe(true)
    expect(repairIntegration(home, state, app)).toBe(false)
  })
})

