// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Reads Claude Code's saved conversation (the session's transcript JSONL) for the chat panel.
// - The format is Claude Code's own and not formally documented: everything that depends on it is in this file.
// - Only what the chat shows is kept: the user's messages, Claude's messages, tool results, turn ends,
//   Claude's title for the chat. Subagent lines (isSidechain) and injected context (isMeta) are skipped.

export type ChatLine =
  | { type: 'prompt'; text: string; images?: number; at: string; uuid: string }
  | { type: 'assistant'; message: unknown; at: string; uuid: string }
  | { type: 'user'; message: unknown; at: string; uuid: string }
  | { type: 'turn_end'; ms: number | null; at: string; uuid: string }
  | { type: 'title'; title: string }
  | { type: 'notice'; text: string; at: string; uuid: string }

type Raw = {
  type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; isSidechain?: boolean; subtype?: string
  message?: { content?: string | { type: string; text?: string }[] }; aiTitle?: string; durationMs?: number
  origin?: { kind?: string }
}

export function toChatLines(lines: Raw[]): ChatLine[] {
  const out: ChatLine[] = []
  for (const e of lines) {
    const at = e.timestamp ?? ''
    const uuid = e.uuid ?? `${e.type}:${at}:${out.length}`
    if (e.type === 'ai-title' && e.aiTitle) out.push({ type: 'title', title: e.aiTitle })
    else if (e.type === 'system' && e.subtype === 'turn_duration') out.push({ type: 'turn_end', ms: typeof e.durationMs === 'number' ? e.durationMs : null, at, uuid })
    else if (e.isMeta || e.isSidechain) continue
    else if (e.type === 'assistant' && e.message) out.push({ type: 'assistant', message: e.message, at, uuid })
    // Claude Code's notice that a background task finished (e.g. a `signoff wait`) is saved as a user line; it is not
    // something you typed, so it shows as a one-line note: "Background task finished: <its summary>".
    else if (e.type === 'user' && e.origin?.kind === 'task-notification') {
      const c = e.message?.content
      const raw = typeof c === 'string' ? c : (c ?? []).map((b) => b.text ?? '').join('\n')
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(raw)?.[1]?.trim()
      out.push({ type: 'notice', text: `Background task finished${summary ? `: ${summary.replace(/^Background command /, '')}` : ''}`, at, uuid })
    }
    else if (e.type === 'user' && e.message) {
      const c = e.message.content
      if (typeof c === 'string') {
        if (c.trim()) out.push({ type: 'prompt', text: c, at, uuid })
      } else if (Array.isArray(c)) {
        const text = c.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
        const images = c.filter((b) => b.type === 'image').length
        if (c.some((b) => b.type === 'tool_result')) out.push({ type: 'user', message: e.message, at, uuid })
        else if (text.trim() || images) out.push({ type: 'prompt', text, ...(images ? { images } : {}), at, uuid })
      }
    }
  }
  return out
}

// Incremental read: only bytes after `offset`, and only complete lines (a line being written stays for next time).
export function readNew(path: string, offset: number): { lines: Raw[]; offset: number } {
  if (!existsSync(path)) return { lines: [], offset }
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    if (size < offset) offset = 0 // the file was replaced: read it again from the start
    if (size === offset) return { lines: [], offset }
    const buf = Buffer.alloc(size - offset)
    readSync(fd, buf, 0, buf.length, offset)
    const text = buf.toString('utf8')
    const end = text.lastIndexOf('\n')
    if (end < 0) return { lines: [], offset }
    const lines: Raw[] = []
    for (const l of text.slice(0, end).split('\n')) {
      try {
        if (l.trim()) lines.push(JSON.parse(l))
      } catch {
        // a line Claude Code wrote in a format we do not read: skip it
      }
    }
    return { lines, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) }
  } finally {
    closeSync(fd)
  }
}

// Where the transcript is: the path the SessionStart hook recorded, else <id>.jsonl in Claude Code's project folders.
export function findTranscript(session: string, recorded: string | null, home = homedir()): string | null {
  if (recorded && existsSync(recorded)) return recorded
  const root = join(home, '.claude', 'projects')
  if (!existsSync(root)) return null
  for (const d of readdirSync(root)) {
    const p = join(root, d, `${session}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

// Conversations Claude Code saved for a folder, newest first (what `claude --resume` lists), for Resume in the app.
// - Claude Code keeps them in ~/.claude/projects/<the folder's real path, non-alphanumerics as '-'>/<id>.jsonl.
// - The title is Claude's own (ai-title), else the first message. Only the first 256 KB of each file is read.
export type Conversation = { id: string; title: string; at: string }
const HEAD_BYTES = 256 * 1024

export function listConversations(folder: string, home = homedir(), limit = 50): Conversation[] {
  const dir = join(home, '.claude', 'projects', realpathSync(folder).replace(/[^a-zA-Z0-9]/g, '-'))
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, mtime: statSync(join(dir, f)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, limit)
  return files.flatMap(({ f, mtime }) => {
    const fd = openSync(join(dir, f), 'r')
    let text: string
    try {
      const buf = Buffer.alloc(Math.min(HEAD_BYTES, fstatSync(fd).size))
      readSync(fd, buf, 0, buf.length, 0)
      text = buf.toString('utf8')
    } finally {
      closeSync(fd)
    }
    const raw = text.split('\n').slice(0, -1).flatMap((l) => {
      try { return [JSON.parse(l) as Raw] } catch { return [] } // a line cut at the 256 KB mark
    })
    const lines = toChatLines(raw)
    const title = lines.find((l) => l.type === 'title') as { title: string } | undefined
    const first = lines.find((l) => l.type === 'prompt') as { text: string } | undefined
    if (!title && !first) return [] // nothing was ever said in it
    return [{ id: f.slice(0, -'.jsonl'.length), title: (title?.title ?? first!.text).split('\n')[0].slice(0, 80), at: mtime.toISOString() }]
  })
}

// Files a session edited or wrote (Edit, Write, MultiEdit, NotebookEdit), in the order first touched. Absolute paths.
// - Files changed only through shell commands (sed, mv, generators) are not seen here.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export function editedFiles(path: string): string[] {
  const files = new Set<string>()
  for (const e of readNew(path, 0).lines) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    for (const b of e.message!.content as { type: string; name?: string; input?: { file_path?: string; notebook_path?: string } }[]) {
      const f = b.type === 'tool_use' && b.name && EDIT_TOOLS.has(b.name) ? b.input?.file_path ?? b.input?.notebook_path : undefined
      if (f) files.add(f)
    }
  }
  return [...files]
}

// Folders a session worked in through the shell: `cd /x`, `git -C /x`, `git worktree add … /x`. Changes made there by
// commands (patch, git apply, cp) never show as Edit or Write, so Files changed would miss that repo (SIGNOFF-19/D1).
// Only commands that change files count (patch, git apply/commit/add, cp, mv, rm, sed -i, tee, a > redirect), so a
// repo the session only looked into is left out. Only absolute or ~ paths; a variable or glob is skipped.
const WRITES = /\b(git\s+(apply|commit|add|am|cherry-pick|mv|rm|restore|stash\s+pop|worktree\s+add)|patch|cp|mv|rm|tee)\b|\bsed\s+-i|[^>&2]>{1,2}\s*[^&\s]/
export function shellDirs(path: string, home = homedir()): string[] {
  const dirs = new Set<string>()
  const take = (raw: string): void => {
    const p = raw.replace(/^['"]|['"]$/g, '')
    if (/[$*?`]/.test(p) || !(p.startsWith('/') || p.startsWith('~/'))) return
    dirs.add(p.startsWith('~/') ? join(home, p.slice(2)) : p)
  }
  for (const e of readNew(path, 0).lines) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue
    for (const b of e.message!.content as { type: string; name?: string; input?: { command?: string } }[]) {
      const cmd = b.type === 'tool_use' && b.name === 'Bash' ? b.input?.command : undefined
      if (!cmd || !WRITES.test(cmd)) continue
      for (const m of cmd.matchAll(/(?:^|[\s;&|(])cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)) take(m[1])
      for (const m of cmd.matchAll(/\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)) take(m[1])
      for (const m of cmd.matchAll(/\bgit\s+worktree\s+add\s+([^;&|\n]+)/g)) m[1].split(/\s+/).forEach(take)
    }
  }
  return [...dirs]
}
