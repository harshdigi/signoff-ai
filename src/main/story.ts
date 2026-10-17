// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import type { Store } from './store'
import { headlessArgs } from './headless'

// The Story page (SIGNOFF-24/D3, D16-D18): per ticket, a decision diagram and a numbered "why" list.
// - The app draws the diagram from the board: free and always current, raw option labels.
// - Update asks Claude (read-only) for short box text, the why list, a one-line summary and folded notes.
// - Only real choices get a column (D17); approvals, the plan card and reviews are just counted.
export type Box = { title: string; lines: string[] }
export type Choice = { id: string; question: string; options: string[]; chosen: string | null; by: string; context: string[] }
export type Diagram = { choices: Choice[]; approvals: number; reviews: number }
export type Column = { id: string; question: Box; chosen: Box | null; rejected: Box[]; why: string[] }
export type Story = { summary: string; context: Box; columns: Column[]; flow: { step: string; detail: string }[]; technical: string }

const label = (option: string): string => option.split('::')[0].trim()

export function diagramOf(db: Store, ticket: string): Diagram {
  const ds = db.prepare("SELECT id, question, options, context, action, answer, answered_by, status, autonomy_item FROM decisions WHERE ticket = ? AND status != 'withdrawn' ORDER BY created_at, rowid").all(ticket) as
    { id: string; question: string; options: string; context: string; action: string | null; answer: string | null; answered_by: string | null; status: string; autonomy_item: string | null }[]
  const approval = (d: (typeof ds)[number]): boolean => d.action !== null || d.autonomy_item === 'plan'
  const choices = ds.filter((d) => !approval(d) && (JSON.parse(d.options) as string[]).length >= 2).map((d): Choice => ({
    id: d.id,
    question: d.question,
    options: (JSON.parse(d.options) as string[]).map(label),
    chosen: d.status === 'open' || !d.answer ? null : label(d.answer),
    by: d.status === 'open' ? 'waiting for you' : d.answered_by?.startsWith('claude') ? d.answered_by : 'you',
    context: JSON.parse(d.context) as string[]
  }))
  const reviews = (db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE ticket = ? AND status NOT IN ('replaced', 'dismissed')").get(ticket) as { n: number }).n
  return { choices, approvals: ds.filter(approval).length, reviews }
}

export function storyPrompt(ticket: string, d: Diagram, diffStat: string): string {
  const box = '{ "title": "2 to 4 words", "lines": ["at most 2 lines of 2 to 5 words"] }'
  return [
    `Write the story of ${ticket} as a decision diagram for someone who will not read code. READ-ONLY: do not edit, run or send anything; you may read files.`,
    'Choices so far (oldest first):',
    ...d.choices.flatMap((c) => [`- ${c.id}: ${c.question}`, `  options: ${c.options.join(' | ')}`, `  chosen: ${c.chosen ?? 'open'} (${c.by})`, ...c.context.map((l) => `  context: ${l}`)]),
    'Files changed on this branch:',
    diffStat.trim() || '(none yet)',
    '',
    'Reply with ONLY this JSON between <story> and </story>:',
    '{ "summary": "one plain sentence: the problem and what changes for users",',
    `  "context": ${box},   (where things stood before these choices)`,
    `  "columns": [{ "id": "the choice id as given", "question": ${box}, "chosen": ${box} or null when open,`,
    `      "rejected": [one ${box} per option not chosen], "why": ["2 to 4 points of 4 to 12 words: why the chosen way won"] }],   (one per choice, same order)`,
    '  "flow": [{ "step": "a few plain words", "detail": "one plain sentence" }],   (4 to 8 steps: how it works, start to end)',
    '  "technical": "markdown for engineers: the main files and functions, data changes, edge cases, how it was tested" }',
    'Keep boxes short: they sit in a narrow diagram. Plain words everywhere except technical: no file names, no code, no jargon.'
  ].join('\n')
}

export function parseStory(out: string): Story {
  const m = /<story>([\s\S]*?)<\/story>/.exec(out)
  if (!m) throw new Error(`the story run did not return a story: ${out.slice(0, 200)}`)
  const s = JSON.parse(m[1]) as Story
  if (typeof s.summary !== 'string' || !s.context || !Array.isArray(s.columns) || !Array.isArray(s.flow) || typeof s.technical !== 'string') throw new Error('the story is incomplete')
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
  const r = await run(headlessArgs(storyPrompt(ticket, diagramOf(db, ticket), diffStatOf(cwd)), { disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  if (r.code !== 0) throw new Error(`the story run failed: ${r.out.slice(0, 200)}`)
  const s = parseStory(r.out)
  db.prepare('INSERT INTO stories (ticket, story, written_at) VALUES (?, ?, ?) ON CONFLICT(ticket) DO UPDATE SET story = excluded.story, written_at = excluded.written_at').run(ticket, JSON.stringify(s), new Date().toISOString())
  return s
}

export function storyOf(db: Store, ticket: string): { story: Story; writtenAt: string } | null {
  const r = db.prepare('SELECT story, written_at FROM stories WHERE ticket = ?').get(ticket) as { story: string; written_at: string } | undefined
  return r ? { story: JSON.parse(r.story) as Story, writtenAt: r.written_at } : null
}
