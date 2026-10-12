// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs'
import { join, sep } from 'path'
import { createInterface } from 'readline'
import { tryGit } from './workspace'

// Code search (Search tab): file names and file contents in the git repos of the open folder.
// - Repos: the folder's own repo, else each repo directly inside it (a folder of repos).
// - git ls-files / git grep: skips .gitignore'd files, includes new files not committed yet.
// - Folders that are not repos are not searched.
export type FileHit = { root: string; path: string }
export type LineHit = { root: string; path: string; line: number; text: string }
export type CodeQuery = { q: string; regex?: boolean; caseSensitive?: boolean; word?: boolean; include?: string }
export type Found<T> = { hits: T[]; truncated: boolean }

const MAX_FILES = 200
const MAX_LINES = 500
const MAX_TEXT = 300 // characters kept per matching line
const MAX_READ = 2 * 1024 * 1024

export async function reposIn(folder: string): Promise<string[]> {
  const top = await tryGit(folder, ['rev-parse', '--show-toplevel'])
  if (top) return [top]
  return readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(folder, d.name, '.git')))
    .map((d) => join(folder, d.name))
}

// "*.rb, app/" -> git pathspecs. Empty means the whole repo.
const pathspecs = (include?: string): string[] => (include ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// Lines a git command prints, stopping it once `max` are read. Exit code 1 (no match) is not an error.
function gitLines(root: string, args: string[], max: number): Promise<{ lines: string[]; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { cwd: root })
    const lines: string[] = []
    let truncated = false
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    createInterface({ input: p.stdout }).on('line', (l) => {
      if (lines.length < max) lines.push(l)
      else if (!truncated) { truncated = true; p.kill() }
    })
    p.on('error', reject)
    p.on('close', (code) => (truncated || code === 0 || code === 1 ? resolve({ lines, truncated }) : reject(new Error(`git ${args[0]} in ${root}: ${err.trim() || `exit ${code}`}`))))
  })
}

// File names: every word must appear in the path; matches in the file name rank first.
export async function findFiles(folder: string, q: string, include?: string): Promise<Found<FileHit>> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return { hits: [], truncated: false }
  const roots = await reposIn(folder)
  const all = await Promise.all(roots.map(async (root) => {
    const { lines } = await gitLines(root, ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...pathspecs(include)], 200_000)
    return lines.filter((p) => words.every((w) => p.toLowerCase().includes(w))).map((path) => ({ root, path }))
  }))
  const name = (p: string): string => p.slice(p.lastIndexOf('/') + 1).toLowerCase()
  const hits = all.flat().sort((a, b) => Number(!words.some((w) => name(a.path).includes(w))) - Number(!words.some((w) => name(b.path).includes(w))) || a.path.length - b.path.length)
  return { hits: hits.slice(0, MAX_FILES), truncated: hits.length > MAX_FILES }
}

// Lines in files (git grep): fixed text unless regex; case-insensitive unless asked.
// - Regex is Perl-style (-P), so \w, \d and lookaheads work as in most editors.
export async function grep(folder: string, o: CodeQuery): Promise<Found<LineHit>> {
  if (!o.q) return { hits: [], truncated: false }
  const roots = await reposIn(folder)
  const args = ['grep', '-n', '-I', '--untracked', '--no-color', o.regex ? '-P' : '-F', ...(o.caseSensitive ? [] : ['-i']), ...(o.word ? ['-w'] : []), '-e', o.q, '--', ...pathspecs(o.include)]
  const per = await Promise.all(roots.map(async (root) => {
    const { lines, truncated } = await gitLines(root, args, MAX_LINES)
    const hits = lines.map((l): LineHit | null => {
      const m = /^(.*?):(\d+):(.*)$/.exec(l)
      return m ? { root, path: m[1], line: Number(m[2]), text: m[3].slice(0, MAX_TEXT) } : null
    }).filter((h): h is LineHit => !!h)
    return { hits, truncated }
  }))
  const hits = per.flatMap((p) => p.hits)
  return { hits: hits.slice(0, MAX_LINES), truncated: hits.length > MAX_LINES || per.some((p) => p.truncated) }
}

// Roots a file may be read from: the open folder's repos, plus their worktrees inside the folder (team and subtask
// sessions work in <repo>/.claude/worktrees/...).
export async function allowedRoots(folder: string): Promise<string[]> {
  const repos = await reposIn(folder)
  const trees = await Promise.all(repos.map(async (r) => ((await tryGit(r, ['worktree', 'list', '--porcelain'])) ?? '')
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).filter((p) => p.startsWith(folder + sep))))
  return [...new Set([...repos, ...trees.flat()])]
}

// A file to view: only inside one of those roots, text, and not too large.
export async function readCode(folder: string, root: string, path: string): Promise<string> {
  if (!(await allowedRoots(folder)).includes(root)) throw new Error(`not a repo of the open folder: ${root}`)
  const real = realpathSync(join(root, path))
  if (!real.startsWith(realpathSync(root) + sep)) throw new Error(`outside the repo: ${path}`)
  if (statSync(real).size > MAX_READ) throw new Error(`${path} is larger than 2 MB; open it in your editor`)
  const text = readFileSync(real, 'utf8')
  if (text.includes('\u0000')) throw new Error(`${path} is a binary file`)
  return text
}

// ---- code references (chat, decisions, reviews) -----------------------------------------------------------------
// `app/x.rb:12`, `Foo::Bar#baz`, `DEFAULT_REGION`, `fetch_customer!`, `invoice_matrix_spec`: where it is.
// - Looked for in `roots` in order (the session's own repo or worktree first), so the same name in another repo loses.
// - Definitions are found by pattern (Ruby and TypeScript): def / class / module / CONST = / function / const.
//   Not a parser: a name defined twice may point at either; the owner (Foo in Foo#bar) breaks ties by file path.
export type CodeRef = { root: string; path: string; line: number }

const PATH = /^([\w./-]+\.[A-Za-z]{1,6})(?::(\d+)(?:-\d+)?)?$/
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const snake = (s: string): string => s.replace(/::/g, '/').replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase()

// prefer: path parts that pick between several hits, most specific first ("billing/order_processor", then "order_processor").
async function grepFirst(roots: string[], pattern: string, prefer: string[]): Promise<CodeRef | null> {
  for (const root of roots) {
    const { lines } = await gitLines(root, ['grep', '-n', '-I', '--untracked', '--no-color', '-P', '-e', pattern], 50)
    const hits = lines.map((l) => /^(.*?):(\d+):/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ root, path: m[1], line: Number(m[2]) }))
    if (!hits.length) continue
    const owned = prefer.map((p) => hits.find((h) => h.path.includes(p))).find(Boolean)
    const best = owned || hits.find((h) => !/(^|\/)(spec|test|__tests__)\//.test(h.path)) || hits[0]
    return best
  }
  return null
}

export async function resolveRef(roots: string[], ref: string): Promise<CodeRef | null> {
  const r = ref.trim().replace(/^`|`$/g, '')
  const p = PATH.exec(r)
  if (p) {
    const line = p[2] ? Number(p[2]) : 1
    for (const root of roots) if (existsSync(join(root, p[1])) && statSync(join(root, p[1])).isFile()) return { root, path: p[1], line }
    // A path given from a subfolder, or only its tail: the shortest tracked path that ends with it.
    for (const root of roots) {
      const { lines } = await gitLines(root, ['ls-files', '--cached', '--others', '--exclude-standard'], 200_000)
      const hit = lines.filter((f) => f === p[1] || f.endsWith('/' + p[1])).sort((a, b) => a.length - b.length)[0]
      if (hit) return { root, path: hit, line }
    }
    return null
  }
  // A file named without its extension: some_matrix_spec -> spec/.../some_matrix_spec.rb
  if (/^[a-z0-9_]+_(spec|test)$/.test(r)) {
    for (const root of roots) {
      const { lines } = await gitLines(root, ['ls-files', '--cached', '--others', '--exclude-standard'], 200_000)
      const hit = lines.find((f) => f.slice(f.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '') === r)
      if (hit) return { root, path: hit, line: 1 }
    }
    return null
  }
  const parts = r.split(/::|#|\./).filter(Boolean)
  const name = parts[parts.length - 1]
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*[?!]?$/.test(name)) return null
  // Foo::Bar#baz is defined in .../foo/bar.rb; try the whole namespace path, then the last part.
  const full = parts.length > 1 ? snake(parts.slice(0, -1).join('::')) : null
  const owner = full ? [...new Set([full, full.split('/').pop()!])] : []
  const n = esc(name)
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return grepFirst(roots, `^\\s*(?:export\\s+)?(?:const\\s+)?${n}\\s*=`, owner)
  if (/^[A-Z]/.test(name)) return grepFirst(roots, `^\\s*(?:export\\s+)?(?:(?:class|module|interface|type|enum)\\s+(?:[A-Z]\\w*::)*${n}\\b|function\\s+${n}\\b)`, [snake(name)])
  return grepFirst(roots, `^\\s*(?:def\\s+(?:self\\.)?${n}(?![\\w?!])|(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\b|(?:export\\s+)?const\\s+${n}\\s*=)`, owner)
}
