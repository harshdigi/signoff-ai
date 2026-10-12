// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { useCallback, useEffect, useState } from 'react'
import { errText } from './types'

// Integrations: connect Slack, GitHub, Notion or your own MCP server in a few clicks.
// Every change runs Claude Code's own `claude mcp …` command in a visible terminal; the app never edits config files.
type Field = { key: string; label: string; secret?: boolean }
type Entry = { id: string; name: string; description: string; transport: string; url?: string; command?: string[]; fields: Field[]; oauth: boolean }
type Configured = { name: string; scope: string; transport: string; target: string }
type Data = { catalog: Entry[]; connectors: { id: string; name: string }[]; connectorsUrl: string; scopes: string[]; configured: Configured[] }
type Status = { servers: { name: string; status: string }[] } | null

const SCOPE_HELP: Record<string, string> = { user: 'You, in every project', local: 'You, in this folder only', project: 'Everyone on this repo (.mcp.json)' }

export default function IntegrationsView({ showTerminal, trusted }: { showTerminal: (id: string, title: string) => void; trusted: boolean }): React.JSX.Element {
  const [data, setData] = useState<Data | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null) // Remove asks for a second click
  const load = useCallback(() => {
    window.api.integrations.list().then(setData, (e: unknown) => setErr(errText(e)))
    window.api.tools.connected().then(setStatus)
  }, [])
  useEffect(load, [load])
  // Reload after the terminal running a connect / sign-in / remove finishes.
  useEffect(() => window.api.terminal.onExit((e) => { if (e.id === running) { setRunning(null); load() } }), [running, load])
  const run = (p: Promise<{ id: string; title: string }>): void => {
    setErr(null)
    p.then((t) => { setRunning(t.id); showTerminal(t.id, t.title); setOpen(null) }, (e: unknown) => setErr(errText(e)))
  }
  if (!data) return <div className="side-body"><div className="side-empty">{err ?? 'Loading…'}</div></div>
  const statusOf = (name: string): string | undefined => status?.servers.find((s) => s.name === name)?.status
  const have = new Set(data.configured.map((c) => c.name))
  return (
    <div className="side-body">
      {err && <div className="err">{err}</div>}
      <div className="side-group">Your claude.ai connectors</div>
      <div className="side-empty">Slack, Gmail, Google Calendar and Microsoft 365 connect on claude.ai and then show up in every chat by themselves. On Team and Enterprise plans an admin adds them.</div>
      <div className="chips wrap">{data.connectors.map((c) => <span key={c.id} className="chip">{c.name}</span>)}</div>
      <button className="wide" onClick={() => window.api.integrations.openConnectors()}>Open claude.ai connectors</button>
      {status?.servers.filter((s) => s.name.startsWith('claude.ai')).map((s) => (
        <div key={s.name} className="side-item"><span className={'state-dot ' + dot(s.status)} /><span className="name">{s.name}</span><span className="dir">{s.status}</span></div>
      ))}

      <div className="side-group">Connected here ({data.configured.length})</div>
      {data.configured.length === 0 && <div className="side-empty">No MCP servers yet. Add one below.</div>}
      {data.configured.map((c) => (
        <div key={c.scope + c.name} className="integ-row">
          <div className="side-item"><span className={'state-dot ' + dot(statusOf(c.name))} /><span className="name">{c.name}</span><span className="dir">{c.scope} · {statusOf(c.name) ?? 'not started yet'}</span></div>
          <div className="meta integ-target">{c.transport} · {c.target}</div>
          <div className="bar">
            {c.transport !== 'stdio' && <button disabled={!!running} onClick={() => run(window.api.integrations.login(c.name))}>Sign in</button>}
            {confirm === c.scope + c.name
              ? <><button className="danger" disabled={!!running} onClick={() => { setConfirm(null); run(window.api.integrations.remove(c.name, c.scope)) }}>Yes, remove {c.name}</button><button onClick={() => setConfirm(null)}>Keep</button></>
              : <button disabled={!!running || (c.scope !== 'user' && !trusted)} onClick={() => setConfirm(c.scope + c.name)}>Remove</button>}
          </div>
        </div>
      ))}

      <div className="side-group">Add a popular one</div>
      {data.catalog.map((e) => (
        <div key={e.id} className="integ-card">
          <div className="side-item" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <span className="name"><b>{e.name}</b></span><span className="dir">{have.has(e.id) ? 'connected' : e.description}</span>
          </div>
          {open === e.id && <ConnectForm entry={e} scopes={data.scopes} trusted={trusted} busy={!!running} connect={(scope, values) => run(window.api.integrations.add({ catalogId: e.id, scope, values }))} />}
        </div>
      ))}

      <div className="side-group">Add your own MCP server</div>
      {open === 'custom' ? <CustomForm scopes={data.scopes} trusted={trusted} busy={!!running} add={(spec) => run(window.api.integrations.add({ scope: spec.scope, custom: spec }))} cancel={() => setOpen(null)} />
        : <button className="wide" onClick={() => setOpen('custom')}>Add a server…</button>}
      {running && <div className="side-empty">Running in the terminal panel; this list refreshes when it finishes.</div>}
    </div>
  )
}

const dot = (s?: string): string => (s === 'connected' ? 'done' : s === 'pending' || s === 'needs-auth' ? 'working' : s ? 'waiting' : '')

function ScopePicker({ scopes, value, set, trusted }: { scopes: string[]; value: string; set: (s: string) => void; trusted: boolean }): React.JSX.Element {
  return (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {scopes.map((s) => <option key={s} value={s} disabled={s !== 'user' && !trusted}>{s}: {SCOPE_HELP[s]}</option>)}
    </select>
  )
}

function ConnectForm({ entry, scopes, trusted, busy, connect }: { entry: Entry; scopes: string[]; trusted: boolean; busy: boolean; connect: (scope: string, values: Record<string, string>) => void }): React.JSX.Element {
  const [scope, setScope] = useState('user')  // default: your own account, every project
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <div className="integ-form">
      <div className="meta">{entry.url ?? entry.command?.join(' ')}</div>
      {entry.fields.map((f) => (
        <label key={f.key} className="draft-field"><span>{f.label}</span>
          <input type={f.secret ? 'password' : 'text'} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} /></label>
      ))}
      <label className="draft-field"><span>Who can use it</span><ScopePicker scopes={scopes} value={scope} set={setScope} trusted={trusted} /></label>
      {entry.oauth && <div className="meta">After connecting, press Sign in on it: {entry.name} opens in your browser.</div>}
      {entry.fields.some((f) => f.secret) && <div className="meta">The secret is handed to Claude Code, which stores it in its own config. The app does not keep it.</div>}
      <button className="primary" disabled={busy} onClick={() => connect(scope, values)}>Connect {entry.name}</button>
    </div>
  )
}

type Spec = { name: string; scope: string; transport: 'http' | 'sse' | 'stdio'; url?: string; command?: string[]; headers?: string[]; env?: string[] }

// Splits a command line on spaces, keeping "quoted parts" together.
const words = (s: string): string[] => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean)

function CustomForm({ scopes, trusted, busy, add, cancel }: { scopes: string[]; trusted: boolean; busy: boolean; add: (s: Spec) => void; cancel: () => void }): React.JSX.Element {
  const [s, setS] = useState({ name: '', transport: 'http' as Spec['transport'], target: '', headers: '', env: '', scope: 'user' })
  const spec: Spec = {
    name: s.name.trim(), scope: s.scope, transport: s.transport,
    ...(s.transport === 'stdio' ? { command: words(s.target) } : { url: s.target.trim(), headers: lines(s.headers) }), env: lines(s.env)
  }
  // The exact command, with header and env values masked.
  const masked = ['claude mcp add', `--scope ${s.scope}`, `--transport ${s.transport}`,
    ...(spec.env ?? []).map((e) => `--env ${e.split('=')[0]}=•••`),
    ...(spec.headers ?? []).map((h) => `--header "${h.split(':')[0]}: •••"`),
    spec.name || '<name>', s.transport === 'stdio' ? `-- ${s.target || '<command>'}` : s.target || '<url>'].join(' ')
  return (
    <div className="integ-form">
      <label className="draft-field"><span>Name</span><input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="my-server" /></label>
      <label className="draft-field"><span>Type</span>
        <select value={s.transport} onChange={(e) => setS({ ...s, transport: e.target.value as Spec['transport'] })}>
          <option value="http">Remote (HTTP)</option><option value="sse">Remote (SSE)</option><option value="stdio">Local command</option>
        </select></label>
      <label className="draft-field"><span>{s.transport === 'stdio' ? 'Command' : 'URL'}</span>
        <input value={s.target} onChange={(e) => setS({ ...s, target: e.target.value })} placeholder={s.transport === 'stdio' ? 'npx -y some-mcp-server' : 'https://example.com/mcp'} /></label>
      {s.transport !== 'stdio' && <label className="draft-field"><span>Headers (one per line, optional)</span><textarea value={s.headers} onChange={(e) => setS({ ...s, headers: e.target.value })} placeholder="Authorization: Bearer …" /></label>}
      <label className="draft-field"><span>Environment (one NAME=value per line, optional)</span><textarea value={s.env} onChange={(e) => setS({ ...s, env: e.target.value })} /></label>
      <label className="draft-field"><span>Who can use it</span><ScopePicker scopes={scopes} value={s.scope} set={(v) => setS({ ...s, scope: v })} trusted={trusted} /></label>
      <pre className="cmd">{masked}</pre>
      <div className="bar"><button className="primary" disabled={busy || !s.name || !s.target} onClick={() => add(spec)}>Add server</button><button onClick={cancel}>Cancel</button></div>
    </div>
  )
}
