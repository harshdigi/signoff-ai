// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Integrations (connect Slack, GitHub, Notion, your own MCP servers) without editing config files.
// - Everything goes through Claude Code's own commands (`claude mcp add|login|remove`), run in a visible terminal.
// - Commands and URLs below are copied from code.claude.com/docs/en/mcp; nothing is guessed.
// - The window never receives secrets: configured servers are listed with credentials masked.

// header/env: template with {value}. arg: the flag, followed by the value as its own argument (as in the docs).
export type Field = { key: string; label: string; kind: 'header' | 'env' | 'arg'; template: string; secret?: boolean }
export type CatalogEntry = {
  id: string; name: string; description: string
  transport: 'http' | 'sse' | 'stdio'; url?: string; command?: string[]
  fields: Field[]; oauth: boolean
}
export type Connector = { id: string; name: string }

export const CONNECTORS_URL = 'https://claude.ai/customize/connectors'
// claude.ai connectors named in the docs. They appear in Claude Code by themselves once enabled on claude.ai.
export const CONNECTORS: Connector[] = [
  { id: 'slack', name: 'Slack' }, { id: 'gmail', name: 'Gmail' }, { id: 'gcal', name: 'Google Calendar' }, { id: 'm365', name: 'Microsoft 365' }
]

export const CATALOG: CatalogEntry[] = [
  { id: 'notion', name: 'Notion', description: 'Pages and databases', transport: 'http', url: 'https://mcp.notion.com/mcp', fields: [], oauth: true },
  { id: 'asana', name: 'Asana', description: 'Tasks and projects', transport: 'sse', url: 'https://mcp.asana.com/sse', fields: [], oauth: true },
  { id: 'sentry', name: 'Sentry', description: 'Errors and issues', transport: 'http', url: 'https://mcp.sentry.dev/mcp', fields: [], oauth: true },
  { id: 'stripe', name: 'Stripe', description: 'Payments data', transport: 'http', url: 'https://mcp.stripe.com', fields: [], oauth: true },
  {
    id: 'github', name: 'GitHub', description: 'Repos, issues, pull requests', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', oauth: false,
    fields: [{ key: 'token', label: 'GitHub personal access token', kind: 'header', template: 'Authorization: Bearer {value}', secret: true }]
  },
  {
    id: 'airtable', name: 'Airtable', description: 'Bases and records', transport: 'stdio', command: ['npx', '-y', 'airtable-mcp-server'], oauth: false,
    fields: [{ key: 'key', label: 'Airtable API key', kind: 'env', template: 'AIRTABLE_API_KEY={value}', secret: true }]
  },
  {
    id: 'postgres', name: 'PostgreSQL', description: 'Query a database (use a read-only user)', transport: 'stdio', command: ['npx', '-y', '@bytebase/dbhub'], oauth: false,
    fields: [{ key: 'dsn', label: 'Connection string (postgresql://user:pass@host:5432/db)', kind: 'arg', template: '--dsn', secret: true }]
  }
]

export const SCOPES = ['local', 'project', 'user'] as const
export type Scope = (typeof SCOPES)[number]
export type AddSpec = {
  name: string; scope: Scope; transport: 'http' | 'sse' | 'stdio'
  url?: string; command?: string[]; headers?: string[]; env?: string[]
}

const NAME = /^[A-Za-z0-9_-]{1,64}$/

// argv for `claude mcp add` (never a shell string, so values need no quoting).
export function addArgs(s: AddSpec): string[] {
  if (!NAME.test(s.name)) throw new Error('name: letters, digits, - and _ only')
  if (!SCOPES.includes(s.scope)) throw new Error(`scope is one of ${SCOPES.join(', ')}`)
  const opts = ['--scope', s.scope, '--transport', s.transport]
  for (const e of s.env ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(e)) throw new Error(`env must be NAME=value: ${e.split('=')[0]}`)
    opts.push('--env', e)
  }
  if (s.transport === 'stdio') {
    if (!s.command?.length || !s.command[0].trim()) throw new Error('a stdio server needs a command')
    if (s.headers?.length) throw new Error('headers are for http and sse servers')
    return ['mcp', 'add', ...opts, s.name, '--', ...s.command]
  }
  if (!s.url || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(s.url)) throw new Error('the URL must be https:// (or http://localhost)')
  for (const h of s.headers ?? []) {
    if (!/^[A-Za-z0-9-]+:\s*\S/.test(h)) throw new Error('headers look like "Name: value"')
    opts.push('--header', h)
  }
  return ['mcp', 'add', ...opts, s.name, s.url]
}

// A catalog entry plus the user's values -> an add spec.
export function specFor(entry: CatalogEntry, scope: Scope, values: Record<string, string>, name = entry.id): AddSpec {
  const value = (f: Field): string => {
    const v = (values[f.key] ?? '').trim()
    if (!v) throw new Error(`${f.label} is required`)
    return v
  }
  const fill = (f: Field): string => f.template.replace('{value}', value(f))
  return {
    name, scope, transport: entry.transport, url: entry.url,
    command: entry.command ? [...entry.command, ...entry.fields.filter((f) => f.kind === 'arg').flatMap((f) => [f.template, value(f)])] : undefined,
    headers: entry.fields.filter((f) => f.kind === 'header').map(fill),
    env: entry.fields.filter((f) => f.kind === 'env').map(fill)
  }
}

// ---- what is configured --------------------------------------------------------------
// Read from Claude Code's own files (docs: local + user in ~/.claude.json, project in .mcp.json).

export type Configured = { name: string; scope: Scope; transport: string; target: string }
type Raw = Record<string, { type?: string; url?: string; command?: string; args?: string[] }>

// Mask anything that can hold a secret: URL credentials and query strings, and command arguments after the program.
export function mask(cfg: { type?: string; url?: string; command?: string; args?: string[] }): string {
  if (cfg.url) {
    try {
      const u = new URL(cfg.url)
      return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?…' : ''}`
    } catch {
      return '(unreadable URL)'
    }
  }
  const pkg = (cfg.args ?? []).find((a) => !a.startsWith('-'))
  return [cfg.command ?? '?', pkg].filter(Boolean).join(' ') + ((cfg.args?.length ?? 0) > (pkg ? 1 : 0) ? ' …' : '')
}

const readJson = (p: string): Record<string, unknown> => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
  } catch {
    return {} // unreadable file: nothing listed from it
  }
}

export function configured(folder: string | null, home = homedir()): Configured[] {
  const user = readJson(join(home, '.claude.json')) as { mcpServers?: Raw; projects?: Record<string, { mcpServers?: Raw }> }
  const project = folder ? (readJson(join(folder, '.mcp.json')) as { mcpServers?: Raw }) : {}
  const rows = (servers: Raw | undefined, scope: Scope): Configured[] =>
    Object.entries(servers ?? {}).map(([name, c]) => ({ name, scope, transport: c.type ?? (c.url ? 'http' : 'stdio'), target: mask(c) }))
  return [
    ...rows(folder ? user.projects?.[folder]?.mcpServers : undefined, 'local'),
    ...rows(project.mcpServers, 'project'),
    ...rows(user.mcpServers, 'user')
  ]
}
