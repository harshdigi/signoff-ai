// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { TerminalManager } from '../terminals'
import { command, detectFramework, listSpecs, parseReport, relatedSpecs, TestRunner, type TestRun } from '../testing'

const tmp = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'tests-')))
const write = (root: string, p: string, s: string): void => {
  mkdirSync(join(root, p, '..'), { recursive: true })
  writeFileSync(join(root, p), s)
}

describe('finding specs', () => {
  it('maps changed files to specs by convention, and counts changed specs', () => {
    const all = ['spec/models/user_spec.rb', 'spec/services/pay_service_spec.rb', 'spec/requests/api/v1/orders_spec.rb', 'spec/lib/money_spec.rb']
    expect(relatedSpecs('rspec', ['app/models/user.rb', 'app/controllers/api/v1/orders_controller.rb', 'lib/money.rb', 'spec/services/pay_service_spec.rb', 'README.md'], all))
      .toEqual(['spec/lib/money_spec.rb', 'spec/models/user_spec.rb', 'spec/requests/api/v1/orders_spec.rb', 'spec/services/pay_service_spec.rb'])
    expect(relatedSpecs('vitest', ['src/a/b.ts', 'src/c.tsx'], ['src/a/b.test.ts', 'src/__tests__/c.test.tsx', 'src/x.test.ts'])).toEqual(['src/__tests__/c.test.tsx', 'src/a/b.test.ts'])
  })

  it('detects the framework and lists specs from git, new files included', () => {
    const root = tmp()
    execFileSync('git', ['init', '-q'], { cwd: root })
    write(root, 'Gemfile', "gem 'rspec-rails'")
    write(root, 'spec/models/a_spec.rb', '')
    write(root, 'spec/support/helper.rb', '')
    expect(detectFramework(root)).toBe('rspec')
    return listSpecs(root, 'rspec').then((s) => expect(s).toEqual(['spec/models/a_spec.rb']))
  })

  it('builds commands with a JSON report and safe quoting', () => {
    expect(command('rspec', "spec/a_spec.rb:12", '/t/r.json')).toBe("bundle exec rspec 'spec/a_spec.rb:12' --format progress --format json --out '/t/r.json'")
    expect(command('vitest', "src/it's.test.ts:4", '/t/r.json')).toBe("npx --no vitest run 'src/it'\\''s.test.ts' --reporter=default --reporter=json --outputFile='/t/r.json'")
  })

  it('reads RSpec and Jest-style reports', () => {
    const rspec = parseReport('rspec', '/r', JSON.stringify({
      summary_line: '2 examples, 1 failure',
      examples: [
        { full_description: 'User is valid', status: 'passed', file_path: './spec/models/user_spec.rb', line_number: 4 },
        { full_description: 'User rejects bad email', status: 'failed', file_path: './spec/models/user_spec.rb', line_number: 9, exception: { class: 'RSpec::Expectations::ExpectationNotMetError', message: 'expected false' } }
      ]
    }))
    expect(rspec).toEqual({ summary: '2 examples, 1 failure', examples: [
      { name: 'User is valid', status: 'passed', file: 'spec/models/user_spec.rb', line: 4, message: null },
      { name: 'User rejects bad email', status: 'failed', file: 'spec/models/user_spec.rb', line: 9, message: 'RSpec::Expectations::ExpectationNotMetError: expected false' }
    ] })
    const jest = parseReport('vitest', '/r', JSON.stringify({ numPassedTests: 0, numFailedTests: 1, numPendingTests: 0, testResults: [{ name: '/r/a.test.ts', assertionResults: [{ fullName: 'a fails', status: 'failed', failureMessages: ['boom'], location: { line: 3 } }] }] }))
    expect(jest).toEqual({ summary: '0 passed, 1 failed, 0 pending', examples: [{ name: 'a fails', status: 'failed', file: 'a.test.ts', line: 3, message: 'boom' }] })
  })
})

describe('TestRunner', () => {
  it('runs a real spec file in a terminal and reads the result from the JSON report', async () => {
    const root = tmp()
    execFileSync('git', ['init', '-q'], { cwd: root })
    write(root, 'package.json', JSON.stringify({ name: 't', type: 'module', devDependencies: { vitest: '*' } }))
    symlinkSync(join(__dirname, '../../../node_modules'), join(root, 'node_modules'))
    write(root, 'math.test.js', "import { it, expect } from 'vitest'\nit('adds', () => expect(1 + 1).toBe(2))\nit('fails on purpose', () => expect(1 + 1).toBe(3))\n")
    const terms = new TerminalManager()
    const runner = new TestRunner(terms)
    const done = new Promise<TestRun>((resolve) => runner.onResult((r) => r.status !== 'running' && resolve(r)))
    const r = runner.start(root, 'vitest', 'math.test.js')
    expect(r.status).toBe('running')
    const result = await done
    terms.closeAll()
    expect([result.status, result.summary]).toEqual(['failed', '1 passed, 1 failed, 0 pending'])
    expect(result.examples.map((e) => [e.name, e.status, e.file])).toEqual([['adds', 'passed', 'math.test.js'], ['fails on purpose', 'failed', 'math.test.js']])
    expect(result.examples[1].message).toContain('expected 2 to be 3')
  }, 60000)

  it('reports a run that never started its tests, with the end of its output', async () => {
    const root = tmp()
    const terms = new TerminalManager()
    const runner = new TestRunner(terms)
    const done = new Promise<TestRun>((resolve) => runner.onResult((r) => r.status !== 'running' && resolve(r)))
    runner.start(root, 'jest', 'missing.test.js')
    const result = await done
    terms.closeAll()
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
  }, 60000)

  it('runs pytest and go test too, several files at once, and reads their reports', () => {
    expect(command('pytest', ['tests/test_a.py', 'tests/test_b.py'], '/t/r.xml')).toBe("python -m pytest 'tests/test_a.py' 'tests/test_b.py' --junitxml='/t/r.xml'")
    expect(command('go', ['pkg/a/x_test.go', 'pkg/a/y_test.go'], '/t/r.json')).toBe("go test -json './pkg/a' | tee '/t/r.json'")
    expect(command('rspec', ['spec/a_spec.rb', 'spec/b_spec.rb'], '/t/r.json')).toBe("bundle exec rspec 'spec/a_spec.rb' 'spec/b_spec.rb' --format progress --format json --out '/t/r.json'")
    const py = parseReport('pytest', '/r', '<testsuite><testcase classname="tests.test_a" name="test_ok" file="tests/test_a.py" line="3"/><testcase classname="tests.test_a" name="test_bad" file="tests/test_a.py" line="9"><failure message="assert 1 == 2">trace</failure></testcase><testcase classname="tests.test_a" name="test_skip"><skipped/></testcase></testsuite>')
    expect(py.examples.map((e) => [e.name, e.status, e.line, e.message])).toEqual([['tests.test_a test_ok', 'passed', 3, null], ['tests.test_a test_bad', 'failed', 9, 'assert 1 == 2'], ['tests.test_a test_skip', 'pending', null, null]])
    expect(py.summary).toBe('1 passed, 1 failed, 1 pending')
    const go = parseReport('go', '/r', ['{"Action":"run","Package":"x/a","Test":"TestOk"}', '{"Action":"pass","Package":"x/a","Test":"TestOk"}', '{"Action":"output","Package":"x/a","Test":"TestBad","Output":"want 2 got 1\\n"}', '{"Action":"fail","Package":"x/a","Test":"TestBad"}', 'not json'].join('\n'))
    expect(go.examples.map((e) => [e.name, e.status, e.message])).toEqual([['TestOk', 'passed', null], ['TestBad', 'failed', 'want 2 got 1\n']])
  })

  it('finds pytest and go test files for changed code', () => {
    expect(relatedSpecs('pytest', ['app/money.py'], ['tests/test_money.py', 'app/test_money.py'])).toEqual(['app/test_money.py', 'tests/test_money.py'])
    expect(relatedSpecs('go', ['pkg/pay.go'], ['pkg/pay_test.go'])).toEqual(['pkg/pay_test.go'])
  })
})

