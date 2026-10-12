// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { TestCase } from '../board/types'

// The spec report (Test plan → Specs): what the changed specs are, how their latest runs went, the test plan cases,
// and Claude's review of the specs. Plain Markdown, so it can be pasted into a PR or a ticket. Built only from data
// the app has; anything not run yet is said to be not run.
export type SpecExample = { name: string; status: 'passed' | 'failed' | 'pending'; file: string; line: number | null; message: string | null }
export type SpecRun = { id: string; root: string; target: string; status: 'running' | 'passed' | 'failed' | 'error'; examples: SpecExample[]; summary: string; error: string | null; started_at: number; framework: string }
export type SpecFile = { repo: string; root: string; file: string; framework: string | null }

// The newest finished run that included this file, and its examples for this file.
export function resultFor(runs: SpecRun[], root: string, file: string): { run: SpecRun; examples: SpecExample[] } | null {
  const run = runs.filter((r) => r.status !== 'running' && r.target.split(' ').includes(file) && r.root === root).sort((a, b) => b.started_at - a.started_at)[0]
  if (!run) return null
  const own = run.examples.filter((e) => e.file === file || e.file.endsWith('/' + file))
  return { run, examples: own.length ? own : run.target === file ? run.examples : [] }
}

export function specReport(o: { title: string; at: Date; specs: SpecFile[]; runs: SpecRun[]; cases: TestCase[]; review: string | null }): string {
  const rows = o.specs.map((s) => ({ s, r: resultFor(o.runs, s.root, s.file) }))
  const all = rows.flatMap((x) => x.r?.examples ?? [])
  const count = (st: SpecExample['status']): number => all.filter((e) => e.status === st).length
  const notRun = rows.filter((x) => !x.r)
  const out: string[] = [
    `# Spec report: ${o.title}`,
    `_${o.at.toLocaleString()}_`,
    '',
    '## Summary',
    `- Spec files changed: ${o.specs.length} (${o.specs.length - notRun.length} run, ${notRun.length} not run)`,
    `- Examples: ${all.length} run, ${count('passed')} passed, ${count('failed')} failed, ${count('pending')} pending`,
    `- Test plan: ${o.cases.filter((c) => c.status === 'pass').length} of ${o.cases.length} cases passing`,
    '',
    '## Spec files'
  ]
  for (const { s, r } of rows) {
    const label = `\`${s.repo}/${s.file}\``
    if (!r) { out.push(`- ${label}: not run`); continue }
    if (r.run.status === 'error') { out.push(`- ${label}: could not run (${(r.run.error ?? '').split('\n').pop()})`); continue }
    const failed = r.examples.filter((e) => e.status === 'failed')
    out.push(`- ${label}: ${failed.length ? `✗ ${failed.length} failing` : '✓ passing'} (${r.examples.length} examples, ${s.framework ?? r.run.framework})`)
    for (const e of failed) out.push(`  - ${e.name}${e.line ? ` (line ${e.line})` : ''}: ${(e.message ?? '').split('\n')[0].slice(0, 300)}`)
  }
  out.push('', '## Test plan')
  if (!o.cases.length) out.push('- No test cases yet.')
  for (const c of o.cases) {
    out.push(`- #${c.idx} ${c.title}: **${c.status}**${c.verified_by ? ` (verified by ${c.verified_by === 'claude' ? 'Claude' : 'you'})` : ''}`)
    if (c.evidence) out.push(`  - Evidence: ${c.evidence.split('\n').join(' ').slice(0, 400)}`)
  }
  out.push('', '## Review of the specs (Claude)', o.review ?? '_Not reviewed yet: use "Review specs with Claude"._')
  return out.join('\n') + '\n'
}
