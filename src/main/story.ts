// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import type { Store } from './store'
import { headlessArgs } from './headless'

// The Story page (SIGNOFF-24/D3): per ticket, the decision chart (drawn by the app from the board, free and always
// current) and Claude's plain summary plus a simple "how it works" flow (written on Update; read-only run).
export type ChartNode = { id: string; question: string; answer: string | null; by: string; status: string; at: string; kind: 'decision' | 'plan' | 'review' }
export type Story = { summary: string[]; flow: { step: string; detail: string }[]; technical: string }

// Decisions, the plan card and reviews of a ticket, oldest first, with who settled each: you or Claude (and its mode).
export function chartOf(db: Store, ticket: string): ChartNode[] {
  const ds = db.prepare("SELECT id, question, answer, answered_by, status, created_at, autonomy_item FROM decisions WHERE ticket = ? AND status != 'withdrawn' ORDER BY created_at, rowid").all(ticket) as
    { id: string; question: string; answer: string | null; answered_by: string | null; status: string; created_at: string; autonomy_item: string | null }[]
  const rs = db.prepare("SELECT id, title, status, note, created_at FROM reviews WHERE ticket = ? AND status NOT IN ('replaced', 'dismissed') ORDER BY created_at, rowid").all(ticket) as
    { id: string; title: string; status: string; note: string | null; created_at: string }[]
  const who = (by: string | null, status: string): string => (status === 'open' ? 'waiting for you' : !by ? 'you' : by.startsWith('claude') ? by : 'you')
  return [
    ...ds.map((d): ChartNode => ({ id: d.id, question: d.question, answer: d.answer ? d.answer.split('::')[0].trim() : null, by: who(d.answered_by, d.status), status: d.status, at: d.created_at, kind: d.autonomy_item === 'plan' ? 'plan' : 'decision' })),
    ...rs.map((r): ChartNode => ({ id: r.id, question: r.title, answer: r.status === 'open' ? null : r.status.replace('_', ' '), by: r.status === 'open' ? 'waiting for you' : r.note?.startsWith('Accepted by claude') ? r.note.slice('Accepted by '.length) : 'you', status: r.status, at: r.created_at, kind: 'review' }))
  ].sort((a, b) => a.at.localeCompare(b.at))
}

export function storyPrompt(ticket: string, chart: ChartNode[], diffStat: string): string {
  return [
    `Write the story of ${ticket} for someone who will not read code. READ-ONLY: do not edit, run or send anything; you may read files.`,
    'Decisions so far (oldest first):',
    ...chart.map((n) => `- ${n.id}: ${n.question} -> ${n.answer ?? 'open'} (${n.by})`),
    'Files changed on this branch:',
    diffStat.trim() || '(none yet)',
    '',
    'Reply with ONLY this JSON between <story> and </story>:',
    '{ "summary": ["3 to 5 short plain sentences: the problem, what changes for users, what is left"],',
    '  "flow": [{ "step": "a few plain words", "detail": "one plain sentence" }],   (4 to 8 steps: how it works, start to end)',
    '  "technical": "markdown for engineers: the main files and functions, data changes, edge cases, how it was tested" }',
    'Plain words in summary and flow: no file names, no code, no jargon.'
  ].join('\n')
}

export function parseStory(out: string): Story {
  const m = /<story>([\s\S]*?)<\/story>/.exec(out)
  if (!m) throw new Error(`the story run did not return a story: ${out.slice(0, 200)}`)
  const s = JSON.parse(m[1]) as Story
  if (!Array.isArray(s.summary) || !Array.isArray(s.flow) || typeof s.technical !== 'string') throw new Error('the story is incomplete')
  return s
}

// Files changed on the branch against where it left main (the same base Files changed uses: origin/main).
export function diffStatOf(cwd: string): string {
  try {
    const base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
    return execFileSync('git', ['diff', '--stat', base], { cwd, encoding: 'utf8' })
  } catch (e) {
    return `(could not read the branch's changes: ${(e as Error).message.split('\n')[0]})`
  }
}

export async function writeStory(db: Store, ticket: string, cwd: string, run: (args: string[]) => Promise<{ code: number; out: string }>): Promise<Story> {
  const r = await run(headlessArgs(storyPrompt(ticket, chartOf(db, ticket), diffStatOf(cwd)), { disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  if (r.code !== 0) throw new Error(`the story run failed: ${r.out.slice(0, 200)}`)
  const s = parseStory(r.out)
  db.prepare('INSERT INTO stories (ticket, story, written_at) VALUES (?, ?, ?) ON CONFLICT(ticket) DO UPDATE SET story = excluded.story, written_at = excluded.written_at').run(ticket, JSON.stringify(s), new Date().toISOString())
  return s
}

export function storyOf(db: Store, ticket: string): { story: Story; writtenAt: string } | null {
  const r = db.prepare('SELECT story, written_at FROM stories WHERE ticket = ?').get(ticket) as { story: string; written_at: string } | undefined
  return r ? { story: JSON.parse(r.story) as Story, writtenAt: r.written_at } : null
}
