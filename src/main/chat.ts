// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as b from '../shared/board'
import { indexChatEvent } from '../shared/memory'
import { checkClaudeArgs } from './security-rules'
import { contextUsed, handoffNote, route, setContext, type RouteAsk, type RouteChoice } from './context'
import type { ClaudeLaunch } from './protocol'
import type { Settings } from './settings'
import type { Store } from './store'
import { SESSION_VARS, type TerminalManager } from './terminals'
import type { Tmux } from './tmux'
import { findTranscript, readNew, toChatLines, type ChatLine } from './transcript'

// Chats are real Claude Code terminal sessions. Each chat runs the normal `claude` screen in a tmux session named
// after the chat; the Terminals tab attaches to it, and so can any Terminal window (tmux.ts). The chat panel types
// into it and shows the conversation from Claude Code's saved transcript.
// - You can open the terminal at any time and work there directly; all are the same session.
// - Sessions the app started end when the app quits (stopAll); the conversation stays saved and resumes.
// - Permission prompts reach the chat as cards through the plugin's PermissionRequest hook (signoff hook permission).
// - Claude's questions and plan approval stay in the terminal (that hook does not fire for them).

export const MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const
export type Mode = (typeof MODES)[number]
export type ChatEvent = { session: string; event: Record<string, unknown> }
// A pasted or dropped image: saved to a file whose path goes into the message (Claude Code reads image files).
export type ChatImage = { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export type ChatStatus = { session: string; running: boolean; busy: boolean; terminal: string | null }
export type Handoff = { from: string; to: string; reason: 'auto' | 'manual' }
type Deps = { settings: () => Settings; files: (cwd: string) => string[]; attachments: string; tmux: Tmux }

// Claude Code asks once per folder whether to trust it, and its default answer is "No, exit": typing a message there
// would answer it and end the session. E.g. "Quick safety check: Is this a project you created or one you trust?".
const TRUST_PROMPT = /Quick safety check|trust this folder|trust the files in this folder/i
// The footer under Claude Code's input box names the permission mode, e.g. "⏵⏵ accept edits on (shift+tab to cycle)".
// - Read from the screen because the transcript saves the mode only when the next message is sent.
// - It also shows a mode Claude Code did not apply: auto is left out on models without it.
const FOOTER_MODE: [RegExp, Mode][] = [[/auto mode on/, 'auto'], [/accept edits on/, 'acceptEdits'], [/plan mode on/, 'plan'], [/manual mode on/, 'default']]
const FOOTER_LINES = 4
export const footerMode = (screen: string[]): Mode | null => {
  const footer = screen.filter((l) => l.trim()).slice(-FOOTER_LINES).join('\n')
  return FOOTER_MODE.find(([re]) => re.test(footer))?.[1] ?? null
}
// Whether Claude Code's input box (between the last two ─── rules above the footer) still holds text.
export const inputHasText = (screen: string[]): boolean => {
  const rules = screen.map((l, i) => (/^\s*─{10,}/.test(l) ? i : -1)).filter((i) => i >= 0)
  if (rules.length < 2) return false
  const box = screen.slice(rules[rules.length - 2] + 1, rules[rules.length - 1])
  return box.some((l) => l.replace(/^\s*❯/, '').trim() !== '')
}
const READY_QUIET_MS = 800   // after the startup hook ran, the screen is ready once output is quiet this long
const SLOW_START_MS = 20_000 // still not ready after this long: tell the user to look at the terminal

// One thing to type: your chat message, or board messages (ids: their rows, marked submitted or failed afterwards).
type Queued = { text: string; ids: string[] }
// name: the tmux session; terminal: the app's attached view of it; owned: the app started it (it ends when the app quits).
type Chat = {
  name: string; owned: boolean; terminal: string; busy: boolean; transcript: string | null; offset: number
  lastOutput: number; modeReadAt: number; started: number; queue: Queued[]; trustNoted: boolean; slowNoted: boolean
}

// Whether a process still runs (signal 0 checks without touching it).
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // exists, owned by someone else
  }
}

export class ChatManager {
  private chats = new Map<string, Chat>()
  private eventListeners = new Set<(e: ChatEvent) => void>()
  private statusListeners = new Set<(s: ChatStatus) => void>()
  private handoffListeners = new Set<(h: Handoff) => void>()
  private timer: NodeJS.Timeout

  // launch() is read at every start, so saved settings apply to the next start.
  constructor(private db: Store, private launch: (cwd: string) => ClaudeLaunch & { decide: string }, private deps: Deps, private terms: TerminalManager) {
    terms.onData(({ id }) => {
      const c = this.byTerminal(id)
      if (!c) return
      c.chat.lastOutput = Date.now()
    })
    terms.onExit(({ id }) => {
      const c = this.byTerminal(id)
      if (!c) return
      // Detached in the app's view (Ctrl-b d) while the session runs on: attach again.
      if (deps.tmux.has(c.chat.name)) return this.attach(c.session, c.chat)
      this.chats.delete(c.session)
      this.emitStatus(c.session)
    })
    this.timer = setInterval(() => this.tick(), 400)
    // Typing that was cut off when the app last closed never got submitted: show it as not submitted, so Resend appears.
    this.db.prepare("UPDATE messages SET failed = 'typing was cut off (the app closed)' WHERE via = 'terminal' AND delivered_at IS NOT NULL AND submitted_at IS NULL AND failed IS NULL").run()
  }

  onEvent(l: (e: ChatEvent) => void): () => void {
    this.eventListeners.add(l)
    return () => this.eventListeners.delete(l)
  }

  onStatus(l: (s: ChatStatus) => void): () => void {
    this.statusListeners.add(l)
    return () => this.statusListeners.delete(l)
  }

  onHandoff(l: (h: Handoff) => void): () => void {
    this.handoffListeners.add(l)
    return () => this.handoffListeners.delete(l)
  }

  // A new chat is a board session too, so its decisions and reviews land in the same place.
  create(cwd: string, o: { ticket?: string | null; branch?: string | null; title?: string; parent?: string; mode?: string | null; model?: string | null; workflow?: string | null; role?: string | null } = {}): string {
    const id = randomUUID()
    b.touchSession(this.db, id, { cwd, via: 'chat', state: 'starting', title: o.title ?? 'New chat', ticket: o.ticket ?? undefined, branch: o.branch ?? undefined })
    this.db.prepare('UPDATE sessions SET mode = ?, model = ?, parent_id = ?, workflow = ?, role = ? WHERE id = ?').run(o.mode ?? this.deps.settings().defaultMode, o.model ?? null, o.parent ?? null, o.workflow ?? null, o.role ?? null, id)
    return id
  }

  // Resume: an earlier Claude Code conversation becomes a session here, under its own id. Its terminal starts with the
  // first message (claude --resume, since the conversation is saved). A session already on the board is reused.
  resume(id: string, cwd: string, title: string): string {
    const known = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
    if (known) b.setRemoved(this.db, id, false)
    else {
      b.touchSession(this.db, id, { cwd, via: 'chat', state: 'starting', title })
      this.db.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run(this.deps.settings().defaultMode, id)
    }
    return id
  }

  // The window sends here. A message naming another ticket comes back with `ask` and is not sent: the window asks
  // where it should go and sends again with the choice.
  routeAndSend(current: string | null, text: string, folder: string, images: ChatImage[] = [], choice?: RouteChoice): { session: string | null; notice?: string; ask?: RouteAsk } {
    const r = route(this.db, current, text, folder, choice)
    if (r.ask) return { session: current, ask: r.ask }
    const target = r.session ?? this.create(folder, { ticket: r.ticket })
    if (r.session && r.ticket) b.touchSession(this.db, target, { ticket: r.ticket })
    if (r.notice) this.note(target, { type: 'notice', text: r.notice })
    this.send(target, text, images)
    return { session: target, notice: r.notice }
  }

  // The conversation: Claude Code's transcript, plus the app's own notes (route notices, handoff markers), by time.
  history(session: string): Record<string, unknown>[] {
    const s = this.db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(session) as { transcript: string | null } | undefined
    const path = findTranscript(session, s?.transcript ?? null)
    const lines = path ? toChatLines(readNew(path, 0).lines).filter((l) => 'at' in l) : []
    const notes = (this.db.prepare('SELECT event, created_at FROM chat_events WHERE session_id = ? ORDER BY seq').all(session) as { event: string; created_at: string }[])
      .map((r) => ({ ...JSON.parse(r.event), at: r.created_at }))
    return [...lines, ...notes].sort((x, y) => Date.parse(String(x.at)) - Date.parse(String(y.at))) as Record<string, unknown>[]
  }

  status(session: string): ChatStatus {
    const c = this.chats.get(session)
    return { session, running: !!c, busy: !!c?.busy, terminal: c?.terminal ?? null }
  }

  // The chat's terminal, started if needed (to show it, or to type into it).
  terminalOf(session: string): string {
    return (this.chats.get(session) ?? this.start(session)).terminal
  }

  send(session: string, text: string, images: ChatImage[] = []): void {
    if (!text.trim() && !images.length) throw new b.BoardError('message is empty')
    const paths = images.map((i) => this.saveImage(i))
    const message = [text.trim(), ...paths.map((p) => `[image: ${p}]`)].filter(Boolean).join('\n')
    const c = this.chats.get(session) ?? this.start(session)
    const s = this.db.prepare('SELECT title FROM sessions WHERE id = ?').get(session) as { title: string | null }
    if (s.title === 'New chat' && text.trim()) b.touchSession(this.db, session, { title: text.trim().split('\n')[0].slice(0, 60) })
    c.queue.push({ text: message, ids: [] })
    c.busy = true
    this.emitStatus(session)
    this.flush(session, c)
  }

  // How a Terminal window attaches to this session (Open in Terminal). Only while it runs.
  attachArgs(session: string): string[] {
    const s = this.db.prepare('SELECT tmux FROM sessions WHERE id = ?').get(session) as { tmux: string | null } | undefined
    const name = this.chats.get(session)?.name ?? s?.tmux
    if (!name || !this.deps.tmux.has(name)) throw new b.BoardError('this session is not running; send it a message to start it')
    return this.deps.tmux.attachArgs(name)
  }

  // Esc: stops Claude's current turn, as in the terminal. The session keeps running.
  interrupt(session: string): void {
    const c = this.chats.get(session)
    if (c) this.deps.tmux.key(c.name, 'Escape')
  }

  // Shift+Tab: Claude Code's own mode cycle. The mode it lands on is read back from the screen.
  cycleMode(session: string): void {
    this.deps.tmux.key((this.chats.get(session) ?? this.start(session)).name, 'BTab')
  }

  // Model and effort: Claude Code's own commands, typed in.
  command(session: string, line: string): void {
    if (!/^\/(model|effort) [\w.[\]-]+$/.test(line)) throw new b.BoardError(`not a command the chat sends for you: ${line}`)
    this.send(session, line)
  }

  // Continue in a fresh chat with a handoff note built from the board (IDE/D16 B).
  handoff(session: string, reason: 'auto' | 'manual'): string {
    const s = this.db.prepare('SELECT id, title, ticket, branch, cwd, mode, model, context_used, context_window FROM sessions WHERE id = ?').get(session) as
      { id: string; title: string | null; ticket: string | null; branch: string | null; cwd: string; mode: string | null; model: string | null; context_used: number | null; context_window: number | null } | undefined
    if (!s) throw new b.BoardError(`no chat ${session}`)
    if (this.chats.get(session)?.busy) throw new b.BoardError('wait for the current turn to finish, or stop it first')
    const events = this.history(session)
    const prompts = events.filter((e) => e.type === 'prompt').map((e) => String(e.text)).slice(-3)
    const lastReply = [...events].reverse().flatMap((e) => (e.type === 'assistant' ? ((e.message as { content?: { type: string; text?: string }[] }).content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '') : [])).find((t) => t.trim()) ?? ''
    const note = handoffNote(this.db, s, this.deps.files(s.cwd), { prompts, lastReply })
    const title = (s.title ?? 'Chat').replace(/ \(cont\.( \d+)?\)$/, '') + ' (cont.)'
    const to = this.create(s.cwd, { ticket: s.ticket, branch: s.branch, title, parent: s.id, mode: s.mode, model: s.model })
    const pct = s.context_used && s.context_window ? Math.round((100 * s.context_used) / s.context_window) : null
    this.note(session, { type: 'handoff', to, reason, text: reason === 'auto' && pct ? `Context was ${pct}% full, so this continues in a fresh chat.` : 'Continued in a fresh chat.' })
    this.note(to, { type: 'handoff_from', from: session, text: `Continues "${s.title ?? s.id}". The handoff note below came from the board.` })
    this.stop(session)
    b.touchSession(this.db, session, { state: 'done' })
    this.send(to, note)
    this.handoffListeners.forEach((l) => l({ from: session, to, reason }))
    return to
  }

  // Ends the chat's Claude session and its view (the conversation stays saved; opening the chat again resumes it).
  stop(session: string): void {
    const c = this.chats.get(session)
    if (!c) return
    this.chats.delete(session)
    this.deps.tmux.stop(c.name)
    try {
      this.terms.close(c.terminal)
    } catch {
      // the terminal was already closed
    }
    this.emitStatus(session)
  }

  // App quits: sessions it started end; sessions started in a Terminal window keep running there.
  // - Each session stops on its own. One failure is logged and must not block the quit.
  stopAll(): void {
    clearInterval(this.timer)
    for (const [s, c] of [...this.chats]) {
      try {
        if (c.owned) this.stop(s)
        else {
          // Forget it first, so closing the view does not attach again (onExit above).
          this.chats.delete(s)
          this.terms.close(c.terminal)
        }
      } catch (e) {
        console.error(`could not stop session ${s} while quitting:`, e)
      }
    }
  }

  private start(session: string): Chat {
    const s = this.db.prepare('SELECT cwd, mode, model, transcript, title, tmux FROM sessions WHERE id = ?').get(session) as
      { cwd: string; mode: Mode | null; model: string | null; transcript: string | null; title: string | null; tmux: string | null } | undefined
    if (!s) throw new b.BoardError(`no chat ${session}`)
    // Resume when Claude Code has saved this conversation; otherwise start it under the chat's id.
    const saved = findTranscript(session, s.transcript)
    const launch = this.launch(s.cwd)
    const args = [
      ...launch.args,
      ...(saved ? ['--resume', session] : ['--session-id', session]),
      // Only the four normal modes (security-rules.ts); anything else stored for the session starts as default.
      '--permission-mode', s.mode && (MODES as readonly string[]).includes(s.mode) ? s.mode : 'default',
      ...(s.model ? ['--model', s.model] : [])
    ]
    checkClaudeArgs(args) // never a permission-skipping flag or mode (security-rules.ts)
    // A session already running in tmux (started in Terminal, or before a window reload) is attached to, not started twice.
    const live = s.tmux && this.deps.tmux.has(s.tmux) ? s.tmux : null
    const name = live ?? session
    if (!live && !this.deps.tmux.has(name)) {
      this.deps.tmux.start(name, {
        cwd: s.cwd, command: ['claude', ...args], env: { ...launch.env, DECISION_IDE_SESSION: session, DECISION_IDE_TMUX: name },
        unset: SESSION_VARS, cols: 100, rows: 30
      })
    }
    this.db.prepare('UPDATE sessions SET tmux = ? WHERE id = ?').run(name, session)
    const c: Chat = { name, owned: !live || live === session, terminal: '', busy: false, transcript: saved, offset: saved ? readNew(saved, 0).offset : 0, lastOutput: 0, modeReadAt: 0, started: Date.now(), queue: [], trustNoted: false, slowNoted: false }
    this.chats.set(session, c)
    this.attach(session, c)
    return c
  }

  // The app's view of the session: a terminal running `tmux attach`.
  private attach(session: string, c: Chat): void {
    c.terminal = this.terms.spawn({ command: 'tmux', args: this.deps.tmux.attachArgs(c.name), session }).id
    this.emitStatus(session)
  }

  // Types queued messages only once Claude Code is really ready: its SessionStart hook has run (Claude Code runs hooks
  // only after the folder is trusted; the plugin's hook records the transcript path) and the screen has gone quiet.
  // There is no "type anyway" timeout: typing into the trust question would answer it.
  private flush(session: string, c: Chat): void {
    if (!c.queue.length) return
    const now = Date.now()
    const hookRan = !!(this.db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(session) as { transcript: string | null } | undefined)?.transcript
    if (!hookRan) {
      if (!c.trustNoted && TRUST_PROMPT.test(this.deps.tmux.screen(c.name).join('\n'))) {
        c.trustNoted = true
        this.note(session, { type: 'notice', text: 'Claude Code is asking whether to trust this folder. Answer it in the terminal (Terminal button); your message is sent after that.' })
      } else if (!c.slowNoted && !c.trustNoted && now - c.started > SLOW_START_MS) {
        c.slowNoted = true
        this.note(session, { type: 'notice', text: 'Claude Code has not finished starting. Open the terminal to see what it is waiting for; your message is sent once it is ready.' })
      }
      return
    }
    if (!this.quiet(c)) return
    for (const m of c.queue.splice(0)) {
      // Multi-line text is pasted (tmux.type), so line breaks do not send early; then Enter (submit).
      this.deps.tmux.type(c.name, m.text)
      this.submit(session, c, m.text.length, 0, (ok) => {
        if (!m.ids.length) return
        if (ok) b.markSubmitted(this.db, m.ids)
        else b.markFailed(this.db, m.ids, 'typed into the terminal but not submitted')
      })
    }
  }

  // Reads new transcript lines for every running chat and passes them to the window.
  private tick(): void {
    for (const [session, c] of this.chats) {
      // No "is it still running?" check here: each costs a blocking tmux call, and the view's exit (above) already
      // removes a chat whose Claude has ended.
      this.flush(session, c)
      this.readMode(session, c)
      this.deliver(session, c)
      if (!c.transcript) {
        const s = this.db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(session) as { transcript: string | null } | undefined
        c.transcript = findTranscript(session, s?.transcript ?? null)
        if (!c.transcript) continue
      }
      const r = readNew(c.transcript, c.offset)
      c.offset = r.offset
      for (const line of toChatLines(r.lines)) this.onLine(session, c, line)
    }
  }

  // Claude Code takes a moment to take in a paste, and an Enter that arrives meanwhile is swallowed (a 40-line
  // comment stayed in the input box). So: wait longer for longer text, press Enter, and if the text is still in the
  // input box a moment later, press it again (three Enters at most). Dimmed suggestion text does not count as text.
  // done(ok): ok once the input box is empty after an Enter; not ok if text is still there after the last one, or the
  // session ended. Known limit: a dialog covering the input box reads as empty, so it counts as submitted.
  private submit(session: string, c: Chat, size: number, tries: number, done: (ok: boolean) => void = () => {}): void {
    setTimeout(() => {
      if (this.chats.get(session) !== c || !this.deps.tmux.has(c.name)) return done(false)
      this.deps.tmux.key(c.name, 'Enter')
      setTimeout(() => {
        if (this.chats.get(session) !== c) return done(false)
        let stuck: boolean
        try {
          stuck = inputHasText(this.deps.tmux.screenWithoutDim(c.name))
        } catch {
          return done(false) // the session ended meanwhile
        }
        if (!stuck) return done(true)
        if (tries >= 2) return done(false)
        this.submit(session, c, 0, tries + 1, done)
      }, 800)
    }, Math.min(1500, 120 + Math.floor(size / 20)))
  }

  // The screen has gone quiet after the last output: Claude Code is idle at its prompt.
  private quiet(c: Chat): boolean {
    return !!c.lastOutput && Date.now() - c.lastOutput >= READY_QUIET_MS
  }

  // Board messages (from you on the board, or a team member's `signoff done`) are typed into an idle, ready session:
  // its startup hook has run and the screen is quiet. They are taken off the board only then, so a message never
  // waits half-delivered in the app. A busy one gets them from its Stop hook; popping is atomic, so each arrives once.
  private deliver(session: string, c: Chat): void {
    if (c.busy || c.queue.length || !this.quiet(c)) return
    if (!(this.db.prepare('SELECT transcript FROM sessions WHERE id = ?').get(session) as { transcript: string | null } | undefined)?.transcript) return
    const msgs = b.popMessages(this.db, session, 'terminal')
    if (!msgs.length) return
    c.queue.push({ text: msgs.map((m) => `Message from the decision board (${m.by}):\n${m.text}`).join('\n\n'), ids: msgs.map((m) => m.id) })
    c.busy = true
    this.emitStatus(session)
    this.flush(session, c)
  }

  // A board message is waiting for this session (an answer, a question): make sure it can arrive.
  // - running here: it is typed once the session is idle and ready (deliver, above);
  // - in tmux, or a chat the app made: started (resumed) here, then typed once ready;
  // - in a Terminal the app cannot type into, still running: it arrives at the end of its turn (Stop hook).
  wake(session: string): 'running' | 'started' | 'turn-end' {
    if (this.chats.has(session)) return 'running'
    const s = this.db.prepare('SELECT via, tmux, pid FROM sessions WHERE id = ?').get(session) as { via: string | null; tmux: string | null; pid: number | null } | undefined
    if (!s) throw new b.BoardError(`no session ${session}`)
    const inTmux = !!s.tmux && this.deps.tmux.has(s.tmux)
    if (!inTmux && s.via !== 'chat' && s.pid && alive(s.pid)) return 'turn-end'
    this.start(session)
    return 'started'
  }

  // No mode in the footer (a dialog or Claude's question covers it): the last mode read stays.
  // Read only after the screen changed (a mode change redraws the footer), at most once a second: each read is a
  // blocking tmux call, so an idle chat costs nothing.
  private readMode(session: string, c: Chat): void {
    const now = Date.now()
    if (c.lastOutput <= c.modeReadAt || now - c.modeReadAt < 1000) return
    c.modeReadAt = now
    let screen: string[]
    try {
      screen = this.deps.tmux.screen(c.name)
    } catch {
      return // the session ended a moment ago; its view's exit removes the chat
    }
    const mode = footerMode(screen)
    if (mode) this.db.prepare('UPDATE sessions SET mode = ? WHERE id = ? AND mode IS NOT ?').run(mode, session, mode)
  }

  private onLine(session: string, c: Chat, line: ChatLine): void {
    if (line.type === 'title') {
      const s = this.db.prepare('SELECT title FROM sessions WHERE id = ?').get(session) as { title: string | null }
      if (!s.title || s.title === 'New chat') b.touchSession(this.db, session, { title: line.title.slice(0, 80) })
      return
    }
    if (line.type === 'turn_end') {
      c.busy = false
      this.emitStatus(session)
    }
    if (line.type === 'prompt' && !c.busy) {
      c.busy = true // typed straight into the terminal
      this.emitStatus(session)
    }
    if (line.type === 'assistant') {
      const used = contextUsed({ type: 'assistant', message: line.message })
      if (used !== null) setContext(this.db, session, { used })
    }
    this.index(session, line)
    this.emit(session, line)
  }

  // Memory search (feature G) indexes prompts and replies once each.
  private index(session: string, line: ChatLine): void {
    if (line.type !== 'prompt' && line.type !== 'assistant') return
    if (this.db.prepare("SELECT 1 FROM memory WHERE kind = 'chat' AND ref = ?").get(`${session}:${line.uuid}`)) return
    indexChatEvent(this.db, session, line.uuid, line.type === 'prompt' ? { type: 'prompt', text: line.text } : { type: 'assistant', message: line.message as never }, line.at)
  }

  private saveImage(i: ChatImage): string {
    const ext = IMAGE_EXT[i.mediaType]
    if (!ext) throw new b.BoardError(`images can be PNG, JPEG, GIF or WebP, not ${i.mediaType}`)
    if (i.data.length * 0.75 > MAX_IMAGE_BYTES) throw new b.BoardError('an image is over 5 MB')
    mkdirSync(this.deps.attachments, { recursive: true })
    const p = join(this.deps.attachments, `${randomUUID()}.${ext}`)
    writeFileSync(p, Buffer.from(i.data, 'base64'))
    return p
  }

  // The app's own notes in a chat (not part of Claude's conversation).
  private note(session: string, event: Record<string, unknown>): void {
    const next = (this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM chat_events WHERE session_id = ?').get(session) as { n: number }).n
    const at = b.now()
    this.db.prepare('INSERT INTO chat_events (session_id, seq, event, created_at) VALUES (?, ?, ?, ?)').run(session, next, JSON.stringify(event), at)
    this.emit(session, { ...event, at })
  }

  private byTerminal(id: string): { session: string; chat: Chat } | null {
    for (const [session, chat] of this.chats) if (chat.terminal === id) return { session, chat }
    return null
  }

  private emitStatus(session: string): void {
    const s = this.status(session)
    this.statusListeners.forEach((l) => l(s))
  }

  private emit(session: string, event: Record<string, unknown>): void {
    this.eventListeners.forEach((l) => l({ session, event }))
  }
}
