// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { detectFramework, listSpecs, relatedSpecs } from './testing'
import type { Change, ChangeSet } from './workspace'
import type { Anchor } from './flows'

// Impact of a changed file (IDE/D16 F): facts found without spending tokens.
// - which definitions changed, and who references them (git grep);
// - how the code is reached (routes, controllers, jobs, webhooks, migrations);
// - which specs cover it; simple risk flags. Flow docs join in with feature G.

export type Ref = { file: string; line: number; text: string; kind: string }
export type Impact = {
  path: string; symbols: { name: string; removed: boolean; refs: Ref[] }[]
  entryPoints: { file: string; kind: string }[]; specs: string[]; risks: string[]
  flows: { doc: string; line: number; heading: string; anchor: string; touched: boolean }[]
}

const run = promisify(execFile)
const MAX_SYMBOLS = 8
const MAX_REFS = 40

const DEF: [RegExp, number][] = [
  [/^\s*def\s+(?:self\.)?([A-Za-z_][\w?!=]*)/, 1],
  [/^\s*(?:class|module)\s+([A-Z][\w:]*)/, 1],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 1],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 1],
  [/^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 1],
  [/^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\{\s*$/, 1]
]
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'initialize', 'constructor', 'new'])

export const defName = (line: string): string | null => {
  for (const [re, g] of DEF) {
    const m = re.exec(line)
    if (m && !NOT_NAMES.has(m[g])) return m[g]
  }
  return null
}

// Changed lines of the new file, and definitions added and removed, from a zero-context diff.
export function readHunks(diff: string): { changedNew: number[]; added: Set<string>; removed: Set<string> } {
  const changedNew: number[] = []
  const added = new Set<string>()
  const removed = new Set<string>()
  let line = 0
  for (const l of diff.split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l)
    if (h) {
      line = Number(h[1])
      if (h[2] === '0') changedNew.push(line) // pure deletion: mark the spot
      continue
    }
    if (l.startsWith('+++') || l.startsWith('---')) continue
    if (l.startsWith('+')) {
      changedNew.push(line++)
      const n = defName(l.slice(1))
      if (n) added.add(n)
    } else if (l.startsWith('-')) {
      const n = defName(l.slice(1))
      if (n) removed.add(n)
    }
  }
  return { changedNew, added, removed }
}

// The definitions a changed line sits in: the nearest def above it, and the nearest class/module.
export function enclosing(lines: string[], at: number): string[] {
  const out: string[] = []
  let sawDef = false
  for (let i = Math.min(at, lines.length) - 1; i >= 0 && out.length < 2; i--) {
    const n = defName(lines[i])
    if (!n) continue
    const isType = /^\s*(?:export\s+)?(?:class|module|interface|type|enum)\b/.test(lines[i])
    if (isType) out.push(n)
    else if (!sawDef) {
      out.push(n)
      sawDef = true
    }
    if (isType) break
  }
  return out
}

// Rails autoloading: app/models/foo_bar.rb defines FooBar.
export function railsConstant(path: string): string | null {
  const m = /^app\/[^/]+\/(.+)\.rb$/.exec(path)
  if (!m) return null
  return m[1].split('/').map((seg) => seg.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')).join('::')
}

export function kindOf(file: string): string {
  if (/(^|\/)config\/routes(\.rb|\/)/.test(file)) return 'route'
  if (/webhook/i.test(file)) return 'webhook'
  if (/^app\/controllers\//.test(file) || /(^|\/)(pages|app)\/api\//.test(file)) return 'HTTP endpoint'
  if (/^app\/(jobs|workers|sidekiq)\//.test(file)) return 'background job'
  if (/^db\/migrate\//.test(file)) return 'migration'
  if (/^lib\/tasks\/.+\.rake$/.test(file)) return 'rake task'
  if (/^app\/(views|components)\//.test(file) || /\.(tsx|jsx|vue|erb)$/.test(file)) return 'UI'
  return 'code'
}

const isSpec = (f: string): boolean => /(^spec\/.*_spec\.rb$)|(\.(test|spec)\.[cm]?[jt]sx?$)/.test(f)

async function grep(root: string, word: string): Promise<Ref[]> {
  try {
    const { stdout } = await run('git', ['grep', '-n', '-w', '-F', '-I', '--untracked', word], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    return stdout.split('\n').filter(Boolean).slice(0, 400).map((l) => {
      const m = /^([^:]+):(\d+):(.*)$/.exec(l)!
      return { file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160), kind: kindOf(m[1]) }
    })
  } catch {
    return [] // git grep exits 1 when nothing matches
  }
}

export async function impact(set: ChangeSet, change: Change, anchors: Anchor[] = []): Promise<Impact> {
  const { root, ref } = set
  const path = change.path
  const disk = join(root, path)
  const lines = existsSync(disk) ? readFileSync(disk, 'utf8').split('\n') : []
  let diff = ''
  if (change.status === 'untracked') diff = lines.map((l) => '+' + l).join('\n').replace(/^/, `@@ -0,0 +1,${lines.length} @@\n`)
  else diff = (await run('git', ['diff', '-U0', ref, '--', path], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout
  const h = readHunks(diff)
  const names = new Set<string>([...h.added, ...h.removed])
  for (const at of h.changedNew) for (const n of enclosing(lines, at)) names.add(n)
  const constant = railsConstant(path)
  if (constant) names.add(constant.split('::').pop()!)
  const removedNames = [...h.removed].filter((n) => !h.added.has(n))
  const picked = [...names].filter((n) => n.length > 2).slice(0, MAX_SYMBOLS)

  const symbols = await Promise.all(picked.map(async (name) => {
    const refs = (await grep(root, name)).filter((r) => r.file !== path)
    return { name, removed: removedNames.includes(name), refs: refs.slice(0, MAX_REFS) }
  }))
  const refFiles = [...new Set(symbols.flatMap((s) => s.refs.map((r) => r.file)))]
  const entryPoints = refFiles.filter((f) => kindOf(f) !== 'code' && !isSpec(f)).map((f) => ({ file: f, kind: kindOf(f) }))
  if (kindOf(path) !== 'code') entryPoints.unshift({ file: path, kind: kindOf(path) + ' (this file)' })
  const fw = detectFramework(root)
  const specs = [...new Set([...(fw ? relatedSpecs(fw, [path], await listSpecs(root, fw)) : []), ...refFiles.filter(isSpec)])].sort()

  const risks: string[] = []
  for (const s of symbols) if (s.removed && s.refs.some((r) => !isSpec(r.file))) risks.push(`${s.name} was removed or renamed, but ${s.refs.filter((r) => !isSpec(r.file)).length} place(s) still reference it.`)
  if (kindOf(path) === 'migration') risks.push('Schema change: check existing rows (backfill, defaults, NOT NULL) and that it can roll back.')
  if (kindOf(path) === 'route') risks.push('Routes changed: existing clients may call the old paths.')
  if (/^\s*[+-].*\b(validates?|validate_|errors\.add)\b/m.test(diff)) risks.push('Validation changed: inputs that passed before may now fail, or the reverse.')
  if (/^\s*[+-].*\b(raise|rescue|status:\s*:?\d{3}|render\s+json:.*status)\b/m.test(diff)) risks.push('Error handling or response status changed: callers may depend on the old behaviour.')
  if (entryPoints.some((e) => e.kind === 'background job')) risks.push('Reached from background jobs: jobs already queued run the new code with old arguments.')
  if (entryPoints.some((e) => e.kind === 'webhook')) risks.push('Reached from webhooks: external senders cannot change their payloads.')
  if (!specs.length) risks.push('No spec found for this file by name or reference.')
  // Flow docs on this file; touched = the anchor's line range includes a changed line.
  const flows = anchors.map((a) => ({
    doc: a.doc, line: a.docLine, heading: a.heading, anchor: `${a.file}${a.start ? ':' + a.start + (a.end && a.end !== a.start ? '-' + a.end : '') : ''}`,
    touched: a.start === null || h.changedNew.some((l) => l >= a.start! && l <= (a.end ?? a.start!))
  }))
  if (flows.some((f) => f.touched)) risks.push(`Documented flow changed: ${[...new Set(flows.filter((f) => f.touched).map((f) => f.doc))].join(', ')}. Check the doc still holds, and update it.`)
  return { path, symbols, entryPoints, specs, risks, flows }
}
