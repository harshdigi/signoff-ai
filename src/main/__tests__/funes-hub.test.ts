// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FunesHub, funesEntry, shimScript, writeShim } from '../funes-hub'

// SIGNOFF-42-IDLE/D9: one funes for many sessions. A fake stdio MCP server stands in for funes: it logs each start,
// answers initialize, echoes tools/call after params.ms, and exits on tools/call with name "crash".
const FAKE = `
const fs = require('fs')
fs.appendFileSync(process.env.FAKE_LOG, 'start\\n')
let buf = ''
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
    fs.appendFileSync(process.env.FAKE_LOG, (m.method || 'answer') + '\\n')
    if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake' } } })
    else if (m.method === 'tools/call' && m.params.name === 'crash') process.exit(1)
    else if (m.method === 'tools/call') setTimeout(() => send({ id: m.id, result: { content: [{ type: 'text', text: 'echo ' + m.params.arguments.q }] } }), m.params.arguments.ms || 0)
  }
})
`

let dir: string
let log: string
let hub: FunesHub
let sock: string
const clients: Socket[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tfunes-'))
  log = join(dir, 'log')
  writeFileSync(log, '')
  writeFileSync(join(dir, 'fake.js'), FAKE)
  sock = join(dir, 'f.sock')
  hub = new FunesHub(sock, () => [process.execPath, join(dir, 'fake.js')], { ...process.env, FAKE_LOG: log })
  hub.start()
})
afterEach(() => {
  for (const c of clients) c.destroy()
  clients.length = 0
  hub.stop()
})

// A session's side of the socket: send a message, collect every line it gets back.
const session = async (): Promise<{ send: (m: object) => void; got: Record<string, unknown>[] }> => {
  const c = connect(sock)
  clients.push(c)
  await new Promise((r) => c.once('connect', r))
  const got: Record<string, unknown>[] = []
  let buf = ''
  c.setEncoding('utf8')
  c.on('data', (d: string) => {
    buf += d
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      got.push(JSON.parse(buf.slice(0, nl)))
      buf = buf.slice(nl + 1)
    }
  })
  return { send: (m) => c.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'), got }
}
const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}
const starts = (): number => readFileSync(log, 'utf8').split('\n').filter((l) => l === 'start').length
const init = { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude' } } }
const call = (id: number, q: string, ms = 0): object => ({ id, method: 'tools/call', params: { name: 'recall', arguments: { q, ms } } })

describe('shared funes hub', () => {
  it('two sessions share one funes: initialised once, same request ids routed back to the right session', async () => {
    const a = await session()
    const b = await session()
    a.send(init)
    b.send(init)
    await until(() => a.got.length === 1 && b.got.length === 1)
    expect(a.got[0]).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } })
    expect(b.got[0]).toEqual(a.got[0])
    a.send({ method: 'notifications/initialized' })
    a.send(call(2, 'slow', 150))
    b.send(call(2, 'fast'))
    await until(() => a.got.length === 2 && b.got.length === 2)
    expect([a.got[1], b.got[1]]).toEqual([
      { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'echo slow' }] } },
      { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'echo fast' }] } }
    ])
    expect(starts()).toBe(1)
    expect(readFileSync(log, 'utf8').split('\n').filter((l) => l === 'initialize' || l === 'notifications/initialized')).toEqual(['initialize', 'notifications/initialized'])
    expect(hub.sessions()).toBe(2)
  })

  it('ping is answered by the hub; funes stopping fails what was in flight, and the next request starts it again', async () => {
    const a = await session()
    a.send(init)
    a.send({ id: 9, method: 'ping' })
    await until(() => a.got.length === 2)
    expect(a.got.find((m) => m.id === 9)).toEqual({ jsonrpc: '2.0', id: 9, result: {} })
    a.send({ id: 3, method: 'tools/call', params: { name: 'crash', arguments: {} } })
    await until(() => a.got.length === 3)
    expect(a.got[2]).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'funes stopped; ask again' } })
    a.send(call(4, 'again'))
    await until(() => a.got.length === 4)
    expect(a.got[3]).toEqual({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: 'echo again' }] } })
    expect(starts()).toBe(2)
  })

  it('restartIfIdle stops funes only with nothing in flight; the next request gets a fresh one', async () => {
    const a = await session()
    a.send(init)
    await until(() => a.got.length === 1)
    a.send(call(2, 'busy', 300))
    await until(() => readFileSync(log, 'utf8').includes('tools/call'))
    expect(hub.restartIfIdle()).toBe(false)
    await until(() => a.got.length === 2)
    expect(hub.restartIfIdle()).toBe(true)
    await until(() => hub.pid() === null)
    a.send(call(3, 'fresh'))
    await until(() => a.got.length === 3)
    expect(a.got[2]).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'echo fresh' }] } })
    expect(starts()).toBe(2)
  })
})

describe('shim', () => {
  const run = (shim: string, input: string): Promise<string> => new Promise((resolve) => {
    const p = execFile('/bin/sh', [shim], { env: { ...process.env, FAKE_LOG: log }, timeout: 5000 }, (_e, out) => resolve(out))
    p.stdin!.write(input)
    setTimeout(() => p.kill(), 1500)
  })

  it('quotes paths with spaces and quotes', () => {
    expect(shimScript("/a b/it's.sock", ['funes', 'mcp'])).toBe([
      '#!/bin/sh',
      "# funes for Claude Code, from Signoff AI (SIGNOFF-42-IDLE/D9): the app's shared funes while it runs, else its own.",
      "SOCK='/a b/it'\\''s.sock'",
      'if [ -S "$SOCK" ] && nc -U "$SOCK" 2>/dev/null; then exit 0; fi',
      "exec 'funes' 'mcp'",
      ''
    ].join('\n'))
  })

  it('talks to the hub while it runs, and runs its own funes when the socket does not answer', async () => {
    const shim = join(dir, 'funes mcp shim')
    writeShim(shim, sock, [process.execPath, join(dir, 'fake.js')])
    const viaHub = await run(shim, JSON.stringify({ jsonrpc: '2.0', ...init }) + '\n')
    expect(JSON.parse(viaHub.trim().split('\n')[0]).result.serverInfo).toEqual({ name: 'fake' })
    expect(hub.pid()).not.toBeNull()
    hub.stop()
    const before = starts()
    const own = await run(shim, JSON.stringify({ jsonrpc: '2.0', ...init }) + '\n')
    expect(JSON.parse(own.trim().split('\n')[0]).result.serverInfo).toEqual({ name: 'fake' })
    expect(starts()).toBe(before + 1)
  })
})

describe('funesEntry', () => {
  it("reads the user's funes entry from ~/.claude.json, or null", () => {
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { funes: { type: 'stdio', command: 'funes', args: ['mcp'] }, other: { url: 'https://x' } } }))
    expect(funesEntry(dir)).toEqual(['funes', 'mcp'])
    expect(funesEntry(join(dir, 'nope'))).toBeNull()
  })
})
