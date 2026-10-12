// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// New skills made in the app are ordinary Claude Code skills (<dir>/.claude/skills/<name>/SKILL.md),
// so they work in every Claude session, inside the app or not.
export type NewSkill = { name: string; description: string; body: string; scope: 'user' | 'project'; folder?: string | null }

// YAML double-quoted string: safe for any description (colons, quotes, #).
const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`

export function skillFile(s: NewSkill): string {
  return `---\nname: ${s.name}\ndescription: ${quote(s.description.trim())}\nuser-invocable: true\n---\n\n${s.body.trim()}\n`
}

export function createSkill(s: NewSkill, home = homedir()): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.name)) throw new Error('name: lower-case letters, digits and dashes, like start-my-day')
  if (!s.description.trim()) throw new Error('say when Claude should use it (the description)')
  if (!s.body.trim()) throw new Error('write what the skill should do')
  if (s.scope === 'project' && !s.folder) throw new Error('open a folder to save a skill in it')
  const base = s.scope === 'user' ? join(home, '.claude') : join(s.folder!, '.claude')
  const dir = join(base, 'skills', s.name)
  if (existsSync(join(dir, 'SKILL.md'))) throw new Error(`a skill called ${s.name} already exists there`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  writeFileSync(file, skillFile(s))
  return file
}
