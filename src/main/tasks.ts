// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, join } from 'path'

// Tasks for the toolbar buttons and the task menu (IDE/D13). Detected from the folder; nothing is written to it.
// - Each task runs in a visible terminal tab, so the user sees the exact command.
// - The window can only run a task by id from this list, never an arbitrary command.

export type TaskGroup = 'launch' | 'console' | 'test' | 'seed' | 'other'
// root: the repo it runs in (the open folder, or a repo inside it). Commands Claude added have source 'custom'.
export type Task = { id: string; label: string; command: string; group: TaskGroup; source: string; root: string; repo: string }
export type Custom = { label: string; command: string; group: TaskGroup }
export type TaskList = { tasks: Task[]; problems: string[] }

const read = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null)

function packageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

// .vscode/tasks.json is JSONC: drop comments and trailing commas before parsing.
export const parseJsonc = (text: string): unknown =>
  JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str) => str ?? '').replace(/,(\s*[}\]])/g, '$1'))

export function detectTasks(root: string, custom: Custom[] = []): TaskList {
  const tasks: Task[] = []
  const problems: string[] = []
  const add = (label: string, command: string, group: TaskGroup, source: string): void => {
    if (!tasks.some((t) => t.command === command)) tasks.push({ id: `${root}#${source}:${label}`, label, command, group, source, root, repo: basename(root) })
  }
  for (const c of custom) add(c.label, c.command, c.group, 'custom')

  // Rails
  const rails = existsSync(join(root, 'bin/rails'))
  if (existsSync(join(root, 'bin/dev'))) add('Start dev server', 'bin/dev', 'launch', 'rails')
  else if (rails) add('Start Rails server', 'bin/rails server', 'launch', 'rails')
  if (rails && existsSync(join(root, 'db/seeds.rb'))) add('Seed database', 'bin/rails db:seed', 'seed', 'rails')
  if (rails && existsSync(join(root, 'db'))) add('Migrate database', 'bin/rails db:migrate', 'other', 'rails')
  if (rails) {
    add('Rails console', 'bin/rails console', 'console', 'rails')
    add('Database console', 'bin/rails dbconsole', 'console', 'rails')
    add('Routes', 'bin/rails routes', 'other', 'rails')
    // Debugging with the debug gem (rdbg): the server must open a debug socket; Attach connects a console to it.
    if (/^\s*gem ['"]debug['"]/m.test(read(join(root, 'Gemfile')) ?? '')) {
      if (!/RUBY_DEBUG_OPEN/.test(read(join(root, 'Procfile.dev')) ?? '')) add('Start server for debugging', 'RUBY_DEBUG_OPEN=true bin/rails server', 'launch', 'rails')
      add('Attach debugger', 'bundle exec rdbg --attach', 'console', 'rails')
    }
  }

  // Django
  if (existsSync(join(root, 'manage.py'))) {
    add('Start Django server', 'python manage.py runserver', 'launch', 'django')
    add('Django shell', 'python manage.py shell', 'console', 'django')
    add('Migrate database', 'python manage.py migrate', 'other', 'django')
    add('Run tests', 'python manage.py test', 'test', 'django')
  } else if (existsSync(join(root, 'pytest.ini')) || /\[tool\.pytest/.test(read(join(root, 'pyproject.toml')) ?? '')) add('Run pytest', 'pytest', 'test', 'python')

  // Go
  if (existsSync(join(root, 'go.mod'))) {
    add('go run', 'go run .', 'launch', 'go')
    add('go test', 'go test ./...', 'test', 'go')
  }
  if (existsSync(join(root, 'spec')) && /rspec/.test(read(join(root, 'Gemfile')) ?? '')) add('Run RSpec', 'bundle exec rspec', 'test', 'rails')
  else if (rails && existsSync(join(root, 'test'))) add('Run tests', 'bin/rails test', 'test', 'rails')

  // package.json scripts
  const pkgText = read(join(root, 'package.json'))
  if (pkgText) {
    try {
      const scripts = (JSON.parse(pkgText).scripts ?? {}) as Record<string, string>
      const pm = packageManager(root)
      const run = (name: string): string => (['test', 'start'].includes(name) ? `${pm} ${name}` : `${pm} run ${name}`)
      for (const name of Object.keys(scripts)) {
        const group: TaskGroup = name === 'dev' || name === 'start' ? 'launch' : name === 'test' ? 'test' : /seed/.test(name) ? 'seed' : 'other'
        add(name, run(name), group, 'npm')
      }
    } catch (e) {
      problems.push(`package.json: ${(e as Error).message}`)
    }
  }

  // Makefile targets
  const make = read(join(root, 'Makefile'))
  if (make) for (const m of make.matchAll(/^([A-Za-z0-9][\w-]*):(?!=)/gm)) add(`make ${m[1]}`, `make ${m[1]}`, m[1] === 'test' ? 'test' : 'other', 'make')

  // .vscode/tasks.json shell tasks
  const vs = read(join(root, '.vscode/tasks.json'))
  if (vs) {
    try {
      const list = ((parseJsonc(vs) as { tasks?: unknown[] }).tasks ?? []) as { label?: string; type?: string; command?: string; args?: string[]; group?: string | { kind?: string } }[]
      for (const t of list) {
        if ((t.type !== 'shell' && t.type !== 'process') || !t.command || !t.label) continue
        const kind = typeof t.group === 'string' ? t.group : t.group?.kind
        add(t.label, [t.command, ...(t.args ?? [])].join(' '), kind === 'test' ? 'test' : 'other', 'vscode')
      }
    } catch (e) {
      problems.push(`.vscode/tasks.json: ${(e as Error).message}`)
    }
  }
  return { tasks, problems }
}

// Where tasks can run: the open folder when it is a project, and each git repo directly inside it (a folder of repos).
const MARKERS = ['Gemfile', 'package.json', 'manage.py', 'go.mod', 'pyproject.toml', 'Makefile', 'bin/rails', '.vscode/tasks.json']
const isProject = (dir: string): boolean => MARKERS.some((m) => existsSync(join(dir, m)))
export function runRoots(folder: string): string[] {
  const inside = readdirSync(folder).filter((d) => !d.startsWith('.')).map((d) => join(folder, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, '.git')) && isProject(d))
  return [...(isProject(folder) ? [folder] : []), ...inside]
}

// Every repo's tasks in one list (ids carry the repo, so the window can only run what is listed here).
export function detectAll(folder: string, custom: (root: string) => Custom[]): TaskList {
  const all = runRoots(folder).map((r) => detectTasks(r, custom(r)))
  return { tasks: all.flatMap((l) => l.tasks), problems: all.flatMap((l) => l.problems) }
}
