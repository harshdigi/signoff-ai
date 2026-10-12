// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs'
import { isAbsolute, join, sep } from 'path'

// The code behind a decision's evidence ("app/models/link.rb:12-14 :: what it shows"), so the card shows the lines
// themselves. Paths are tried against the session's folder, then each folder directly inside it (a folder of repos).
// Nothing outside the session's folder is read.
export type Snippet = { file: string; from: number; to: number; lines: { n: number; text: string }[] }
const AROUND = 3
const MAX_LINES = 20
const MAX_BYTES = 2 * 1024 * 1024

export function evidenceSnippet(cwd: string, ref: string): Snippet | null {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(ref.split(' :: ')[0].trim())
  if (!m) return null
  const [, path, a, b] = m
  const root = realpathSync(cwd)
  const candidates = isAbsolute(path) ? [path] : [join(root, path), ...readdirSync(root).map((d) => join(root, d, path))]
  const file = candidates.find((f) => existsSync(f) && statSync(f).isFile() && statSync(f).size <= MAX_BYTES)
  if (!file) return null
  const real = realpathSync(file)
  if (real !== root && !real.startsWith(root + sep)) return null
  const text = readFileSync(real, 'utf8').split('\n')
  const start = Number(a)
  const end = Math.max(start, Number(b ?? a))
  const from = Math.max(1, start - AROUND)
  const to = Math.min(text.length, end + AROUND, from + MAX_LINES - 1)
  if (start > text.length) return null
  return { file: real, from: start, to: end, lines: text.slice(from - 1, to).map((t, i) => ({ n: from + i, text: t })) }
}
