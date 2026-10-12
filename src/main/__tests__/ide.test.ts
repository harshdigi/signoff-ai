// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { frontmatter, readCatalog } from '../catalog'
import { detectTasks, parseJsonc } from '../tasks'
import { changes, fileDiff, parseStatus } from '../workspace'
import { toRows, toolSummary } from '../../renderer/src/chat/transcript'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'ide-'))
const write = (root: string, path: string, text: string): void => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}

describe('git changes', () => {
  it('parses porcelain -z status, including renames and untracked files', () => {
    expect(parseStatus(' M a.rb\0R  new.rb\0old.rb\0?? b.txt\0D  gone.rb\0UU c.rb\0')).toEqual([
      { path: 'a.rb', status: 'modified' }, { path: 'b.txt', status: 'untracked' }, { path: 'c.rb', status: 'conflict' },
      { path: 'gone.rb', status: 'deleted' }, { path: 'new.rb', status: 'renamed', from: 'old.rb' }
    ])
  })

  it('reads changes and HEAD-vs-disk diffs from a real repo', () => {
    const root = tmp()
    const g = (...a: string[]): string => execFileSync('git', a, { cwd: root, encoding: 'utf8' })
    g('init', '-q', '-b', 'main')
    write(root, 'a.txt', 'one\n')
    g('add', '.')
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    write(root, 'a.txt', 'two\n')
    write(root, 'n.txt', 'new\n')
    const c = changes(root)
    expect(c.git && c.branch).toBe('main')
    expect(c.files).toEqual([{ path: 'a.txt', status: 'modified' }, { path: 'n.txt', status: 'untracked' }])
    expect(fileDiff(c.root!, c.files[0])).toEqual({ path: 'a.txt', original: 'one\n', modified: 'two\n', binary: false, tooLarge: false })
    expect(fileDiff(c.root!, c.files[1])).toMatchObject({ original: '', modified: 'new\n' })
    expect(changes(tmp())).toMatchObject({ git: false, files: [] })
  })
})

describe('tasks', () => {
  it('detects Rails, package.json, Makefile and .vscode tasks', () => {
    const root = tmp()
    write(root, 'bin/rails', '')
    write(root, 'bin/dev', '')
    write(root, 'db/seeds.rb', '')
    write(root, 'Gemfile', "gem 'rspec-rails'")
    mkdirSync(join(root, 'spec'))
    write(root, 'package.json', JSON.stringify({ scripts: { dev: 'vite', test: 'vitest', 'db:seed': 'node seed.js' } }))
    write(root, 'yarn.lock', '')
    write(root, 'Makefile', 'build:\n\tgo build\nX := 1\n')
    write(root, '.vscode/tasks.json', '{ // comment\n "tasks": [{ "label": "Lint", "type": "shell", "command": "eslint", "args": ["."], },] }')
    const { tasks, problems } = detectTasks(root)
    expect(problems).toEqual([])
    expect(tasks.map((t) => [t.group, t.label, t.command])).toEqual([
      ['launch', 'Start dev server', 'bin/dev'], ['seed', 'Seed database', 'bin/rails db:seed'], ['other', 'Migrate database', 'bin/rails db:migrate'],
      ['console', 'Rails console', 'bin/rails console'], ['console', 'Database console', 'bin/rails dbconsole'], ['other', 'Routes', 'bin/rails routes'],
      ['test', 'Run RSpec', 'bundle exec rspec'], ['launch', 'dev', 'yarn run dev'], ['test', 'test', 'yarn test'],
      ['seed', 'db:seed', 'yarn run db:seed'], ['other', 'make build', 'make build'], ['other', 'Lint', 'eslint .']
    ])
  })

  it('reports a broken tasks.json instead of hiding it', () => {
    const root = tmp()
    write(root, '.vscode/tasks.json', '{ nope')
    expect(detectTasks(root).problems[0]).toMatch(/^\.vscode\/tasks\.json: /)
    expect(parseJsonc('{"a": "http://x" /* c */, }')).toEqual({ a: 'http://x' })
  })
})

describe('catalog', () => {
  it('reads frontmatter, including block descriptions', () => {
    expect(frontmatter('---\nname: start-ticket\ndescription: >\n  Cut a branch\n  and plan\n---\nbody')).toEqual({ name: 'start-ticket', description: 'Cut a branch and plan' })
  })

  it('lists user, project and enabled-plugin items with roles; project shadows user', () => {
    const home = tmp()
    const project = tmp()
    write(home, '.claude/skills/start-ticket/SKILL.md', '---\nname: start-ticket\ndescription: user version\n---')
    write(home, '.claude/agents/pr-review.md', '---\nname: pr-review\ndescription: Reviews a PR\n---')
    write(project, '.claude/skills/start-ticket/SKILL.md', '---\nname: start-ticket\ndescription: project version\n---')
    write(project, '.claude/commands/ship.md', '---\ndescription: Ship it\n---')
    const plugin = join(home, 'plug')
    write(plugin, 'skills/lint/SKILL.md', '---\nname: lint\ndescription: Lints\n---')
    write(home, '.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'tools@m': [{ installPath: plugin }], 'off@m': [{ installPath: plugin }] } }))
    write(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'tools@m': true, 'off@m': false } }))
    expect(readCatalog(project, home).map((c) => [c.kind, c.name, c.source, c.invoke, c.role ?? null, c.description])).toEqual([
      ['agent', 'pr-review', 'user', 'Use the pr-review agent to ', 'review', 'Reviews a PR'],
      ['command', 'ship', 'project', '/ship', null, 'Ship it'],
      ['skill', 'start-ticket', 'project', '/start-ticket', 'start-ticket', 'project version'],
      ['skill', 'tools:lint', 'tools', '/tools:lint', null, 'Lints']
    ])
  })
})

describe('chat transcript', () => {
  it('shows command output (/context, /usage) as the reply, marks compaction, and finds the task list', async () => {
    const { latestTodos } = await import('../../renderer/src/chat/transcript')
    const rows = toRows([
      { type: 'prompt', text: '/context' },
      { type: 'result', subtype: 'success', result: '## Context Usage\n22k / 200k' },
      { type: 'system', subtype: 'compact_boundary' },
      { type: 'prompt', text: 'pics', images: 2 }
    ] as never[])
    expect(rows).toEqual([
      { kind: 'prompt', text: '/context' }, { kind: 'text', text: '## Context Usage\n22k / 200k' }, { kind: 'result', text: 'Done in ', isError: false },
      { kind: 'notice', text: 'Conversation compacted: earlier messages are now a summary.' }, { kind: 'prompt', text: 'pics', images: 2 }
    ])
    expect(latestTodos([
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }] } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] } }] } }
    ] as never[]).map((t) => t.status)).toEqual(['completed', 'in_progress'])
  })

  it('pairs tool calls with results and skips subagent internals', () => {
    const rows = toRows([
      { type: 'prompt', text: 'hi' },
      { type: 'assistant', message: { content: [{ type: 'thinking', text: '' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'assistant', parent_tool_use_id: 't9', message: { content: [{ type: 'text', text: 'inside a subagent' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'result', subtype: 'success', duration_ms: 1500, total_cost_usd: 0.05 },
      { type: 'error', text: 'boom' }
    ] as never[])
    expect(rows).toEqual([
      { kind: 'prompt', text: 'hi' },
      { kind: 'tool', id: 't1', name: 'Bash', input: { command: 'ls' }, result: 'a\nb', isError: false },
      { kind: 'text', text: 'Done.' },
      { kind: 'result', text: 'Done in 1.5s · est. $0.05 so far', isError: false },
      { kind: 'error', text: 'boom' }
    ])
    expect(toolSummary('Grep', { pattern: 'x', path: 'src' })).toBe('x in src')
  })
})

describe('run commands across a folder of repos', () => {
  it("finds each repo's tasks, adds Django shortcuts and commands added for a repo; ids carry the repo", async () => {
    const { detectAll, runRoots } = await import('../tasks')
    const top = tmp()
    write(top, 'service/manage.py', '')
    mkdirSync(join(top, 'service/.git'))
    write(top, 'notes/readme.md', 'not a project')
    expect(runRoots(top)).toEqual([join(top, 'service')])
    const { tasks } = detectAll(top, (r) => (r.endsWith('service') ? [{ label: 'Celery', command: 'celery -A app worker', group: 'launch' }] : []))
    expect(tasks.map((t) => [t.repo, t.group, t.label])).toEqual([
      ['service', 'launch', 'Celery'], ['service', 'launch', 'Start Django server'], ['service', 'console', 'Django shell'],
      ['service', 'other', 'Migrate database'], ['service', 'test', 'Run tests']
    ])
    expect(tasks[0].id).toBe(`${join(top, 'service')}#custom:Celery`)
  })
})

describe('Rails debugging', () => {
  it('offers Attach debugger when the debug gem is there, and a debug server only when Procfile.dev does not open one', () => {
    const root = tmp()
    write(root, 'bin/rails', '')
    write(root, 'Gemfile', "gem 'rails'\n  gem 'debug', platforms: %i[mri]\n")
    const labels = (): string[] => detectTasks(root).tasks.filter((t) => /debug/i.test(t.label)).map((t) => t.command)
    expect(labels()).toEqual(['RUBY_DEBUG_OPEN=true bin/rails server', 'bundle exec rdbg --attach'])
    write(root, 'Procfile.dev', 'web: env RUBY_DEBUG_OPEN=true bin/rails server\n')
    expect(labels()).toEqual(['bundle exec rdbg --attach'])
  })
})

