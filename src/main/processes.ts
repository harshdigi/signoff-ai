// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { basename } from 'path'

// The processes the app runs, for the Background view (SIGNOFF-39-PROCS/D1, D3).
// - From one `ps` listing: each process with what it started below it (a session's tools count towards the session);
// - kinds: the app itself, Claude sessions, terminals, tools (git, gh, headless claude), leftovers;
// - leftovers are what no live session owns: tmux servers from test runs or an earlier app,
//   and app tmux sessions whose board session is gone or removed. Only they can be stopped here (D3).
export type Row = { pid: number; ppid: number; cpu: number; rss: number; etime: string; command: string }
export type Stop = { server: string } | { session: string }
export type ProcKind = 'app' | 'session' | 'terminal' | 'tool' | 'leftover'
export type Proc = { key: string; kind: ProcKind; name: string; detail: string; session: string | null; count: number; cpu: number; memMB: number; since: string; stop?: Stop }
export type Context = {
  appPid: number
  socket: string                                   // the app's tmux socket
  panes: { name: string; pid: number }[]           // its tmux sessions, by Claude's pid
  terminals: { pid: number; session: string | null; command: string; args: string[] }[]  // the app's terminal tabs
  session: (id: string) => { title: string | null; live: boolean } | null
}

// `ps -A -o pid=,ppid=,pcpu=,rss=,etime=,command=`
export function parsePs(out: string): Row[] {
  const rows: Row[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], rss: +m[4], etime: m[5], command: m[6] })
  }
  return rows
}

// ps elapsed time ([[dd-]hh:]mm:ss) in short words: 2d 23h, 4h 41m, 14m, 9s.
export function since(etime: string): string {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime)
  if (!m) return etime
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => +(x ?? 0))
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${min}m`
  if (min) return `${min}m`
  return `${s}s`
}

// "/usr/bin/git status --porcelain" → "git status".
export function shortCommand(command: string): string {
  const [exe, ...rest] = command.split(/\s+/)
  const sub = rest.slice(0, 3).find((a) => a && !a.startsWith('-'))
  return sub && !sub.includes('/') ? `${basename(exe)} ${sub}` : basename(exe)
}

const TMUX_SERVER = /^tmux -L (\S+) -f (.*?tmux\.conf) new-session/  // the config path can hold spaces (/Applications/Signoff AI.app)
const ATTACH = /^tmux -L (\S+) .* attach -t =(\S+)/
const HELPER = /--type=(renderer|gpu-process|utility)/
const HELPER_NAMES: Record<string, string> = { renderer: 'Window', 'gpu-process': 'Graphics', utility: 'Network and other helpers' }

export function classify(rows: Row[], ctx: Context): Proc[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const children = new Map<number, Row[]>()
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r])
  const claimed = new Set<number>()
  const tree = (pid: number): Row[] => {
    const out: Row[] = []
    const walk = (p: number): void => {
      const r = byPid.get(p)
      if (!r || claimed.has(p)) return
      claimed.add(p)
      out.push(r)
      for (const c of children.get(p) ?? []) walk(c.pid)
    }
    walk(pid)
    return out
  }
  const procs: Proc[] = []
  const add = (key: string, kind: ProcKind, name: string, detail: string, session: string | null, list: Row[], stop?: Stop): Proc | undefined => {
    if (!list.length) return undefined
    const p: Proc = {
      key, kind, name, detail, session, count: list.length, stop,
      cpu: Math.round(list.reduce((n, r) => n + r.cpu, 0) * 10) / 10,
      memMB: Math.round(list.reduce((n, r) => n + r.rss, 0) / 1024),
      since: since(list[0].etime)
    }
    procs.push(p)
    return p
  }
  const extra = (list: Row[]): string => (list.length > 1 ? ` · ${list.length - 1} more below it` : '')

  // Claude sessions: each tmux pane is the session's claude; what it runs counts towards it.
  const sessionProc = new Map<string, Proc>()
  for (const pane of ctx.panes) {
    const s = ctx.session(pane.name)
    const list = tree(pane.pid)
    const p = s?.live
      ? add(`session:${pane.name}`, 'session', s.title || pane.name.slice(0, 8), `Claude session${extra(list)}`, pane.name, list)
      : add(`session:${pane.name}`, 'leftover', s?.title || pane.name.slice(0, 8), s ? 'Claude still running for a removed session' : 'Claude running for a session not on the board', pane.name, list, { session: pane.name })
    if (p) sessionProc.set(pane.name, p)
  }
  // tmux servers: the app's hosts the sessions; others from this app's config are leftovers.
  for (const r of rows) {
    const m = TMUX_SERVER.exec(r.command)
    if (!m || r.ppid !== 1 || !/decision-ide|Signoff AI\.app/.test(m[2])) continue
    if (m[1] === ctx.socket) add(`tmux:${m[1]}`, 'app', 'tmux', 'Hosts the Claude sessions', null, tree(r.pid))
    else add(`tmux:${m[1]}`, 'leftover', `tmux server ${m[1]}`, 'No session uses it (left by a test run or an earlier app)', null, tree(r.pid), { server: m[1] })
  }
  // The app and what it started.
  const app = byPid.get(ctx.appPid)
  if (app) {
    claimed.add(app.pid)
    add('app:main', 'app', 'Signoff AI', 'The app itself', null, [app])
    for (const c of children.get(app.pid) ?? []) {
      if (claimed.has(c.pid)) continue
      const helper = HELPER.exec(c.command)?.[1]
      const attach = ATTACH.exec(c.command)
      const term = ctx.terminals.find((t) => t.pid === c.pid)
      if (helper) add(`app:${c.pid}`, 'app', HELPER_NAMES[helper], 'Part of the app', null, tree(c.pid))
      else if (attach && attach[1] === ctx.socket && sessionProc.has(attach[2])) {
        // The session's view in the app (tmux attach): counted with the session.
        const p = sessionProc.get(attach[2])!
        for (const r of tree(c.pid)) { p.count++; p.cpu = Math.round((p.cpu + r.cpu) * 10) / 10; p.memMB += Math.round(r.rss / 1024) }
      } else if (term) {
        const list = tree(c.pid)
        add(`term:${c.pid}`, 'terminal', shortCommand([term.command, ...term.args].join(' ')), `Terminal${extra(list)}`, term.session, list)
      } else {
        const list = tree(c.pid)
        add(`tool:${c.pid}`, 'tool', shortCommand(c.command), `Started by the app${extra(list)}`, null, list)
      }
    }
  }
  const order: ProcKind[] = ['leftover', 'session', 'terminal', 'tool', 'app']
  return procs.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.cpu - a.cpu)
}

export const sameStop = (a: Stop | undefined, b: Stop): boolean =>
  !!a && (('server' in a && 'server' in b && a.server === b.server) || ('session' in a && 'session' in b && a.session === b.session))
