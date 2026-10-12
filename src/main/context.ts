// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

import type { Store } from './store'

// Context handling (IDE/D16 B): how full a chat is, the handoff note for a fresh chat, and same-or-new-chat routing.
// The handoff note is built from the board, not by Claude, so it costs no tokens and loses no decisions.

type Usage = { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }

// Tokens in context after a main-thread assistant message (subagent messages have their own context).
export function contextUsed(ev: Record<string, unknown>): number | null {
  if (ev.type !== 'assistant' || ev.parent_tool_use_id) return null
  const u = (ev.message as { usage?: Usage } | undefined)?.usage
  if (!u) return null
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
}

// The largest window among the models the turn used: the main model's, since subagents use smaller ones or the same.
export function contextWindow(ev: Record<string, unknown>): number | null {
  if (ev.type !== 'result') return null
  const sizes = Object.values((ev.modelUsage ?? {}) as Record<string, { contextWindow?: number }>).map((m) => m.contextWindow ?? 0)
  return sizes.length ? Math.max(...sizes) || null : null
}

type SessionRow = { id: string; title: string | null; ticket: string | null; branch: string | null; cwd: string }

export function handoffNote(db: Store, from: SessionRow, files: string[], recent: { prompts: string[]; lastReply: string }): string {
  const decisions = from.ticket
    ? (db.prepare('SELECT id, status, level, question, answer FROM decisions WHERE ticket = ? ORDER BY created_at, rowid').all(from.ticket) as { id: string; status: string; level: string; question: string; answer: string | null }[])
    : []
  const reviews = db.prepare("SELECT id, title FROM reviews WHERE session_id = ? AND status = 'open'").all(from.id) as { id: string; title: string }[]
  const lines = [
    `You are continuing the work of the chat "${from.title ?? from.id}" (${from.id}), whose context was nearly full.`,
    'Everything below comes from the decision board, so it is complete. Settled decisions stay settled: do not re-ask them.',
    'Re-read any file you need before changing it.',
    '',
    `Folder: ${from.cwd}`,
    ...(from.branch ? [`Branch: ${from.branch}`] : []),
    ...(from.ticket ? [`Ticket: ${from.ticket}`] : []),
    '',
    '## Decisions on this ticket',
    ...(decisions.length ? decisions.map((d) => `- ${d.id} [${d.status}${d.level !== 'ask' ? ' · ' + d.level : ''}] ${d.question}${d.answer ? ` -> ${d.answer}` : ''}`) : ['- none']),
    '',
    '## Waiting on the user',
    ...(reviews.length ? reviews.map((r) => `- review ${r.id}: ${r.title}`) : []),
    ...decisions.filter((d) => d.status === 'open').map((d) => `- decision ${d.id}`),
    ...(!reviews.length && !decisions.some((d) => d.status === 'open') ? ['- nothing'] : []),
    '',
    '## Uncommitted files',
    ...(files.length ? files.map((f) => `- ${f}`) : ['- none']),
    '',
    '## The last requests from the user',
    ...recent.prompts.map((p) => `- ${p.replace(/\s+/g, ' ').slice(0, 400)}`),
    '',
    '## Your last reply in the old chat',
    recent.lastReply.slice(0, 1500) || '(none)',
    '',
    'Carry on from there. Start by saying in one or two lines where things stand.'
  ]
  return lines.join('\n')
}

// Issue keys the user typed (upper case only, so "utf-8" or "sha-256" never match).
export const issueKeys = (text: string): string[] => [...new Set([...text.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g)].map((m) => m[1]))]

// A message naming another ticket than the chat's: the user chooses where it goes (nothing is sent until then).
// - here: stay in this chat; existing: the chat already on that ticket; new: a new chat for it.
export type RouteChoice = 'here' | 'existing' | 'new'
export type RouteAsk = { key: string; current: string | null; existing: string | null }
export type Route = { session: string | null; ticket?: string; notice?: string; ask?: RouteAsk }

// Same chat, a chat without a ticket adopting it, or (another ticket) whatever the user picks.
export function route(db: Store, current: string | null, text: string, folder: string, choice?: RouteChoice): Route {
  const keys = issueKeys(text)
  const cur = current ? (db.prepare('SELECT id, ticket FROM sessions WHERE id = ?').get(current) as { id: string; ticket: string | null } | undefined) : undefined
  const existing = (key: string): string | undefined =>
    (db.prepare("SELECT id FROM sessions WHERE via = 'chat' AND cwd = ? AND ticket = ? AND archived = 0 ORDER BY updated_at DESC").get(folder, key) as { id: string } | undefined)?.id
  if (!keys.length) return { session: current }
  if (cur?.ticket && keys.includes(cur.ticket)) return { session: current }
  if (cur && !cur.ticket) return { session: current, ticket: keys[0] }
  const key = keys[0]
  const found = existing(key)
  const other = found && found !== current ? found : null
  // A new chat with no chat on that ticket yet: nothing to choose.
  if (!cur && !other) return { session: null, ticket: key }
  if (choice === 'here' && cur) return { session: current }
  if (choice === 'existing' && other) return { session: other, notice: `Moved here from ${cur ? `the ${cur.ticket} chat` : 'a new chat'}: you chose the chat already working on ${key}.` }
  if (choice === 'new') return { session: null, ticket: key, notice: `You started a new chat for ${key}${cur ? ` (from the ${cur.ticket} chat)` : ''}.` }
  return { session: current, ask: { key, current: cur?.ticket ?? null, existing: other } }
}

export const setContext = (db: Store, session: string, f: { used?: number; window?: number }): void => {
  if (f.used !== undefined) db.prepare('UPDATE sessions SET context_used = ? WHERE id = ?').run(f.used, session)
  if (f.window !== undefined) db.prepare('UPDATE sessions SET context_window = ? WHERE id = ?').run(f.window, session)
}

