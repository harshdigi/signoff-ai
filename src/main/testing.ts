// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import { inUserShell, type TerminalManager } from './terminals'

// Test panel (IDE/D16 E): find specs, pick the ones related to a change, run one file or one example
// in a visible terminal, and read the reporter's JSON for the result.

export type Framework = 'rspec' | 'vitest' | 'jest' | 'pytest' | 'go'
export type Example = { name: string; status: 'passed' | 'failed' | 'pending'; file: string; line: number | null; message: string | null }
export type TestRun = {
  id: string; root: string; target: string; framework: Framework; command: string; terminal: string
  status: 'running' | 'passed' | 'failed' | 'error'; examples: Example[]; summary: string; error: string | null
  started_at: number; finished_at: number | null
}

const run = promisify(execFile)
const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export function detectFramework(root: string): Framework | null {
  if (existsSync(join(root, 'spec')) && /rspec/.test(read(join(root, 'Gemfile')))) return 'rspec'
  const pkg = read(join(root, 'package.json'))
  if (/"vitest"/.test(pkg)) return 'vitest'
  if (/"jest"/.test(pkg)) return 'jest'
  if (existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'conftest.py')) || /\[tool\.pytest/.test(read(join(root, 'pyproject.toml'))) || /\[tool:pytest\]/.test(read(join(root, 'setup.cfg')))) return 'pytest'
  if (existsSync(join(root, 'go.mod'))) return 'go'
  return null
}

const SPEC: Record<Framework, RegExp> = {
  rspec: /^spec\/.*_spec\.rb$/,
  vitest: /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/,
  jest: /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/,
  pytest: /(^|\/)(test_[^/]+|[^/]+_test)\.py$/,
  go: /_test\.go$/
}

// Tracked and new (not ignored) files, from git: fast even in large repos.
export async function listSpecs(root: string, fw: Framework): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  return stdout.split('\n').filter((f) => SPEC[fw].test(f) && !f.includes('node_modules/')).sort()
}

// Specs a changed file most likely affects, by the framework's naming conventions. Changed specs count too.
export function relatedSpecs(fw: Framework, changed: string[], all: string[]): string[] {
  const have = new Set(all)
  const out = new Set<string>()
  for (const f of changed) {
    if (have.has(f)) {
      out.add(f)
      continue
    }
    const candidates: string[] = []
    if (fw === 'rspec' && f.endsWith('.rb')) {
      const stem = f.replace(/\.rb$/, '')
      const inApp = stem.replace(/^app\//, '')
      candidates.push(`spec/${inApp}_spec.rb`, `spec/${stem}_spec.rb`)
      const ctrl = /^app\/controllers\/(.+)_controller$/.exec(stem)
      if (ctrl) candidates.push(`spec/requests/${ctrl[1]}_spec.rb`, `spec/requests/${ctrl[1]}_controller_spec.rb`)
    } else if (fw === 'pytest' && f.endsWith('.py')) {
      const name = basename(f, '.py')
      candidates.push(join(dirname(f), `test_${name}.py`), `tests/test_${name}.py`, join('tests', dirname(f), `test_${name}.py`))
    } else if (fw === 'go' && f.endsWith('.go')) {
      candidates.push(f.replace(/\.go$/, '_test.go'))
    } else if ((fw === 'vitest' || fw === 'jest') && /\.[cm]?[jt]sx?$/.test(f)) {
      const ext = /\.[cm]?[jt]sx?$/.exec(f)![0]
      const name = basename(f, ext)
      const dir = dirname(f)
      for (const kind of ['test', 'spec']) for (const e of [ext, '.ts', '.tsx', '.js'])
        candidates.push(join(dir, `${name}.${kind}${e}`), join(dir, '__tests__', `${name}.${kind}${e}`))
    }
    for (const c of candidates) if (have.has(c)) out.add(c)
  }
  return [...out].sort()
}

// target: one spec (file, or file:line for one example) or several files. out: where the machine-readable report goes.
// npx --no: never download a missing tool (it would stop and prompt); fail with a clear message instead.
export function command(fw: Framework, target: string | string[], out: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  const targets = Array.isArray(target) ? target : [target]
  const files = targets.map((t) => q(t.replace(/:\d+$/, ''))).join(' ')
  if (fw === 'rspec') return `bundle exec rspec ${targets.map(q).join(' ')} --format progress --format json --out ${q(out)}`
  if (fw === 'vitest') return `npx --no vitest run ${files} --reporter=default --reporter=json --outputFile=${q(out)}`
  if (fw === 'pytest') return `python -m pytest ${files} --junitxml=${q(out)}`
  if (fw === 'go') return `go test -json ${[...new Set(targets.map((t) => './' + dirname(t.replace(/:\d+$/, ''))))].map(q).join(' ')} | tee ${q(out)}`
  return `npx --no jest ${files} --json --outputFile=${q(out)}`
}

type RspecJson = { examples?: { full_description: string; status: string; file_path: string; line_number: number; exception?: { class: string; message: string } }[]; summary_line?: string }
type JestJson = { testResults?: { name: string; assertionResults?: { fullName: string; status: string; failureMessages?: string[]; location?: { line: number } }[] }[]; numPassedTests?: number; numFailedTests?: number; numPendingTests?: number }

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null
}
const tally = (ex: Example[]): string => `${ex.filter((e) => e.status === 'passed').length} passed, ${ex.filter((e) => e.status === 'failed').length} failed, ${ex.filter((e) => e.status === 'pending').length} pending`

export function parseReport(fw: Framework, root: string, text: string): { examples: Example[]; summary: string } {
  // pytest: its built-in JUnit XML report (no plugin needed).
  if (fw === 'pytest') {
    const examples: Example[] = [...text.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => {
      const inner = m[2] ?? ''
      const fail = /<(failure|error)\b([^>]*)>?/.exec(inner)
      const file = attr(m[1], 'file') ?? (attr(m[1], 'classname') ?? '').replace(/\./g, '/') + '.py'
      return {
        name: `${attr(m[1], 'classname') ?? ''} ${attr(m[1], 'name') ?? ''}`.trim(), status: fail ? 'failed' : /<skipped/.test(inner) ? 'pending' : 'passed',
        file, line: attr(m[1], 'line') ? Number(attr(m[1], 'line')) : null, message: fail ? attr(fail[2], 'message') : null
      } as Example
    })
    return { examples, summary: tally(examples) }
  }
  // go test -json: one JSON object per line; a test's output lines come before its pass/fail line.
  if (fw === 'go') {
    const output = new Map<string, string[]>()
    const examples: Example[] = []
    for (const line of text.split('\n')) {
      let e: { Action?: string; Test?: string; Package?: string; Output?: string }
      try { e = JSON.parse(line) } catch { continue } // `go test -json` also passes build errors through as plain text
      if (!e.Test) continue
      const key = `${e.Package}/${e.Test}`
      if (e.Action === 'output') output.set(key, [...(output.get(key) ?? []), e.Output ?? ''])
      if (e.Action === 'pass' || e.Action === 'fail' || e.Action === 'skip') {
        examples.push({ name: e.Test, status: e.Action === 'pass' ? 'passed' : e.Action === 'fail' ? 'failed' : 'pending', file: e.Package ?? '', line: null, message: e.Action === 'fail' ? (output.get(key) ?? []).join('').slice(-4000) : null })
      }
    }
    return { examples, summary: tally(examples) }
  }
  const data = JSON.parse(text)
  if (fw === 'rspec') {
    const j = data as RspecJson
    return {
      examples: (j.examples ?? []).map((e) => ({
        name: e.full_description, status: e.status === 'passed' ? 'passed' : e.status === 'failed' ? 'failed' : 'pending',
        file: e.file_path.replace(/^\.\//, ''), line: e.line_number, message: e.exception ? `${e.exception.class}: ${e.exception.message}` : null
      })),
      summary: j.summary_line ?? ''
    }
  }
  const j = data as JestJson
  const examples: Example[] = (j.testResults ?? []).flatMap((r) => (r.assertionResults ?? []).map((a) => ({
    name: a.fullName, status: a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'pending',
    file: r.name.startsWith(root + '/') ? r.name.slice(root.length + 1) : r.name, line: a.location?.line ?? null,
    message: a.failureMessages?.length ? a.failureMessages.join('\n').slice(0, 4000) : null
  } as Example)))
  return { examples, summary: `${j.numPassedTests ?? 0} passed, ${j.numFailedTests ?? 0} failed, ${j.numPendingTests ?? 0} pending` }
}

const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')

export class TestRunner {
  private runs = new Map<string, TestRun>()
  private listeners = new Set<(r: TestRun) => void>()
  private reports = new Map<string, string>() // run id -> where its reporter writes JSON

  constructor(private terms: TerminalManager) {
    terms.onExit(({ id }) => {
      const r = [...this.runs.values()].find((x) => x.terminal === id && x.status === 'running')
      if (r) this.finish(r)
    })
  }

  onResult(l: (r: TestRun) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  list(): TestRun[] {
    return [...this.runs.values()].sort((a, b) => b.started_at - a.started_at)
  }

  // target: a spec file, file:line for one example, or several files. The caller checks they are known specs of that root.
  start(root: string, fw: Framework, target: string | string[]): TestRun {
    const out = join(mkdtempSync(join(tmpdir(), 'decision-ide-test-')), 'report.json')
    const cmd = command(fw, target, out)
    const t = this.terms.spawn({ ...inUserShell(cmd), cwd: root })
    const r: TestRun = {
      id: t.id, root, target: Array.isArray(target) ? target.join(' ') : target, framework: fw, command: cmd, terminal: t.id, status: 'running', examples: [], summary: '', error: null,
      started_at: Date.now(), finished_at: null
    }
    this.runs.set(r.id, r)
    this.reports.set(r.id, out)
    this.emit(r)
    return r
  }

  private finish(r: TestRun): void {
    const out = this.reports.get(r.id)!
    r.finished_at = Date.now()
    try {
      const rep = parseReport(r.framework, r.root, readFileSync(out, 'utf8'))
      r.examples = rep.examples
      r.summary = rep.summary
      r.status = rep.examples.some((e) => e.status === 'failed') ? 'failed' : rep.examples.length ? 'passed' : 'error'
      if (r.status === 'error') r.error = 'No examples ran.'
    } catch {
      // No report: the run failed before tests started (load error, missing gem). Show the end of its output.
      r.status = 'error'
      r.error = strip(this.terms.replay(r.terminal)).trim().split('\n').slice(-25).join('\n')
    }
    this.emit(r)
  }

  private emit(r: TestRun): void {
    this.listeners.forEach((l) => l({ ...r }))
  }
}
