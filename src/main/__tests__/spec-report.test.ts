// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { specReport, type SpecRun } from '../../renderer/src/ide/spec-report'

const run = (target: string, examples: SpecRun['examples'], at: number): SpecRun => ({ id: String(at), root: '/r', target, status: examples.some((e) => e.status === 'failed') ? 'failed' : 'passed', examples, summary: '', error: null, started_at: at, framework: 'rspec' })
const ex = (file: string, name: string, status: 'passed' | 'failed', message: string | null = null): SpecRun['examples'][number] => ({ file, name, status, line: 4, message })

describe('spec report', () => {
  it('summarises the latest run per spec, lists failures and not-run files, the test plan and the review', () => {
    const md = specReport({
      title: 'ABC-1', at: new Date(0),
      specs: [{ repo: 'svc', root: '/r', file: 'spec/a_spec.rb', framework: 'rspec' }, { repo: 'svc', root: '/r', file: 'spec/b_spec.rb', framework: 'rspec' }],
      runs: [run('spec/a_spec.rb', [ex('spec/a_spec.rb', 'a old', 'failed', 'old')], 1), run('spec/a_spec.rb spec/c_spec.rb', [ex('spec/a_spec.rb', 'a works', 'passed'), ex('spec/a_spec.rb', 'a rejects', 'failed', 'expected 404\ngot 200')], 2)],
      cases: [{ plan: 'ABC-1', idx: 1, title: 'Creator sees sessions', steps: '', expected: '', status: 'pass', verified_by: 'claude', evidence: 'spec/a_spec.rb:4 green', created_at: '', updated_at: '' }],
      review: null
    })
    expect(md).toContain('- Spec files changed: 2 (1 run, 1 not run)')
    expect(md).toContain('- Examples: 2 run, 1 passed, 1 failed, 0 pending')
    expect(md).toContain('- `svc/spec/a_spec.rb`: ✗ 1 failing (2 examples, rspec)\n  - a rejects (line 4): expected 404')
    expect(md).toContain('- `svc/spec/b_spec.rb`: not run')
    expect(md).toContain('- #1 Creator sees sessions: **pass** (verified by Claude)\n  - Evidence: spec/a_spec.rb:4 green')
    expect(md).toContain('_Not reviewed yet: use "Review specs with Claude"._')
  })
})
