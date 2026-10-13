// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Turns stored chat events (Claude stream-json plus our own prompt/error events) into rows to render.
export type ToolRow = { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }
export type Row =
  | { kind: 'prompt'; text: string; images?: number }
  | { kind: 'handoff-note'; text: string }
  | { kind: 'notice'; text: string; link?: { to: string; label: string } }
  | { kind: 'text'; text: string }
  | ToolRow
  | { kind: 'result'; text: string; isError: boolean }
  | { kind: 'error'; text: string }

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean }
type Ev = { type?: string; subtype?: string; text?: string; kind?: string; images?: number; ms?: number | null; to?: string; from?: string; message?: { content?: Block[] | string }; is_error?: boolean; duration_ms?: number; total_cost_usd?: number; result?: string; parent_tool_use_id?: string | null }

const resultText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x.text ?? '').join('\n') : ''

// Text pasted into Claude Code arrives wrapped in <pasted_content id="…"> tags; show just the text.
export const unwrapPasted = (t: string): string => t.replace(/<pasted_content id="[^"]*">\n?([\s\S]*?)\n?<\/pasted_content id="[^"]*">/g, '$1')

export function toRows(events: Ev[]): Row[] {
  const rows: Row[] = []
  const tools = new Map<string, ToolRow>()
  let textSincePrompt = false
  for (const e of events) {
    if (e.parent_tool_use_id) continue // subagent internals stay folded into the Agent tool row
    if (e.type === 'prompt') {
      // Claude Code saves slash commands, their output and ! shell commands as tagged user lines.
      const t = e.text ?? ''
      const out = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(t) ?? /<bash-stdout>([\s\S]*?)<\/bash-stdout>/.exec(t)
      const cmd = /<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>)?/.exec(t)
      const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(t)
      if (out) { if (out[1].trim()) rows.push({ kind: 'text', text: '```\n' + out[1].trim() + '\n```' }) }
      else if (cmd) rows.push({ kind: 'prompt', text: `${cmd[1]}${cmd[2] ? ' ' + cmd[2] : ''}` })
      else if (bash) rows.push({ kind: 'prompt', text: '! ' + bash[1] })
      else rows.push(e.kind === 'handoff' ? { kind: 'handoff-note', text: t } : { kind: 'prompt', text: unwrapPasted(t), ...(e.images ? { images: e.images } : {}) })
      textSincePrompt = false
    }
    else if (e.type === 'turn_end') rows.push({ kind: 'result', text: typeof e.ms === 'number' ? `Done in ${(e.ms / 1000).toFixed(1)}s` : 'Done', isError: false })
    else if (e.type === 'system' && e.subtype === 'compact_boundary') rows.push({ kind: 'notice', text: 'Conversation compacted: earlier messages are now a summary.' })
    else if (e.type === 'notice') rows.push({ kind: 'notice', text: e.text ?? '' })
    else if (e.type === 'handoff') rows.push({ kind: 'notice', text: e.text ?? '', link: { to: e.to!, label: 'Open the new chat →' } })
    else if (e.type === 'handoff_from') rows.push({ kind: 'notice', text: e.text ?? '', link: { to: e.from!, label: '← Open the old chat' } })
    else if (e.type === 'error') rows.push({ kind: 'error', text: e.text ?? '' })
    else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const b of e.message!.content as Block[]) {
        if (b.type === 'text' && b.text?.trim()) {
          rows.push({ kind: 'text', text: b.text })
          textSincePrompt = true
        }
        if (b.type === 'tool_use' && b.id) {
          const t: ToolRow = { kind: 'tool', id: b.id, name: b.name ?? 'tool', input: b.input ?? {} }
          tools.set(b.id, t)
          rows.push(t)
        }
      }
    } else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const b of e.message!.content as Block[]) {
        const t = b.type === 'tool_result' && b.tool_use_id ? tools.get(b.tool_use_id) : undefined
        if (t) {
          t.result = resultText(b.content)
          t.isError = !!b.is_error
        }
      }
    } else if (e.type === 'result') {
      // Commands like /context or /usage answer only in the result: show that text as the reply.
      if (!textSincePrompt && !e.is_error && typeof e.result === 'string' && e.result.trim()) rows.push({ kind: 'text', text: e.result })
      textSincePrompt = false
      const secs = e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : ''
      const cost = typeof e.total_cost_usd === 'number' ? ` · est. $${e.total_cost_usd.toFixed(2)} so far` : ''
      rows.push({ kind: 'result', text: e.is_error ? `Stopped: ${e.result || e.subtype}` : `Done in ${secs}${cost}`, isError: !!e.is_error })
    }
  }
  return rows
}

// One line that says what a tool call does.
export function toolSummary(name: string, input: Record<string, unknown>): string {
  const s = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Bash': return s('command')
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return s('file_path')
    case 'Grep': return `${s('pattern')}${s('path') ? ' in ' + s('path') : ''}`
    case 'Glob': return s('pattern')
    case 'WebFetch': return s('url')
    case 'WebSearch': return s('query')
    case 'Agent': case 'Task': return s('description') || s('prompt').slice(0, 80)
    case 'Skill': return s('skill')
    default: return Object.values(input).filter((v) => typeof v === 'string').join(' ').slice(0, 100)
  }
}

// Claude's task list: the latest TodoWrite call in the main conversation (Claude Code shows the same list).
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }
export function latestTodos(events: { type?: string; parent_tool_use_id?: string | null; message?: { content?: unknown } }[]): Todo[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'assistant' || e.parent_tool_use_id || !Array.isArray(e.message?.content)) continue
    const t = (e.message!.content as { type: string; name?: string; input?: { todos?: Todo[] } }[]).find((b) => b.type === 'tool_use' && b.name === 'TodoWrite')
    if (t?.input?.todos) return t.input.todos
  }
  return []
}

// A question or plan Claude is showing in the terminal right now (asked with a tool that has no answer yet).
// The PermissionRequest hook does not cover these, so the user answers them in the terminal.
export type Waiting = { kind: 'question' | 'plan'; text: string }
export function waitingInTerminal(events: { type?: string; message?: { content?: unknown } }[]): Waiting | null {
  const answered = new Set<string>()
  for (const e of events) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const b of e.message!.content as { type: string; tool_use_id?: string }[]) if (b.type === 'tool_result' && b.tool_use_id) answered.add(b.tool_use_id)
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    for (const b of e.message!.content as { type: string; id?: string; name?: string; input?: { questions?: { question: string }[]; plan?: string } }[]) {
      if (b.type !== 'tool_use' || !b.id || answered.has(b.id)) continue
      if (b.name === 'AskUserQuestion') return { kind: 'question', text: (b.input?.questions ?? []).map((q) => q.question).join(' / ') }
      if (b.name === 'ExitPlanMode') return { kind: 'plan', text: b.input?.plan ?? '' }
    }
  }
  return null
}

// One steps row per turn, right under your message: every tool call of that turn, counted by kind, with the one
// running now while the turn goes on. What Claude writes shows below it, in order and in real time.
export type StepsRow = { kind: 'steps'; steps: ToolRow[]; live: boolean }
export type Shown = Row | StepsRow

export function foldTurns(rows: Row[]): Shown[] {
  const out: Shown[] = []
  let group: StepsRow | null = null
  let turnStart = 0 // where this turn's steps row goes: just after your message
  for (const r of rows) {
    if (r.kind === 'tool') {
      if (!group) { group = { kind: 'steps', steps: [], live: true }; out.splice(turnStart, 0, group) }
      group.steps.push(r)
      continue
    }
    if (r.kind === 'result' && group) group.live = false
    out.push(r)
    if (r.kind === 'prompt' || r.kind === 'result') {
      if (group) group.live = false
      group = null
      turnStart = out.length
    }
  }
  return out
}

// "14 steps · 8 commands · 4 reads · 2 edits": what a folded turn did, by kind of tool.
const KIND: [RegExp, string, string][] = [[/^Bash$/, 'command', 'commands'], [/^(Read|Glob|Grep|LS)$/, 'read', 'reads'], [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'edit', 'edits'], [/^(WebFetch|WebSearch)$/, 'web look-up', 'web look-ups']]
export function stepsSummary(steps: ToolRow[]): string {
  const counts = new Map<string, number>()
  let other = 0
  for (const s of steps) {
    const k = KIND.find(([re]) => re.test(s.name))
    if (k) counts.set(k[1], (counts.get(k[1]) ?? 0) + 1)
    else other++
  }
  const parts = KIND.filter(([, one]) => counts.get(one)).map(([, one, many]) => `${counts.get(one)} ${counts.get(one) === 1 ? one : many}`)
  if (other) parts.push(`${other} other`)
  return [`${steps.length} step${steps.length === 1 ? '' : 's'}`, ...parts].join(' · ')
}
