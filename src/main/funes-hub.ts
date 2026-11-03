// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawn, type ChildProcess } from 'child_process'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createServer, type Server, type Socket } from 'net'

// One funes for every session (SIGNOFF-42-IDLE/D9).
// - funes speaks MCP only over stdio, one client each. The hub runs one `funes mcp` and serves many sessions from it
//   over a unix socket: each session's funes entry runs a small shim (`nc -U <socket>`), not its own funes.
// - The shim runs its own funes when the app is not running, so funes keeps working in Terminal and other tools.
// - Request ids are rewritten per connection; funes is initialised once and later sessions get that answer.
// - funes starts on the first request and again after it stops; a bloated idle funes can be restarted (restartIfIdle).

type Id = number | string | null
type Msg = { jsonrpc?: string; id?: Id; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }
type Conn = { socket: Socket; buf: string }

export const SHIM_NAME = 'funes-mcp'
export const SOCKET_NAME = 'funes.sock'
const STOPPED = { code: -32000, message: 'funes stopped; ask again' }
const START_MS = 30_000 // funes not initialised by then: stopped, and the waiting sessions get an error

// The shim the funes MCP entry runs. fallback: the funes command to run when the app's socket does not answer.
export function shimScript(socket: string, fallback: string[]): string {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  return [
    '#!/bin/sh',
    '# funes for Claude Code, from Signoff AI (SIGNOFF-42-IDLE/D9): the app\'s shared funes while it runs, else its own.',
    `SOCK=${q(socket)}`,
    // nc fails at once when nothing listens (macOS nc cannot probe a unix socket with -z); its own funes then runs.
    'if [ -S "$SOCK" ] && nc -U "$SOCK" 2>/dev/null; then exit 0; fi',
    `exec ${fallback.map(q).join(' ')}`,
    ''
  ].join('\n')
}

// The funes entry in Claude Code's user config (~/.claude.json), read only.
export function funesEntry(home: string): string[] | null {
  try {
    const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, { command?: string; args?: string[] }> }
    const f = cfg.mcpServers?.funes
    return f?.command ? [f.command, ...(f.args ?? [])] : null
  } catch {
    return null // no config or unreadable: shown as "funes is not set up"
  }
}

export class FunesHub {
  private server: Server | null = null
  private child: ChildProcess | null = null
  private out = ''
  private ready: Promise<unknown> | null = null
  private initialized: ((r: unknown) => void) | null = null
  private nextId = 1
  private readonly initId = 0
  private pending = new Map<number, { conn: Conn; id: Id }>()
  private conns = new Set<Conn>()

  // command: how funes is started (its original entry, e.g. ['funes', 'mcp']).
  constructor(private socketPath: string, private command: () => string[], private env: NodeJS.ProcessEnv) {}

  start(): void {
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath) // left by an app that did not quit cleanly
    this.server = createServer((socket) => this.connect(socket))
    this.server.on('error', (e) => console.error('funes hub: socket error', e))
    this.server.listen(this.socketPath)
  }

  stop(): void {
    for (const c of this.conns) c.socket.destroy()
    this.server?.close()
    this.server = null
    this.child?.kill()
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath)
  }

  pid(): number | null {
    return this.child?.pid ?? null
  }

  sessions(): number {
    return this.conns.size
  }

  // Bloated funes (D7) with nothing in flight: stop it; the next request starts a fresh one. Returns whether it did.
  restartIfIdle(): boolean {
    if (!this.child || this.pending.size) return false
    this.child.kill()
    return true
  }

  private connect(socket: Socket): void {
    const conn: Conn = { socket, buf: '' }
    this.conns.add(conn)
    socket.setEncoding('utf8')
    socket.on('data', (d: string) => {
      conn.buf += d
      let nl: number
      while ((nl = conn.buf.indexOf('\n')) >= 0) {
        const line = conn.buf.slice(0, nl).trim()
        conn.buf = conn.buf.slice(nl + 1)
        if (line) void this.fromSession(conn, line)
      }
    })
    const gone = (): void => {
      this.conns.delete(conn)
      for (const [k, p] of this.pending) if (p.conn === conn) this.pending.delete(k)
    }
    socket.on('close', gone)
    socket.on('error', gone)
  }

  private send(conn: Conn, m: Msg): void {
    if (!conn.socket.destroyed) conn.socket.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  }

  private toFunes(m: Msg): void {
    this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  }

  private async fromSession(conn: Conn, line: string): Promise<void> {
    let m: Msg
    try {
      m = JSON.parse(line) as Msg
    } catch {
      return this.send(conn, { id: null, error: { code: -32700, message: 'parse error' } })
    }
    const request = m.id !== undefined && m.id !== null && !!m.method
    if (m.method === 'notifications/initialized') return // funes was initialised once, by the hub
    if (request && m.method === 'ping') return this.send(conn, { id: m.id, result: {} })
    if (!m.method) return // an answer to a request from funes: the hub answers those itself (fromFunes)
    let init: unknown
    try {
      init = await this.ensure(m.params)
    } catch (e) {
      if (request) this.send(conn, { id: m.id, error: { code: -32000, message: `funes could not start: ${(e as Error).message}` } })
      return
    }
    if (m.method === 'initialize') return this.send(conn, { id: m.id, result: init })
    if (m.method === 'notifications/cancelled') {
      const hubId = [...this.pending].find(([, p]) => p.conn === conn && p.id === m.params?.requestId)?.[0]
      if (hubId !== undefined) this.toFunes({ method: m.method, params: { ...m.params, requestId: hubId } })
      return
    }
    if (!request) return this.toFunes(m)
    const hubId = this.nextId++
    this.pending.set(hubId, { conn, id: m.id! })
    this.toFunes({ ...m, id: hubId })
  }

  // Starts funes and initialises it once; params: the first session's initialize params (protocol version).
  private ensure(params: Msg['params']): Promise<unknown> {
    if (this.ready) return this.ready
    const [cmd, ...args] = this.command()
    const child = spawn(cmd, args, { env: this.env, stdio: ['pipe', 'pipe', 'ignore'] })
    this.child = child
    this.out = ''
    this.ready = new Promise((resolve, reject) => {
      const slow = setTimeout(() => {
        child.kill()
        reject(new Error('funes did not answer initialize'))
      }, START_MS)
      this.initialized = (r) => {
        clearTimeout(slow)
        resolve(r)
      }
      child.once('error', (e) => {
        clearTimeout(slow)
        this.stopped(child)
        reject(e)
      })
    })
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      this.out += d
      let nl: number
      while ((nl = this.out.indexOf('\n')) >= 0) {
        const line = this.out.slice(0, nl).trim()
        this.out = this.out.slice(nl + 1)
        if (line) this.fromFunes(line)
      }
    })
    child.on('exit', () => this.stopped(child))
    this.toFunes({
      id: this.initId, method: 'initialize',
      params: { protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18', capabilities: {}, clientInfo: { name: 'signoff-funes-hub', version: '1' } }
    })
    return this.ready
  }

  private fromFunes(line: string): void {
    let m: Msg
    try {
      m = JSON.parse(line) as Msg
    } catch {
      return // funes wrote something that is not JSON-RPC: skipped
    }
    if (m.method && m.id !== undefined && m.id !== null) {
      // funes asking the client something (ping, roots): the hub answers; it offered no capabilities.
      return this.toFunes(m.method === 'ping' ? { id: m.id, result: {} } : { id: m.id, error: { code: -32601, message: 'not supported' } })
    }
    if (m.method) {
      for (const c of this.conns) this.send(c, m) // a notification: every session
      return
    }
    if (m.id === this.initId) {
      this.toFunes({ method: 'notifications/initialized' })
      this.initialized?.(m.result)
      return
    }
    const p = this.pending.get(m.id as number)
    if (!p) return
    this.pending.delete(m.id as number)
    this.send(p.conn, { ...m, id: p.id })
  }

  private stopped(child: ChildProcess): void {
    if (this.child !== child) return
    this.child = null
    this.ready = null
    for (const [k, p] of this.pending) {
      this.send(p.conn, { id: p.id, error: STOPPED })
      this.pending.delete(k)
    }
  }
}

// Paths the app uses: the socket and the shim live in its data folder.
export const hubPaths = (userData: string): { socket: string; shim: string } => ({ socket: join(userData, SOCKET_NAME), shim: join(userData, SHIM_NAME) })

// Writes the shim (the app keeps it current at each start). fallback: funes' own command.
export function writeShim(shim: string, socket: string, fallback: string[]): void {
  writeFileSync(shim, shimScript(socket, fallback))
  chmodSync(shim, 0o755)
}

