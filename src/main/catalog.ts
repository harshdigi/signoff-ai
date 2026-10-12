// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'

// Skills, agents and commands the user already has (IDE/D14), read from the same places Claude Code reads them.
// The app only lists them; running one sends its slash command (or an agent request) to the chat.

export type CatalogItem = {
  kind: 'skill' | 'agent' | 'command'
  name: string; description: string
  source: 'user' | 'project' | string   // string = plugin name
  invoke: string                        // what goes into the chat input
  role?: 'start-ticket' | 'review' | 'create-pr' | 'docs' | 'describe-ticket'
}

// Frontmatter: simple `key: value` lines, plus block scalars (| or >) for long descriptions.
export function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim())
      v = block.join(v.startsWith('|') ? '\n' : ' ')
    }
    // Quoted values: drop the quotes; in double quotes, \" and \\ are escapes (YAML).
    const dq = /^"(.*)"$/.exec(v)
    out[kv[1]] = dq ? dq[1].replace(/\\(["\\])/g, '$1') : v.replace(/^'(.*)'$/, '$1')
  }
  return out
}

const ROLES: [RegExp, CatalogItem['role']][] = [
  [/^start-ticket$/, 'start-ticket'], [/^create-pr$/, 'create-pr'], [/^update-product-docs$/, 'docs'],
  [/^describe-ticket$/, 'describe-ticket'], [/review/, 'review']
]
const roleOf = (name: string): CatalogItem['role'] => ROLES.find(([re]) => re.test(name))?.[1]

const list = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : [])

function scan(dir: string, source: string, prefix: string): CatalogItem[] {
  const items: CatalogItem[] = []
  for (const d of list(join(dir, 'skills'))) {
    const f = join(dir, 'skills', d, 'SKILL.md')
    if (!existsSync(f)) continue
    const fm = frontmatter(readFileSync(f, 'utf8'))
    const name = fm.name || d
    items.push({ kind: 'skill', name: prefix + name, description: fm.description || '', source, invoke: `/${prefix}${name}`, role: roleOf(name) })
  }
  for (const f of list(join(dir, 'commands')).filter((x) => x.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(dir, 'commands', f), 'utf8'))
    const name = basename(f, '.md')
    items.push({ kind: 'command', name: prefix + name, description: fm.description || '', source, invoke: `/${prefix}${name}`, role: roleOf(name) })
  }
  for (const f of list(join(dir, 'agents')).filter((x) => x.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(dir, 'agents', f), 'utf8'))
    const name = fm.name || basename(f, '.md')
    items.push({ kind: 'agent', name: prefix + name, description: fm.description || '', source, invoke: `Use the ${prefix}${name} agent to `, role: roleOf(name) })
  }
  return items
}

type Installed = { plugins?: Record<string, { installPath: string }[]> }

// extra: nearby folders loaded with --add-dir (skilldirs.ts); their items are labelled with the folder name.
export function readCatalog(project: string | null, home = homedir(), extra: string[] = []): CatalogItem[] {
  const claude = join(home, '.claude')
  const items = [...extra.flatMap((d) => scan(join(d, '.claude'), basename(d), '')), ...scan(claude, 'user', ''), ...(project ? scan(join(project, '.claude'), 'project', '') : [])]
  // Enabled plugins only, from the user's settings.
  let enabled: Record<string, boolean> = {}
  try {
    enabled = JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).enabledPlugins ?? {}
  } catch {
    enabled = {} // no readable settings: no plugins listed
  }
  try {
    const installed = JSON.parse(readFileSync(join(claude, 'plugins/installed_plugins.json'), 'utf8')) as Installed
    for (const [key, installs] of Object.entries(installed.plugins ?? {})) {
      if (!enabled[key] || !installs[0]) continue
      const plugin = key.split('@')[0]
      items.push(...scan(installs[0].installPath, plugin, `${plugin}:`))
    }
  } catch {
    // no plugins installed
  }
  // A project item shadows a user item with the same name, as in Claude Code.
  const seen = new Map<string, CatalogItem>()
  for (const i of items) seen.set(`${i.kind}:${i.name}`, i)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
