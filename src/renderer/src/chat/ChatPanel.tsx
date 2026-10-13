// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { Children, forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DecisionCard, ReviewCard } from '../board/Cards'
import { Linked } from '../board/Refs'
import CodeRef from '../ide/CodeRef'
import { looksLikeRef } from '../ide/code-ref'
import { time, type BoardState } from '../board/types'
import { errText, type CatalogItem, type ChatStatus } from '../ide/types'
import ApprovalCard from './ApprovalCard'
import { latestTodos, toRows, toolSummary, waitingInTerminal, type ToolRow } from './transcript'
import { MODES } from './modes'
import { MdCode } from '../ide/CodeBlock'

// The right-hand chat (IDE/D9). Everything waiting on the user for this chat sits above the input:
// permission prompts, Claude's questions, decisions, reviews and actions.
// A session running in a terminal can be picked too. If the app owns that terminal, the message is typed into it,
// exactly as if you typed there (Claude Code queues it if busy). A session in an outside terminal gets a board message instead.

const MODELS = [['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']] as const
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Claude Code's own commands that work in a chat (checked live or documented for headless use), shown in the / menu
// next to your skills. /clear, /plan and /rename are handled by the app; the rest go to Claude Code as typed.
const BUILTINS: { name: string; desc: string }[] = [
  { name: 'compact', desc: 'Free up context by summarising the conversation so far (add focus instructions after it)' },
  { name: 'context', desc: 'Show how the context window is used' },
  { name: 'usage', desc: 'Session cost and your plan limits' },
  { name: 'model', desc: 'Switch model for this chat, e.g. /model sonnet' },
  { name: 'effort', desc: 'Set effort: low, medium, high, xhigh, max' },
  { name: 'plan', desc: 'Plan mode, optionally with a task: /plan fix the login bug' },
  { name: 'rewind', desc: 'Go back to an earlier point (opens in the terminal)' },
  { name: 'memory', desc: 'Edit CLAUDE.md memory (opens in the terminal)' },
  { name: 'review', desc: 'Review the current changes' },
  { name: 'init', desc: 'Create a CLAUDE.md guide for this project' },
  { name: 'mcp', desc: 'Status of your MCP servers' },
  { name: 'rename', desc: 'Rename this chat: /rename my name' },
  { name: 'clear', desc: 'Start a new chat' },
  { name: 'config', desc: 'Change a setting: /config key=value' }
]
type Img = { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string; name: string }
type MenuItem = { key: string; label: string; desc: string; source: string; insert: string }

// One Claude message. Markdown parsing is the costly part of a long chat, so a message re-renders only when its own
// text (or the link setup) changes, not on every change elsewhere in the window.
const MessageText = memo(function MessageText({ text, md }: { text: string; md: Components }): React.JSX.Element {
  return <div className="bubble claude md"><Markdown remarkPlugins={[remarkGfm]} components={md}>{text}</Markdown></div>
})

export type ChatHandle = { prefill: (text: string) => void; send: (text: string) => void }

type Props = {
  board: BoardState; refresh: () => void; folder: string | null; trusted: boolean
  session: string | null; setSession: (id: string | null) => void; catalog: CatalogItem[]
  terminalFor: (session: string) => string | null; showTerminal: (id: string) => void
}

const storedFold = (session: string): boolean => {
  try {
    return localStorage.getItem(`waiting-folded:${session}`) === '1'
  } catch {
    return false // storage unavailable: shown open, as by default
  }
}

const ChatPanel = forwardRef<ChatHandle, Props>(function ChatPanel({ board, refresh, folder, trusted, session, setSession, catalog, terminalFor, showTerminal }, ref) {
  const [events, setEvents] = useState<Record<string, unknown>[]>([])
  const [live, setLive] = useState('')
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [images, setImages] = useState<Img[]>([])
  // "Waiting on you" can be folded per session; remembered on this computer only (storage can fail: then it shows open).
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const waitingFolded = session ? folded[session] ?? storedFold(session) : false
  const toggleWaiting = (): void => {
    if (!session) return
    setFolded({ ...folded, [session]: !waitingFolded })
    try {
      if (waitingFolded) localStorage.removeItem(`waiting-folded:${session}`)
      else localStorage.setItem(`waiting-folded:${session}`, '1')
    } catch { /* not remembered; it still folds for now */ }
  }
  // A message naming another ticket waits here until you choose where it goes (main/context.ts route).
  type Choice = 'here' | 'existing' | 'new'
  const [routing, setRouting] = useState<{ key: string; current: string | null; existing: string | null; text: string; images: Img[] } | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Claude's text gets the same reference links as decision cards (D-ids, "step 7", older "point 7").
  // Depends on the session and its ticket only: a board refresh must not make every message re-render.
  const ticket = board.sessions.find((x) => x.id === session)?.ticket ?? null
  const md = useMemo<Components>(() => {
    const link = (kids: React.ReactNode): React.ReactNode => Children.map(kids, (k) => (typeof k === 'string' ? <Linked text={k} ticket={ticket} session={session} /> : k))
    // Inline code naming a file or definition: a link with a hover preview. Fenced blocks are coloured (ide/CodeBlock).
    const code: Components['code'] = ({ className, children }) => {
      const t = String(children)
      return !className && !t.includes('\n') && looksLikeRef(t) ? <CodeRef text={t} session={session} /> : <MdCode className={className}>{children}</MdCode>
    }
    return { p: ({ children }) => <p>{link(children)}</p>, li: ({ children }) => <li>{link(children)}</li>, code }
  }, [ticket, session])
  // A "point 7" link elsewhere: scroll to the newest message that describes it, and highlight it.
  useEffect(() => {
    const on = (e: Event): void => {
      const { session: s, anchor } = (e as CustomEvent<{ session: string; anchor: string }>).detail
      if (s !== session || !scroller.current) return
      const hit = [...scroller.current.querySelectorAll('.bubble.claude')].reverse().find((el) => el.textContent?.includes(anchor))
      hit?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      hit?.classList.add('flash')
      setTimeout(() => hit?.classList.remove('flash'), 1600)
    }
    window.addEventListener('chat:goto', on)
    return () => window.removeEventListener('chat:goto', on)
  }, [session])

  // Shared sessions (started here, or from Terminal through the wrapper) work the same: the chat types into them.
  const shared = (s: { via: string | null; tmux: string | null }): boolean => s.via === 'chat' || !!s.tmux
  const chats = board.sessions.filter((s) => shared(s) && s.cwd === folder && !s.archived)
  const terminals = board.sessions.filter((s) => !shared(s) && !s.archived && s.state !== 'done')
  const current = board.sessions.find((s) => s.id === session)
  // Picked session that runs in a terminal the app cannot reach: messages are queued on the board, not typed.
  const queued = !!current && !shared(current)
  const sent = board.messages.filter((m) => m.session === session)
  const term = queued ? terminalFor(session!) : null

  useEffect(() => {
    setEvents([])
    setLive('')
    if (!session || queued) return setStatus(null)
    let alive = true
    window.api.chat.history(session).then((h: Record<string, unknown>[]) => alive && setEvents(h))
    window.api.chat.status(session).then((s: ChatStatus) => alive && setStatus(s))
    const offEvent = window.api.chat.onEvent(({ session: s, event }) => {
      if (s !== session) return
      if (event.type === 'stream_event') {
        const ev = event.event as { type?: string; delta?: { type?: string; text?: string } }
        if (ev?.type === 'message_start') setLive('')
        if (ev?.delta?.type === 'text_delta') setLive((t) => t + (ev.delta!.text ?? ''))
        return
      }
      if (event.type === 'assistant' || event.type === 'result') setLive('')
      setEvents((es) => [...es, event])
    })
    const offStatus = window.api.chat.onStatus((st) => st.session === session && setStatus(st))
    const offHandoff = window.api.chat.onHandoff((h) => h.from === session && setSession(h.to))
    return () => {
      alive = false
      offEvent()
      offStatus()
      offHandoff()
    }
  }, [session, queued])

  const rows = useMemo(() => toRows(events as never[]), [events])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [rows.length, live, sent.length])

  const send = async (text: string): Promise<void> => {
    if (!text.trim() && !images.length) return
    setErr(null)
    // /clear and /rename are handled by the app (a new chat, the chat's name); everything else goes to Claude Code.
    const cmd = /^\/(clear|rename)(?:\s+([\s\S]*))?$/.exec(text.trim())
    if (cmd && !queued) {
      const arg = (cmd[2] ?? '').trim()
      setInput('')
      if (cmd[1] === 'clear') return setSession(null)
      if (session && arg) await window.api.sessions.rename(session, arg).catch((e: unknown) => setErr(errText(e)))
      return refresh()
    }
    try {
      if (queued && term) {
        // Like typing in that terminal: multi-line text as a bracketed paste, then Enter.
        window.api.terminal.write(term, text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text)
        setTimeout(() => window.api.terminal.write(term, '\r'), 60)
        await window.api.board.typed(session!, text)
        showTerminal(term)
        setInput('')
        return refresh()
      }
      if (queued) {
        await window.api.board.message(session!, text)
        setInput('')
        return refresh()
      }
      // Same ticket, or none: sent here. Another ticket: you choose first (routing), then sendTo sends it.
      const r = await window.api.chat.send(session, text, images.map(({ mediaType, data }) => ({ mediaType, data })))
      if (r.ask) return setRouting({ ...r.ask, text, images })
      if (r.session !== session) setSession(r.session)
      setInput('')
      setImages([])
      refresh()
    } catch (e) {
      setErr(errText(e))
    }
  }
  const sendTo = async (choice: Choice): Promise<void> => {
    if (!routing) return
    try {
      const r = await window.api.chat.send(session, routing.text, routing.images.map(({ mediaType, data }) => ({ mediaType, data })), choice)
      setRouting(null)
      if (r.session !== session) setSession(r.session)
      setInput('')
      setImages([])
      refresh()
    } catch (e) {
      setErr(errText(e))
    }
  }
  useImperativeHandle(ref, () => ({
    prefill: (text) => {
      setInput(text)
      setTimeout(() => box.current?.focus(), 0)
    },
    send: (text) => void send(text)
  }))

  // "/" at the start: Claude Code commands and your skills. "@" before a word: files in the chat's folder.
  const slash = queued ? null : /^\/(\S*)$/.exec(input)
  const at = queued ? null : /(?:^|\s)@(\S*)$/.exec(input)
  useEffect(() => {
    if (at && files === null) window.api.chat.files(session).then(setFiles)
  }, [at !== null, files, session])
  useEffect(() => { setFiles(null); setRouting(null) }, [session])
  const menu: MenuItem[] = slash
    ? [...BUILTINS.map((b) => ({ key: 'b:' + b.name, label: '/' + b.name, desc: b.desc, source: 'Claude Code', insert: '/' + b.name + ' ' })),
       ...catalog.filter((c) => c.kind !== 'agent').map((c) => ({ key: c.kind + c.name, label: c.invoke, desc: c.description, source: c.source, insert: c.invoke + ' ' }))]
        .filter((m) => m.label.toLowerCase().includes('/' + slash[1].toLowerCase())).slice(0, 10)
    : at
      ? (files ?? []).filter((f) => f.toLowerCase().includes(at[1].toLowerCase())).slice(0, 10)
          .map((f) => ({ key: 'f:' + f, label: f, desc: '', source: 'file', insert: input.slice(0, input.length - at[1].length) + f + ' ' }))
      : []
  const pick = (m: MenuItem): void => {
    setInput(m.insert)
    setMenuIndex(0)
  }
  // Shift+Tab goes to the chat's terminal, so Claude Code cycles its own modes; the chip shows where it landed.
  const cycleMode = (): void => {
    if (!session || queued) return
    void window.api.chat.cycleMode(session)
  }
  const showChatTerminal = (): void => {
    if (session && !queued) void window.api.chat.terminal(session).then(showTerminal)
  }
  const command = (line: string): void => {
    if (session) window.api.chat.command(session, line).catch((e: unknown) => setErr(errText(e)))
  }
  // Pasted or dropped images go to Claude with the next message (PNG, JPEG, GIF, WebP, up to 5 MB each).
  const addImageFiles = (list: FileList | File[]): void => {
    for (const f of Array.from(list)) {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.type)) continue
      if (f.size > 5 * 1024 * 1024) { setErr(`${f.name || 'image'} is over 5 MB`); continue }
      const r = new FileReader()
      r.onload = () => setImages((xs) => [...xs, { mediaType: f.type as Img['mediaType'], data: String(r.result).split(',')[1], name: f.name || 'pasted image' }])
      r.readAsDataURL(f)
    }
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      return cycleMode()
    }
    if (e.key === 'Escape') {
      if (menu.length) return setInput(input + ' ')
      if (busy && session) return void window.api.chat.interrupt(session)
    }
    if (menu.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setMenuIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : menu.length - 1)) % menu.length)
    } else if (menu.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
      e.preventDefault()
      pick(menu[Math.min(menuIndex, menu.length - 1)])
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const approvals = board.approvals.filter((a) => a.session_id === session)
  const informed = board.decisions.filter((d) => d.session === session && d.level === 'inform' && d.status !== 'open').slice(-5).reverse()
  const decisions = board.decisions.filter((d) => d.session === session && d.status === 'open' && !d.later_at) // set aside: in Decisions → Later
  const reviews = board.reviews.filter((r) => r.session === session && r.status === 'open')
  const busy = !!status?.busy
  const todos = useMemo(() => latestTodos(events as never[]), [events])

  const waiting = useMemo(() => (queued ? null : waitingInTerminal(events as never[])), [events, queued])

  return (
    <div className="chat">
      <div className="chat-head">
        <select value={session ?? ''} onChange={(e) => setSession(e.target.value || null)}>
          <option value="">New chat</option>
          {chats.length > 0 && <optgroup label="Chats">{chats.map((c) => <option key={c.id} value={c.id}>{c.title || c.id.slice(0, 8)}</option>)}</optgroup>}
          {terminals.length > 0 && <optgroup label="Terminal sessions">{terminals.map((c) => <option key={c.id} value={c.id}>{c.title || c.ticket || c.id.slice(0, 8)}</option>)}</optgroup>}
        </select>
        <button title="New chat" onClick={() => setSession(null)}>＋</button>
        {current && shared(current) && <button title="Open this chat's terminal: the same Claude Code session" onClick={showChatTerminal}>Terminal</button>}
        {current && <HeadActions id={current.id} title={current.title || current.ticket || current.id.slice(0, 8)} removed={() => setSession(null)} />}
      </div>
      {current?.via === 'chat' && current.context_used ? <ContextMeter used={current.context_used} window={current.context_window} busy={busy} handoff={async () => {
        try {
          setSession(await window.api.chat.handoff(current.id))
        } catch (e) {
          setErr(errText(e))
        }
      }} /> : null}
      <div className="chat-log" ref={scroller}>
        {!session && (
          <div className="chat-empty">
            <h3>Ask Claude</h3>
            <p>Claude works in <code>{folder ?? 'no folder'}</code>. Its decisions, reviews and permission prompts show up here for you to answer.</p>
            <p className="meta">Type <code>/</code> for your skills and commands.</p>
          </div>
        )}
        {queued && (
          <div className="queued-note">
            {term
              ? <><b>{current!.title || current!.ticket || 'This session'}</b> runs in a terminal tab here. What you send is typed into it, as if you typed it there. <button className="link" onClick={() => showTerminal(term)}>Show terminal</button></>
              : <><b>{current!.title || current!.ticket || 'This session'}</b> runs in a terminal outside the app, which the app cannot type into. Messages are queued and delivered when it next checks the board: when it finishes a turn, or while it waits on a decision.</>}
            {current!.description && <div className="meta">{current!.description}</div>}
          </div>
        )}
        {queued && sent.map((m) => (
          <div key={m.id} className="bubble you">
            {m.text}
            <div className="bubble-meta">{m.by === 'typed' ? `Typed into its terminal ${time(m.created_at)}` : m.delivered_at ? `Delivered ${time(m.delivered_at)}` : `Queued ${time(m.created_at)}`}</div>
          </div>
        ))}
        {rows.map((r, i) =>
          r.kind === 'prompt' ? <div key={i} className="bubble you">{r.text}{r.images ? <div className="bubble-meta">{r.images} image{r.images > 1 ? 's' : ''} attached</div> : null}</div>
          : r.kind === 'text' ? <MessageText key={i} text={r.text} md={md} />
          : r.kind === 'tool' ? <ToolLine key={i} t={r} />
          : r.kind === 'handoff-note' ? <details key={i} className="handoff-note"><summary>Handoff note sent to Claude</summary><pre>{r.text}</pre></details>
          : r.kind === 'notice' ? <div key={i} className="notice-row">{r.text}{r.link && <> <button className="link" onClick={() => setSession(r.link!.to)}>{r.link.label}</button></>}</div>
          : r.kind === 'result' ? <div key={i} className={'turn-end' + (r.isError ? ' bad' : '')}>{r.text}</div>
          : <div key={i} className="err">{r.text}</div>
        )}
        {live && <MessageText text={live} md={md} />}
        {busy && !live && approvals.length === 0 && <div className="thinking">Claude is working…</div>}
      </div>
      {informed.length > 0 && (
        <details className="informed">
          <summary>Claude decided {informed.length === 5 ? 'the last 5' : informed.length} for you · the code already settles these</summary>
          {informed.map((d) => <DecisionCard key={d.id} d={d} b={board} refresh={refresh} />)}
        </details>
      )}
      {todos.length > 0 && (
        <details className="todos" open={todos.some((t) => t.status !== 'completed')}>
          <summary>Claude's tasks · {todos.filter((t) => t.status === 'completed').length}/{todos.length} done</summary>
          {todos.map((t, i) => <div key={i} className={'todo ' + t.status}>{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'} {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</div>)}
        </details>
      )}
      {waiting && (
        <div className="ccard warn in-terminal">
          <div className="ccard-head"><b>{waiting.kind === 'plan' ? "Claude's plan is waiting for you in the terminal" : 'Claude is asking you in the terminal'}</b></div>
          <div className="meta">{waiting.kind === 'plan' ? waiting.text.slice(0, 400) : waiting.text}</div>
          <div className="bar"><button className="primary" onClick={showChatTerminal}>Answer in terminal</button></div>
        </div>
      )}
      {(approvals.length > 0 || decisions.length > 0 || reviews.length > 0) && (
        <div className="chat-waiting">
          <button className="waiting-title" onClick={toggleWaiting} title={waitingFolded ? 'Show what is waiting' : 'Fold this away; the count stays'}>
            {waitingFolded ? '▸' : '▾'} Waiting on you ({approvals.length + decisions.length + reviews.length})
          </button>
          {!waitingFolded && <>
            {approvals.map((a) => <ApprovalCard key={a.id} a={a} toTerminal={showChatTerminal} />)}
            {decisions.map((d) => <DecisionCard key={d.id} d={d} b={board} refresh={refresh} />)}
            {reviews.map((r) => <ReviewCard key={r.id} r={r} b={board} refresh={refresh} />)}
          </>}
        </div>
      )}
      <div className="composer">
        {menu.length > 0 && (
          <div className="slash-menu">
            {menu.map((m, i) => (
              <div key={m.key} className={i === menuIndex ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pick(m) }}>
                <b>{m.label}</b><span>{m.desc}</span><em>{m.source}</em>
              </div>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="img-chips">
            {images.map((im, i) => (
              <span key={i} className="img-chip">
                <img src={`data:${im.mediaType};base64,${im.data}`} alt="" />{im.name}
                <button className="row-act" onClick={() => setImages(images.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea ref={box} value={input} disabled={!queued && (!trusted || !folder)} onChange={(e) => { setInput(e.target.value); setMenuIndex(0) }} onKeyDown={onKey}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addImageFiles(e.clipboardData.files) } }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addImageFiles(e.dataTransfer.files) } }}
          placeholder={queued ? (term ? 'Type to this session (sent to its terminal)' : 'Message this session (queued until it checks the board)') : !folder ? 'Open a folder to start' : !trusted ? 'Trust this folder to chat' : busy ? 'Claude is working. You can queue a message. Esc stops.' : 'Ask Claude · / commands and skills · @ files · paste images · ⇧Tab mode'} />
        <div className="composer-bar">
          {!queued && <><button className="mode-chip" disabled={!session} onClick={cycleMode} title="Click or ⇧Tab: Claude Code's next mode">
            {MODES.find(([v]) => v === (current?.mode || 'default'))?.[1] ?? current?.mode} ⇧Tab
          </button>
          <select value="" disabled={!session} onChange={(e) => e.target.value && command(`/model ${e.target.value}`)} title="Model (sends /model)">
            <option value="">Model…</option>
            {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value="" disabled={!session} onChange={(e) => e.target.value && command(`/effort ${e.target.value}`)} title="Effort (sends /effort)">
            <option value="">Effort…</option>
            {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></>}
          <span className="grow" />
          {busy && <button onClick={() => session && window.api.chat.interrupt(session)}>Stop</button>}
          <button className="primary" disabled={(!input.trim() && !images.length) || (!queued && !trusted)} onClick={() => send(input)}>{queued && !term ? 'Queue' : 'Send'}</button>
        </div>
        {routing && (
          <div className="route-ask">
            <div>This mentions <b>{routing.key}</b>{routing.current ? <>, but this chat is on <b>{routing.current}</b></> : ''}. Where should it go?</div>
            <div className="bar">
              {routing.current && <button className="primary" onClick={() => void sendTo('here')}>Keep in this chat</button>}
              {routing.existing && <button className={routing.current ? '' : 'primary'} onClick={() => void sendTo('existing')}>Go to the {routing.key} chat</button>}
              <button onClick={() => void sendTo('new')}>New chat for {routing.key}</button>
              <button className="link" onClick={() => setRouting(null)}>Cancel</button>
            </div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  )
})
export default ChatPanel

// How full this chat's context is. Past the handoff point the chat continues in a fresh one by itself (Settings).
function ContextMeter({ used, window: win, busy, handoff }: { used: number; window: number | null; busy: boolean; handoff: () => void }): React.JSX.Element {
  const pct = win ? Math.min(100, Math.round((100 * used) / win)) : null
  const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
  return (
    <div className="ctx">
      <div className="ctx-bar"><div className={'ctx-fill' + (pct !== null && pct >= 70 ? ' hot' : '')} style={{ width: `${pct ?? 0}%` }} /></div>
      <span className="meta">{pct !== null ? `Context ${pct}%` : 'Context'} · {k(used)}{win ? ` / ${k(win)}` : ''}</span>
      <button className="link" disabled={busy} onClick={handoff} title="Start a fresh chat with a handoff note from the board">Fresh chat ⇢</button>
    </div>
  )
}

function ToolLine({ t }: { t: ToolRow }): React.JSX.Element {
  const state = t.result === undefined ? 'running' : t.isError ? 'failed' : 'done'
  return (
    <details className={'tool ' + state}>
      <summary><span className="tool-name">{t.name}</span> <span className="tool-arg">{toolSummary(t.name, t.input)}</span></summary>
      {t.result !== undefined && <pre>{t.result.slice(0, 4000)}{t.result.length > 4000 ? '\n…' : ''}</pre>}
    </details>
  )
}

// Rename / remove the chat that is open, from its header.
function HeadActions({ id, title, removed }: { id: string; title: string; removed: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm'>('idle')
  const [name, setName] = useState(title)
  const [err, setErr] = useState<string | null>(null)
  if (mode === 'rename') return (
    <span className="head-rename">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setMode('idle')
          if (e.key === 'Enter') window.api.sessions.rename(id, name).then(() => { setMode('idle'); setErr(null) }, (x: unknown) => setErr(errText(x)))
        }} />
      {err && <span className="err">{err}</span>}
    </span>
  )
  if (mode === 'confirm') return (
    <>
      <button className="danger" onClick={() => { void window.api.sessions.remove(id); setMode('idle'); removed() }}>Remove</button>
      <button onClick={() => setMode('idle')}>Keep</button>
    </>
  )
  return (
    <>
      <button title="Rename" onClick={() => { setName(title); setMode('rename') }}>✎</button>
      <button title="Remove from the list (its decisions stay in history)" onClick={() => setMode('confirm')}>×</button>
    </>
  )
}
