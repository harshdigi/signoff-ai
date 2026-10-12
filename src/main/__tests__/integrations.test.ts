// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { addArgs, CATALOG, configured, mask, specFor } from '../integrations'

const entry = (id: string): (typeof CATALOG)[number] => CATALOG.find((c) => c.id === id)!

describe('integrations', () => {
  it('builds the same commands as the Claude Code docs', () => {
    expect(addArgs(specFor(entry('notion'), 'user', {}))).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'notion', 'https://mcp.notion.com/mcp'])
    expect(addArgs(specFor(entry('asana'), 'local', {}))).toEqual(['mcp', 'add', '--scope', 'local', '--transport', 'sse', 'asana', 'https://mcp.asana.com/sse'])
    expect(addArgs(specFor(entry('github'), 'user', { token: 'ghp_x' }))).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', '--header', 'Authorization: Bearer ghp_x', 'github', 'https://api.githubcopilot.com/mcp/'])
    expect(addArgs(specFor(entry('airtable'), 'user', { key: 'k1' }))).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'stdio', '--env', 'AIRTABLE_API_KEY=k1', 'airtable', '--', 'npx', '-y', 'airtable-mcp-server'])
    expect(addArgs(specFor(entry('postgres'), 'local', { dsn: 'postgresql://ro:pw@h:5432/db' }))).toEqual(['mcp', 'add', '--scope', 'local', '--transport', 'stdio', 'postgres', '--', 'npx', '-y', '@bytebase/dbhub', '--dsn', 'postgresql://ro:pw@h:5432/db'])
  })

  it('refuses bad input before anything runs', () => {
    expect(() => specFor(entry('github'), 'user', {})).toThrow('GitHub personal access token is required')
    expect(() => addArgs({ name: 'a b', scope: 'user', transport: 'http', url: 'https://x' })).toThrow('name: letters, digits, - and _ only')
    expect(() => addArgs({ name: 'a', scope: 'everyone' as never, transport: 'http', url: 'https://x' })).toThrow('scope is one of local, project, user')
    expect(() => addArgs({ name: 'a', scope: 'user', transport: 'http', url: 'http://evil.example' })).toThrow('the URL must be https:// (or http://localhost)')
    expect(addArgs({ name: 'a', scope: 'user', transport: 'http', url: 'http://localhost:3845/mcp' }).at(-1)).toBe('http://localhost:3845/mcp')
    expect(() => addArgs({ name: 'a', scope: 'user', transport: 'stdio', command: [] })).toThrow('a stdio server needs a command')
    expect(() => addArgs({ name: 'a', scope: 'user', transport: 'http', url: 'https://x', headers: ['nonsense'] })).toThrow('headers look like "Name: value"')
    expect(() => addArgs({ name: 'a', scope: 'user', transport: 'stdio', command: ['x'], env: ['1BAD=v'] })).toThrow('env must be NAME=value: 1BAD')
  })

  it('masks anything that can hold a secret', () => {
    expect(mask({ type: 'http', url: 'https://user:pw@api.example.com/mcp?token=abc' })).toBe('https://api.example.com/mcp?…')
    expect(mask({ command: 'npx', args: ['-y', '@bytebase/dbhub', '--dsn', 'postgresql://ro:pw@h/db'] })).toBe('npx @bytebase/dbhub …')
    expect(mask({ command: 'node', args: ['server.js'] })).toBe('node server.js')
  })

  it('lists servers from all three scopes, without their secrets', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const folder = mkdtempSync(join(tmpdir(), 'proj-'))
    writeFileSync(join(home, '.claude.json'), JSON.stringify({
      mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_secret' } } },
      projects: { [folder]: { mcpServers: { db: { command: 'npx', args: ['-y', '@bytebase/dbhub', '--dsn', 'postgresql://ro:pw@h/db'], env: { PW: 'x' } } } } }
    }))
    mkdirSync(join(folder, 'sub'))
    writeFileSync(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { type: 'http', url: 'https://example.com/mcp' } } }))
    const rows = configured(folder, home)
    expect(rows).toEqual([
      { name: 'db', scope: 'local', transport: 'stdio', target: 'npx @bytebase/dbhub …' },
      { name: 'shared', scope: 'project', transport: 'http', target: 'https://example.com/mcp' },
      { name: 'github', scope: 'user', transport: 'http', target: 'https://api.githubcopilot.com/mcp/' }
    ])
    expect(JSON.stringify(rows)).not.toMatch(/ghp_secret|pw@|PW/)
    expect(configured(null, mkdtempSync(join(tmpdir(), 'empty-')))).toEqual([])
  })
})
