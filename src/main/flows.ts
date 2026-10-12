// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, join, relative, resolve } from 'path'

// Flow docs (IDE/D16 G): Markdown docs whose claims carry `path:line` anchors into the code, like Claude Docs.
// The app reads a folder of them (Settings) and answers: which docs cover this file, which docs a change touches,
// and which anchors no longer point at a real line.

export type Anchor = { doc: string; heading: string; docLine: number; file: string; start: number | null; end: number | null }

// Same shape as Claude Docs' anchors.py, with more file types: `app/x.rb`, `app/x.rb:12`, `app/x.rb:12-30`.
const ANCHOR = /`([A-Za-z0-9_./-]+\.(?:rb|ts|tsx|js|jsx|mjs|erb|yml|yaml|py|go|java|kt|sql|json|rake))(?::(\d+)(?:-(\d+))?)?`/g
const SKIP = new Set(['node_modules', '.git', 'scripts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

export function parseAnchors(doc: string, text: string): Anchor[] {
  const out: Anchor[] = []
  let heading = ''
  text.split('\n').forEach((line, i) => {
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) heading = h[1].trim()
    for (const m of line.matchAll(ANCHOR))
      out.push({ doc, heading, docLine: i + 1, file: m[1].replace(/^\.\//, ''), start: m[2] ? Number(m[2]) : null, end: m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : null })
  })
  return out
}

// Re-read only when a doc changed (cheap mtime check).
const cache = new Map<string, { stamp: string; anchors: Anchor[]; docs: string[] }>()
export function indexDocs(dir: string): { anchors: Anchor[]; docs: string[] } {
  if (!dir || !existsSync(dir)) return { anchors: [], docs: [] }
  const files = walk(dir)
  const stamp = files.map((f) => `${f}:${statSync(f).mtimeMs}`).join('|')
  const hit = cache.get(dir)
  if (hit && hit.stamp === stamp) return hit
  const docs = files.map((f) => relative(dir, f)).sort()
  const anchors = files.flatMap((f) => parseAnchors(relative(dir, f), readFileSync(f, 'utf8')))
  const v = { stamp, anchors, docs }
  cache.set(dir, v)
  return v
}

// Anchors on this file. Known limit: a doc folder covering several repos can match the same path in another repo.
export const anchorsFor = (anchors: Anchor[], file: string): Anchor[] => anchors.filter((a) => a.file === file)

// Docs a change touches: any anchor on a changed file. Grouped per doc, with the files involved.
export function touchedDocs(anchors: Anchor[], files: string[]): { doc: string; headings: string[]; files: string[] }[] {
  const changed = new Set(files)
  const by = new Map<string, { headings: Set<string>; files: Set<string> }>()
  for (const a of anchors) {
    if (!changed.has(a.file)) continue
    const e = by.get(a.doc) ?? { headings: new Set(), files: new Set() }
    if (a.heading) e.headings.add(a.heading)
    e.files.add(a.file)
    by.set(a.doc, e)
  }
  return [...by.entries()].map(([doc, e]) => ({ doc, headings: [...e.headings], files: [...e.files].sort() })).sort((x, y) => x.doc.localeCompare(y.doc))
}

// An anchor is stale when its line is past the end of the file. A missing file may belong to another repo.
export function anchorStatus(a: Anchor, root: string): 'ok' | 'stale' | 'elsewhere' {
  const p = join(root, a.file)
  if (!existsSync(p)) return 'elsewhere'
  if (a.end === null) return 'ok'
  return a.end <= readFileSync(p, 'utf8').split('\n').length ? 'ok' : 'stale'
}

export function readDoc(dir: string, rel: string): string {
  const p = resolve(dir, rel)
  if (!p.startsWith(resolve(dir) + '/') || !p.endsWith('.md')) throw new Error(`not a doc in the flow docs folder: ${rel}`)
  return readFileSync(p, 'utf8')
}

// The flow-docs folder for a workspace, found without asking (it is set once, then Settings wins):
// - "Claude Docs" inside the open folder or next to it;
// - else a folder directly inside it that is not a git repo, has a CLAUDE.md at its top, and whose docs carry anchors.
// At least MIN_ANCHORS, so a folder of plain notes is not taken for flow docs.
const MIN_ANCHORS = 10
export function findFlowDocs(folder: string): string | null {
  const isDocs = (d: string): boolean => existsSync(join(d, 'CLAUDE.md')) && !existsSync(join(d, '.git')) && indexDocs(d).anchors.length >= MIN_ANCHORS
  for (const d of [join(folder, 'Claude Docs'), join(dirname(folder), 'Claude Docs')]) if (existsSync(d) && isDocs(d)) return d
  if (!existsSync(folder)) return null
  const kids = readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => join(folder, e.name))
  return kids.find(isDocs) ?? null
}

// Docs by name or heading: every word must appear in one of them.
export function findDocs(dir: string, words: string[]): { doc: string; headings: string[] }[] {
  const ws = words.map((w) => w.toLowerCase()).filter(Boolean)
  if (!ws.length) return []
  const { docs, anchors } = indexDocs(dir)
  const headings = new Map<string, Set<string>>()
  for (const a of anchors) if (a.heading) (headings.get(a.doc) ?? headings.set(a.doc, new Set()).get(a.doc)!).add(a.heading)
  return docs.map((doc) => ({ doc, headings: [...(headings.get(doc) ?? [])] }))
    .filter((d) => ws.every((w) => d.doc.toLowerCase().includes(w) || d.headings.some((h) => h.toLowerCase().includes(w))))
}

// What every session gets at start when a flow-docs folder is set: what the docs are, and to use them first.
export function docsBrief(dir: string): string[] {
  const { docs } = indexDocs(dir)
  if (!docs.length) return []
  const shown = docs.slice(0, 80)
  return [
    `## Flow docs: ${basename(dir)} (${dir})`,
    'Hand-written docs of how the product works. Every claim cites a file:line, so they can be checked. Use them before the code:',
    '- Before you plan, design or change code, find the doc that covers it and read it in full:',
    '  signoff docs for <file>        docs anchored on that file',
    '  signoff docs find <words>      docs by name or heading',
    `  then: cat "${dir}/<doc>"`,
    '- Follow its Decisions and Do not sections, and cite the doc (path and heading) in your plan.',
    '- If no doc covers it, say so in one line and continue as you normally would.',
    '- After changing code: signoff docs touched lists docs anchored on your changed files. Check whether each is now wrong and say so; do not edit a doc just to have edited it.',
    `Docs (${docs.length}${docs.length > shown.length ? `, first ${shown.length}` : ''}):`,
    ...shown.map((d) => `  ${d}`)
  ]
}

// ---- checking and generating ------------------------------------------------------------------------------------
// The repos a docs folder describes: the folder it sits in, if that is a repo, else each repo directly inside it.
export function reposNear(docsDir: string): string[] {
  const parent = dirname(resolve(docsDir))
  if (existsSync(join(parent, '.git'))) return [parent]
  return readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(parent, e.name, '.git'))).map((e) => join(parent, e.name))
}

// Anchors that no longer hold: the file is gone, or the lines are past its end.
// - With docs-meta.json naming repos by path and prefixes (as Claude Docs does), each anchor is checked in the repo
//   whose prefix it starts with, at that path (often a baseline checkout), and anchors under no prefix are skipped
//   and counted, the same rules as anchors.py.
// - Otherwise (freshly generated docs) every anchor is checked against the repos next to the docs folder; it may start
//   with a repo folder ("web-app/src/x.ts").
export type Broken = { doc: string; docLine: number; anchor: string; problem: 'missing file' | 'line past the end' }
export type Verified = { checked: number; skipped: number; broken: Broken[] }
type MetaRepo = { path?: string; prefixes?: string[] }
const home = (p: string): string => (p.startsWith('~/') ? join(process.env.HOME ?? '', p.slice(2)) : p)

export function verifyDocs(dir: string, roots: string[] = reposNear(dir)): Verified {
  let meta: { repos?: Record<string, MetaRepo> } = {}
  try {
    meta = JSON.parse(readFileSync(join(dir, 'docs-meta.json'), 'utf8'))
  } catch {
    meta = {} // no docs-meta.json (or not JSON): check against the repos next to the folder
  }
  const scoped = Object.values(meta.repos ?? {}).filter((r): r is Required<MetaRepo> => !!r.path && !!r.prefixes?.length)
  const out: Verified = { checked: 0, skipped: 0, broken: [] }
  for (const a of indexDocs(dir).anchors) {
    let path: string | undefined
    if (scoped.length) {
      const repo = scoped.find((r) => r.prefixes.some((p) => a.file.startsWith(p)))
      if (!repo) { out.skipped++; continue }
      const root = home(repo.path)
      path = a.file.startsWith(basename(root) + '/') ? join(dirname(root), a.file) : join(root, a.file)
      if (!existsSync(path)) path = undefined
    } else {
      const [head, ...rest] = a.file.split('/')
      const prefixed = roots.find((r) => basename(r) === head && rest.length && existsSync(join(r, ...rest)))
      path = prefixed ? join(prefixed, ...rest) : roots.map((r) => join(r, a.file)).find((p) => existsSync(p) && statSync(p).isFile())
    }
    out.checked++
    const anchor = `${a.file}${a.start ? `:${a.start}${a.end && a.end !== a.start ? `-${a.end}` : ''}` : ''}`
    if (!path) out.broken.push({ doc: a.doc, docLine: a.docLine, anchor, problem: 'missing file' })
    else if (a.end !== null && a.end > readFileSync(path, 'utf8').split('\n').length) out.broken.push({ doc: a.doc, docLine: a.docLine, anchor, problem: 'line past the end' })
  }
  return out
}

// The first message of a "Generate flow docs" session. guide: the bundled house style (resources/flow-docs-guide.md).
export function generatePrompt(p: { folder: string; target: string; guide: string; repos: string[] }): string {
  return [
    `Write flow docs for the code in ${p.folder}, into ${p.target}.`,
    `Read the house style first and follow it exactly: ${p.guide}`,
    `Repos to cover: ${p.repos.length ? p.repos.map((r) => basename(r)).join(', ') : '(none found: say so and stop)'}.`,
    '',
    'Steps:',
    '1. Explore the repos (routes, services, jobs, models, frontend pages) and list the main business flows: a name, one line on what it covers, and the main entry points.',
    '2. Before writing anything, post that list as one decision so the user picks: signoff post --ticket DOCS --id D<n> --question "Write flow docs for these flows?" with one --context per flow ("<n>. <name>: <what it covers>"), options "All of them :: <rough size>" and "Only some :: answer with the numbers to write", and your recommendation. Wait for the answer (signoff wait).',
    `3. Write only the chosen flows: ${p.target}/<flow>/CLAUDE.md each, then ${p.target}/CLAUDE.md (an index) and ${p.target}/docs-meta.json with each repo's current commit (git rev-parse HEAD).`,
    '4. Run signoff docs verify and fix every anchor it reports.',
    '5. Finish with a short summary: the docs written, and the known gaps.',
    'Do not change any code in the repos. Write only inside the docs folder.'
  ].join('\n')
}
