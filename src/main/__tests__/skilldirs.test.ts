// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { readCatalog } from '../catalog'
import { protocolLaunch } from '../protocol'
import { DEFAULTS } from '../settings'
import { skillDirs } from '../skilldirs'

const skill = (dir: string, name: string): void => {
  mkdirSync(join(dir, '.claude/skills', name), { recursive: true })
  writeFileSync(join(dir, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n`)
}

// home/Project/.claude (parent above the repos), home/Project/{svc, svc-copy, web/packages/ui}, svc/node_modules/x/.claude
function tree(): { home: string; project: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'home-')))
  const project = join(home, 'Project')
  skill(home, 'personal')                              // ~/.claude: loads anyway, never added
  skill(project, 'workspace-skill')
  skill(join(project, 'svc'), 'start-ticket')
  skill(join(project, 'svc-copy'), 'start-ticket')     // same skills as svc: a copy
  skill(join(project, 'web/packages/ui'), 'ui-review') // depth 3
  skill(join(project, 'svc/node_modules/x'), 'junk')
  skill(join(project, 'svc/.claude/worktrees/abc-1'), 'start-ticket')
  skill(join(project, 'a/b/c/d'), 'too-deep')          // depth 4
  return { home, project }
}

describe('nearby skill folders', () => {
  it('from the folder above the repos: every child repo, copies skipped, junk and deep folders ignored', () => {
    const { home, project } = tree()
    expect(skillDirs(project, home)).toEqual({
      dirs: [join(project, 'svc'), join(project, 'web/packages/ui')],
      skipped: [{ dir: join(project, 'svc-copy'), sameAs: join(project, 'svc') }]
    })
  })

  it('from inside a repo: the parent folder above the repo root, but not home', () => {
    const { home, project } = tree()
    const svc = join(project, 'svc')
    execFileSync('git', ['init', '-q'], { cwd: svc })
    mkdirSync(join(svc, 'app'))
    expect(skillDirs(join(svc, 'app'), home).dirs).toEqual([project])
  })

  it('goes on the claude command line, and into the skills list with the folder name', () => {
    const { home, project } = tree()
    const { dirs } = skillDirs(project, home)
    const l = protocolLaunch({ resources: join(__dirname, '../../../resources'), cli: 'c', db: 'd', node: 'n', settings: DEFAULTS, addDirs: dirs })
    expect(l.args.slice(4)).toEqual(['--add-dir', join(project, 'svc'), '--add-dir', join(project, 'web/packages/ui')])
    expect(readCatalog(project, home, dirs).map((c) => [c.name, c.source])).toEqual([
      ['personal', 'user'], ['start-ticket', 'svc'], ['ui-review', 'ui'], ['workspace-skill', 'project']
    ])
  })
})

describe('copies', () => {
  it('keeps the most complete copy of a repo and skips older copies with fewer skills', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'home-')))
    const project = join(home, 'Project')
    skill(join(project, 'old-clone'), 'clean-design')
    skill(join(project, 'service'), 'clean-design')
    skill(join(project, 'service'), 'start-ticket')
    skill(join(project, 'other'), 'add-kong-route')
    expect(skillDirs(project, home)).toEqual({
      dirs: [join(project, 'other'), join(project, 'service')],
      skipped: [{ dir: join(project, 'old-clone'), sameAs: join(project, 'service') }]
    })
  })
})
