// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

// Skills from nearby folders: the folders Claude Code would not load at start, passed as --add-dir.
// Per the Claude Code docs (skills: "monorepos and subdirectories", "additional directories"):
// - it loads .claude/skills from the start folder and its parents only up to the repo root;
// - skills in child folders load only once Claude touches a file there;
// - --add-dir loads a folder's .claude skills, commands and agents at start (and also grants file access there).

export type SkillDirs = { dirs: string[]; skipped: { dir: string; sameAs: string }[] }

const MAX_DEPTH = 3
const MAX_DIRS = 20
const SKIP = new Set(['node_modules', 'vendor', 'tmp', 'dist', 'build', 'out', 'coverage'])
const KINDS = ['skills', 'commands', 'agents']

const hasClaude = (dir: string): boolean => KINDS.some((k) => existsSync(join(dir, '.claude', k)))

// What a folder provides, for spotting copies of the same repo: its skill, command and agent names.
function provides(dir: string): Set<string> {
  return new Set(KINDS.flatMap((k) => {
    const p = join(dir, '.claude', k)
    return existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith('.')).map((n) => `${k}/${n}`) : []
  }))
}
const within = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x))

function repoRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null // not inside a git repo
  }
}

function children(dir: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || out.length >= MAX_DIRS) return
  let entries: string[] = []
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => e.name)
  } catch {
    return // unreadable folder: skip it
  }
  for (const name of entries.sort()) {
    const p = join(dir, name)
    if (hasClaude(p)) out.push(p)
    children(p, depth + 1, out)
  }
}

export function skillDirs(cwd: string, home = homedir()): SkillDirs {
  const start = resolve(cwd)
  const found: string[] = []
  // Parents above what Claude Code loads by itself (above the repo root, or above the start folder outside git), up to home.
  const top = repoRoot(start) ?? start
  for (let p = dirname(top); p !== dirname(p) && p.startsWith(resolve(home) + '/'); p = dirname(p)) if (hasClaude(p)) found.push(p)
  children(start, 1, found)
  // A folder whose items are all provided by another (the start folder, or a bigger folder) is a copy: skip it.
  // Bigger folders go first, so the most complete copy of a repo is the one kept.
  const own = provides(start)
  const sets = new Map(found.map((d) => [d, provides(d)]))
  const order = [...found].sort((x, y) => sets.get(y)!.size - sets.get(x)!.size || found.indexOf(x) - found.indexOf(y))
  const kept: string[] = []
  const skipped: { dir: string; sameAs: string }[] = []
  for (const d of order) {
    const set = sets.get(d)!
    const sameAs = own.size && within(set, own) ? start : kept.find((k) => within(set, sets.get(k)!))
    if (sameAs) skipped.push({ dir: d, sameAs })
    else if (kept.length < MAX_DIRS) kept.push(d)
  }
  // Report in folder order, as found.
  const dirs = found.filter((d) => kept.includes(d))
  skipped.sort((x, y) => found.indexOf(x.dir) - found.indexOf(y.dir))
  return { dirs, skipped }
}
