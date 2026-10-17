// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { ChatManager, footerMode, inputHasText } from '../chat'
import { DEFAULTS, type Settings } from '../settings'
import { openStore, type Store } from '../store'
import { TerminalManager } from '../terminals'
import { proposeSplit } from '../../shared/team'
import { Teams } from '../teams'
import { Tmux } from '../tmux'
import { execFileSync } from 'child_process'
import { mkdirSync, realpathSync } from 'fs'
import { answerFromBoard, postDecision, queueMessage } from '../../shared/board'

// A fake interactive `claude` on PATH, run in a real terminal: it reads keystrokes, writes a transcript
// to $HOME/.claude/projects/p/<id>.jsonl the way Claude Code does (user, assistant, turn_duration lines)
// and draws the mode footer under its prompt.
const FAKE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const a = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + '\\n')
const resume = a.includes('--resume')
const sid = a[a.indexOf(resume ? '--resume' : '--session-id') + 1]
const file = path.join(process.env.HOME, '.claude', 'projects', 'p', sid + '.jsonl')
if (resume && !fs.existsSync(file)) { process.stderr.write('No conversation found with session ID: ' + sid + '\\n'); process.exit(1) }
fs.mkdirSync(path.dirname(file), { recursive: true })
const line = (o) => fs.appendFileSync(file, JSON.stringify({ sessionId: sid, timestamp: new Date().toISOString(), uuid: Math.random().toString(36).slice(2), ...o }) + '\\n')
const footers = ['\\u23f8 manual mode on \\u00b7 ? for shortcuts', '\\u23f5\\u23f5 accept edits on (shift+tab to cycle)', '\\u23f8 plan mode on (shift+tab to cycle)']
let mode = 0, trusting = process.env.FAKE_TRUST === '1', buf = '', menuOn = false, sel = 0
const prompt = () => process.stdout.write('\\r\\n> \\r\\n' + footers[mode] + '\\r\\n')
process.stdin.setRawMode(true)
// Like Claude Code: ask for bracketed paste, so a pasted message with line breaks arrives as one.
process.stdout.write('\\x1b[?2004h')
if (trusting) process.stdout.write('\\x1b[1mQuick\\x1b[1Csafety\\x1b[1Ccheck:\\x1b[0m Is this a project you created? \\u276fNo, exit  Yes, I trust this folder\\r\\n')
else prompt()
process.stdin.on('data', (d) => {
  let s = d.toString()
  // After the answer Claude Code redraws its whole screen (welcome box, tips, prompt).
  if (trusting) { if (s.includes('\\r')) { trusting = false; process.stdout.write('Welcome to Claude Code\\r\\n' + 'tip: '.repeat(60)); prompt() } return }
  if (s === '\\x1b[Z') { mode = (mode + 1) % footers.length; prompt(); return }
  if (s === '\\x1b') { fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ key: 'esc' }) + '\\n'); return }
  // FAKE_MENU: like a permission prompt left to the terminal: a numbered menu answered with arrows and Enter.
  if (menuOn) {
    for (const k of s.match(/\\x1b\\[[AB]|\\r/g) ?? []) {
      if (k === '\\x1b[B') sel = Math.min(2, sel + 1)
      else if (k === '\\x1b[A') sel = Math.max(0, sel - 1)
      else { menuOn = false; fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ chose: sel }) + '\\n'); finish('chose ' + sel); return }
    }
    drawMenu(); return
  }
  // Inside a bracketed paste, line breaks (tmux sends them as \\r) are text, not Enter.
  buf += s.replace(/\\x1b\\[200~([\\s\\S]*?)\\x1b\\[201~/g, (_, p) => p.replace(/\\r/g, '\\n'))
  if (!buf.includes('\\r')) return
  const text = buf.split('\\r')[0]; buf = ''
  line({ type: 'user', message: { role: 'user', content: text } })
  if (process.env.FAKE_MENU === '1') { menuOn = true; sel = 0; drawMenu(); return }
  finish(text)
})
function finish(text) {
  // FAKE_TITLE: Claude Code names the chat after its first answer (an ai-title line).
  if (process.env.FAKE_TITLE) line({ type: 'ai-title', aiTitle: process.env.FAKE_TITLE })
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'echo: ' + text.slice(0, 60) }], usage: { input_tokens: 5, cache_read_input_tokens: 95 } } })
  line({ type: 'system', subtype: 'turn_duration', durationMs: 12 })
  process.stdout.write('\\x1b[2J\\x1b[Hdone'); prompt()
}
function drawMenu() {
  const opts = ['Yes', "Yes, and don't ask again", 'No, and tell Claude what to do differently (esc)']
  process.stdout.write('\\x1b[2J\\x1b[H Bash command\\r\\n   rm -rf tmp\\r\\n\\r\\n Do you want to proceed?\\r\\n' + opts.map((o, i) => (i === sel ? ' \\u276f ' : '   ') + (i + 1) + '. ' + o).join('\\r\\n') + '\\r\\n')
}
`

let db: Store
let chat: ChatManager
let terms: TerminalManager
let log: string
let dir: string
// A tmux server per test: it keeps the environment (PATH with the fake claude, HOME) of the test that started it.
let socket: string
let tmux: Tmux
let n = 0
const env = { PATH: process.env.PATH, HOME: process.env.HOME }
let settings: Settings
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tchat-'))
  writeFileSync(join(dir, 'claude'), FAKE)
  chmodSync(join(dir, 'claude'), 0o755)
  log = join(dir, 'log.jsonl')
  writeFileSync(log, '')
  process.env.PATH = `${dir}:${env.PATH}`
  process.env.HOME = dir
  process.env.FAKE_LOG = log
  delete process.env.FAKE_TRUST
  db = openStore(join(dir, 'board.db'))
  terms = new TerminalManager()
  settings = { ...DEFAULTS }
  socket = `dide-chat-${process.pid}-${n++}`
  tmux = new Tmux(join(__dirname, '../../../resources/tmux.conf'), socket)
  chat = new ChatManager(db, () => ({ args: ['--plugin-dir', '/p'], env: { DECISION_IDE_DB: 'x' }, decide: '/bin/decide' }), { settings: () => settings, files: () => ['a.rb'], attachments: join(dir, 'att'), tmux }, terms)
})
afterEach(() => {
  chat.stopAll()
  terms.closeAll()
  try { execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* already gone */ }
  process.env.PATH = env.PATH
  process.env.HOME = env.HOME
})

const until = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 50))
  }
}
const logged = (): unknown[] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const argv = (): string[][] => logged().filter((x) => Array.isArray(x)) as string[][]
// Stands in for the plugin's SessionStart hook, which records the transcript path once Claude Code is past trust.
const hookRuns = (id: string): void => {
  db.prepare('UPDATE sessions SET transcript = ? WHERE id = ?').run(join(dir, '.claude/projects/p', id + '.jsonl'), id)
}
const said = (id: string): string[] => chat.history(id).flatMap((e) =>
  e.type === 'prompt' ? [`> ${e.text}`] : e.type === 'assistant' ? [((e.message as { content: { text: string }[] }).content[0].text)] : [])

describe('terminal chats', () => {
  it('a new chat runs claude in a terminal with --session-id; the message is typed in and the reply comes from the transcript', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    chat.send(id, 'hello there')
    expect(chat.status(id)).toMatchObject({ running: true, busy: true })
    await until(() => said(id).length === 2)
    expect(said(id)).toEqual(['> hello there', 'echo: hello there'])
    await until(() => !chat.status(id).busy)
    expect(argv()[0]).toEqual(['--plugin-dir', '/p', '--session-id', id, '--permission-mode', 'default'])
    expect(db.prepare('SELECT title, context_used FROM sessions WHERE id = ?').get(id)).toEqual({ title: 'hello there', context_used: 100 })
  })

  it('new and resumed chats start in the default mode from Settings; an asked-for mode wins', () => {
    settings.defaultMode = 'acceptEdits'
    const fresh = chat.create('/tmp')
    const asked = chat.create('/tmp', { mode: 'plan' })
    const resumed = chat.resume('11111111-1111-4111-8111-111111111111', '/tmp', 'Old chat')
    const mode = (id: string): string => (db.prepare('SELECT mode FROM sessions WHERE id = ?').get(id) as { mode: string }).mode
    expect([mode(fresh), mode(asked), mode(resumed)]).toEqual(['acceptEdits', 'plan', 'acceptEdits'])
  })

  it("Claude's short title replaces the first-line stand-in, but never a title you chose", async () => {
    process.env.FAKE_TITLE = 'Gift card refunds'
    onTestFinished(() => { delete process.env.FAKE_TITLE })
    const title = (id: string): string | null => (db.prepare('SELECT title FROM sessions WHERE id = ?').get(id) as { title: string | null }).title
    const a = chat.create('/tmp')
    hookRuns(a)
    chat.send(a, 'please look at why refunds on gift cards fail for partial orders and fix it')
    expect(title(a)).toBe('please look at why refunds on gift cards fail for partial or')
    await until(() => title(a) === 'Gift card refunds')

    const b2 = chat.create('/tmp')
    hookRuns(b2)
    chat.send(b2, 'second chat')
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run('My own name', b2) // a rename, as the sidebar does
    await until(() => !chat.status(b2).busy)
    expect(title(b2)).toBe('My own name')
  })

  it('a menu Claude Code shows in the terminal reaches the chat as waiting, not working, and can be answered from it', async () => {
    process.env.FAKE_MENU = '1'
    onTestFinished(() => { delete process.env.FAKE_MENU })
    const id = chat.create('/tmp')
    hookRuns(id)
    chat.send(id, 'clean up')
    await until(() => chat.status(id).menu !== null)
    expect(chat.status(id).menu).toEqual({
      question: 'Do you want to proceed?', detail: ['Bash command', 'rm -rf tmp'],
      options: ['Yes', "Yes, and don't ask again", 'No, and tell Claude what to do differently (esc)'], selected: 0
    })
    expect(() => chat.choose(id, 'Another question?', 1)).toThrow('the terminal no longer shows that question')
    chat.choose(id, 'Do you want to proceed?', 1)
    await until(() => readFileSync(log, 'utf8').includes('{"chose":1}'))
    await until(() => chat.status(id).menu === null && !chat.status(id).busy)
  })

  it('picking a mode presses ⇧Tab until the footer shows it; model and effort are kept on the session', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    chat.send(id, 'hi')
    await until(() => !chat.status(id).busy)
    const row = (): unknown => db.prepare('SELECT mode, model, effort FROM sessions WHERE id = ?').get(id)
    await chat.setMode(id, 'plan')
    expect((row() as { mode: string }).mode).toBe('plan')
    // The fake has no Auto in its cycle, like a model without it: a clear error instead of pressing forever.
    await expect(chat.setMode(id, 'auto')).rejects.toThrow('Claude Code did not switch to that mode')
    chat.command(id, '/model sonnet')
    chat.command(id, '/effort high')
    expect(row()).toMatchObject({ model: 'sonnet', effort: 'high' })
  })

  it('a session started from a team setup records it', () => {
    const id = chat.create('/tmp', { workflow: 'implement-review' })
    expect(db.prepare('SELECT workflow, via FROM sessions WHERE id = ?').get(id)).toEqual({ workflow: 'implement-review', via: 'chat' })
  })

  it('an approved split starts one terminal session per kept piece: implementers in their own worktree, each told its piece', async () => {
    mkdirSync(join(dir, 'repo'))
    const repo = realpathSync(join(dir, 'repo')) // git reports /private/var..., not /var...
    const g = (...a: string[]): string => execFileSync('git', a, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim()
    g('init', '-q', '-b', 'KA-1-pay'); g('commit', '-q', '--allow-empty', '-m', 'start')
    const lead = chat.create(repo, { workflow: 'parallel', ticket: 'KA-1' })
    const d = proposeSplit(db, { session: lead, ticket: 'KA-1', number: 'D1', pieces: [{ title: 'API', task: 'add the endpoint' }, { title: 'UI', task: 'add the form' }] })
    const kids = await new Teams(db, chat).start(d, [0, 2])
    expect(db.prepare('SELECT title, role, cwd, branch, base_branch FROM sessions WHERE parent_id = ? ORDER BY title').all(lead)).toEqual([
      { title: 'API', role: 'implementer', cwd: join(repo, '.claude/worktrees/KA-1-pay-api'), branch: 'KA-1-pay-api', base_branch: 'KA-1-pay' },
      { title: 'reviewer', role: 'reviewer', cwd: repo, branch: 'KA-1-pay', base_branch: null }
    ])
    expect(g('worktree', 'list', '--porcelain').match(/^branch refs\/heads\/.+$/gm)).toEqual(['branch refs/heads/KA-1-pay', 'branch refs/heads/KA-1-pay-api'])
    expect((db.prepare('SELECT answer FROM decisions WHERE id = ?').get(d) as { answer: string }).answer).toBe(`Started 2:\n- implementer "API": session ${kids[0]}\n- reviewer "reviewer": session ${kids[1]}`)
    for (const k of kids) hookRuns(k)
    await until(() => said(kids[0]).length === 2)
    expect(said(kids[0])[0]).toBe('> Your piece: API\n\nadd the endpoint')
  })

  it('a board message for an idle session is typed in once', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    chat.send(id, 'hi')
    await until(() => !chat.status(id).busy && said(id).length === 2)
    queueMessage(db, id, 'implementer done', 'session x')
    await until(() => said(id).length === 4)
    expect(said(id)[2]).toBe('> Message from the decision board (session x):\nimplementer done')
    expect(db.prepare('SELECT delivered_at IS NOT NULL AS d, via FROM messages').all()).toEqual([{ d: 1, via: 'terminal' }])
    // Marked submitted once the input box is empty after Enter.
    await until(() => (db.prepare('SELECT submitted_at FROM messages').get() as { submitted_at: string | null }).submitted_at !== null)
  })

  it('your answer for a session that is not running starts it, is typed in, and is marked submitted', async () => {
    const id = chat.create('/tmp')
    postDecision(db, { ticket: 'KA-1', number: 'D1', session: id, question: 'Retry?' })
    expect(answerFromBoard(db, 'KA-1/D1', 'Yes, 3 times')).toBe(id)
    expect(chat.status(id).running).toBe(false)
    expect(chat.wake(id)).toBe('started')
    hookRuns(id)
    await until(() => said(id).length === 2)
    expect(said(id)[0]).toBe('> Message from the decision board (board):\nThe user answered KA-1/D1 ("Retry?"): Yes, 3 times\nAct on it now, then: signoff ack --ticket KA-1 --id D1')
    await until(() => (db.prepare('SELECT submitted_at FROM messages').get() as { submitted_at: string | null }).submitted_at !== null)
    expect(db.prepare('SELECT decision_id, via, failed FROM messages').get()).toEqual({ decision_id: 'KA-1/D1', via: 'terminal', failed: null })
    expect(chat.wake(id)).toBe('running')
  })

  it('a session started in a Terminal window (through the wrapper) is used from the chat as is, and keeps running when the app quits', async () => {
    const id = 'from-terminal'
    db.prepare("INSERT INTO sessions (id, state, cwd, via, started_at, updated_at) VALUES (?, 'working', '/tmp', NULL, 't', 't')").run(id)
    tmux.start('claude-x', { cwd: '/tmp', command: ['claude', '--session-id', id], env: { DECISION_IDE_TMUX: 'claude-x' }, unset: [], cols: 100, rows: 30 })
    db.prepare("UPDATE sessions SET tmux = 'claude-x' WHERE id = ?").run(id)
    hookRuns(id)
    chat.send(id, 'from the app')
    await until(() => said(id).length === 2)
    expect(said(id)).toEqual(['> from the app', 'echo: from the app'])
    expect(argv()).toHaveLength(1) // no second claude was started
    expect(chat.attachArgs(id).slice(-2)).toEqual(['-t', '=claude-x'])
    chat.stopAll()
    expect(tmux.has('claude-x')).toBe(true)
  })

  it('resuming an earlier conversation makes it a session that starts with claude --resume', async () => {
    const id = 'earlier-1'
    mkdirSync(join(dir, '.claude/projects/p'), { recursive: true })
    writeFileSync(join(dir, '.claude/projects/p', `${id}.jsonl`), JSON.stringify({ type: 'user', uuid: 'u0', timestamp: new Date().toISOString(), message: { content: 'old question' } }) + '\n')
    expect(chat.resume(id, '/tmp', 'old question')).toBe(id)
    expect(db.prepare('SELECT via, cwd, title FROM sessions WHERE id = ?').get(id)).toEqual({ via: 'chat', cwd: '/tmp', title: 'old question' })
    chat.send(id, 'and now?')
    await until(() => argv().length === 1)
    expect(argv()[0].slice(2, 4)).toEqual(['--resume', id])
  })

  it('opening the chat again resumes the saved conversation', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    chat.send(id, 'one')
    await until(() => said(id).length === 2)
    chat.stop(id)
    chat.send(id, 'two')
    await until(() => said(id).length === 4)
    expect(argv().at(-1)!.slice(2, 4)).toEqual(['--resume', id])
    expect(said(id)).toEqual(['> one', 'echo: one', '> two', 'echo: two'])
  })

  it("a note recorded before the first message does not make a new chat try to resume", async () => {
    const first = chat.create('/tmp', { ticket: 'KA-1' })
    const created = new Promise<string>((resolve) => chat.onStatus((st) => st.session !== first && resolve(st.session)))
    // Another ticket asks first and sends nothing; choosing "new" starts the chat.
    expect(chat.routeAndSend(first, 'now look at KA-2', '/tmp')).toEqual({ session: first, ask: { key: 'KA-2', current: 'KA-1', existing: null } })
    const r = chat.routeAndSend(first, 'now look at KA-2', '/tmp', [], 'new')
    hookRuns(await created)
    await until(() => said(r.session!).length === 2)
    expect(argv().at(-1)).toEqual(expect.arrayContaining(['--session-id', r.session]))
    expect(chat.history(r.session!)[0]).toMatchObject({ type: 'notice', text: 'You started a new chat for KA-2 (from the KA-1 chat).' })
  })

  it('Shift+Tab cycles the mode in the terminal and the mode is read back; Esc reaches the terminal', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    chat.send(id, 'hi')
    await until(() => said(id).length === 2)
    chat.cycleMode(id)
    await until(() => (db.prepare('SELECT mode FROM sessions WHERE id = ?').get(id) as { mode: string }).mode === 'acceptEdits')
    chat.interrupt(id)
    await until(() => logged().some((x) => (x as { key?: string }).key === 'esc'))
    expect(() => chat.command(id, '/model sonnet; rm -rf ~')).toThrow('not a command the chat sends for you')
  })

  it('the mode shown is the one on Claude Code\'s screen, not the one asked for', async () => {
    const id = chat.create('/tmp', { mode: 'auto' })
    hookRuns(id)
    chat.send(id, 'hi') // starts the terminal; the fake has no auto mode, like Claude Code on a model without it
    await until(() => (db.prepare('SELECT mode FROM sessions WHERE id = ?').get(id) as { mode: string }).mode === 'default')
  })

  it("tells whether Claude Code's input box still holds text (an unsubmitted paste), ignoring an empty prompt", () => {
    const rule = '─'.repeat(40)
    const screen = (...box: string[]): string[] => ['⏺ done', rule, ...box, rule, '  ⏵⏵ auto mode on (shift+tab to cycle)']
    expect(inputHasText(screen('❯ '))).toBe(false)
    expect(inputHasText(screen('❯   def parse_origin_host', '  end', '  What are these changes ?'))).toBe(true)
    expect(inputHasText(['no rules on this screen'])).toBe(false)
  })

  it("reads the mode from the footer lines Claude Code draws, and nothing when a dialog covers them", () => {
    const rule = '─'.repeat(40)
    const at = (footer: string): string[] => ['⏺ done', '', rule, '❯ ', rule, `  ${footer} · ← for agents`, '', '']
    expect(footerMode(at('⏸ manual mode on · ? for shortcuts'))).toBe('default')
    expect(footerMode(at('⏵⏵ accept edits on (shift+tab to cycle)'))).toBe('acceptEdits')
    expect(footerMode(at('⏸ plan mode on (shift+tab to cycle)'))).toBe('plan')
    expect(footerMode(at('⏵⏵ auto mode on (shift+tab to cycle)'))).toBe('auto')
    expect(footerMode(['⏸ manual mode on', 'Do you want to proceed?', '❯ 1. Yes', '  2. No', 'Esc to cancel · Tab to amend'])).toBeNull()
  })

  it('waits for the folder trust question to be answered before typing', async () => {
    process.env.FAKE_TRUST = '1'
    const id = chat.create('/tmp')
    chat.send(id, 'after trust')
    await until(() => chat.history(id).some((e) => e.type === 'notice'))
    expect(said(id)).toEqual([])
    terms.write(chat.status(id).terminal!, '\r') // the user answers in the terminal
    hookRuns(id) // Claude Code runs the startup hook once the folder is trusted
    await until(() => said(id).length === 2)
    expect(said(id)).toEqual(['> after trust', 'echo: after trust'])
  })

  it('pasted images are saved to files and their paths go into the message', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    expect(() => chat.send(id, 'x', [{ mediaType: 'application/pdf' as never, data: 'AA' }])).toThrow('images can be PNG, JPEG, GIF or WebP, not application/pdf')
    chat.send(id, 'what is this', [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }])
    await until(() => said(id).length === 2)
    const prompt = said(id)[0]
    const path = /\[image: (.+\.png)\]/.exec(prompt)![1]
    expect(prompt.startsWith('> what is this')).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  it('attached files go into the message as their path; a missing file is refused', async () => {
    const id = chat.create('/tmp')
    hookRuns(id)
    const file = join(mkdtempSync(join(tmpdir(), 'attach-')), 'notes.txt')
    writeFileSync(file, 'hi')
    expect(() => chat.send(id, 'x', [], ['/no/such/file.txt'])).toThrow('/no/such/file.txt no longer exists')
    chat.send(id, 'read this', [], [file])
    await until(() => said(id).length === 2)
    expect(said(id)[0]).toBe(`> read this\n[file: ${file}]`)
  })

  it('a handoff starts a fresh chat with the note from the board', async () => {
    const id = chat.create('/tmp', { ticket: 'KA-1' })
    hookRuns(id)
    chat.send(id, 'first')
    await until(() => !chat.status(id).busy && said(id).length === 2)
    const created = new Promise<string>((resolve) => chat.onStatus((st) => st.session !== id && st.running && resolve(st.session)))
    const to = chat.handoff(id, 'manual')
    hookRuns(await created)
    await until(() => said(to).length === 2)
    expect(said(to)[0]).toContain('You are continuing the work of the chat')
    expect(db.prepare('SELECT parent_id, title FROM sessions WHERE id = ?').get(to)).toEqual({ parent_id: id, title: 'first (cont.)' })
    expect(chat.status(id).running).toBe(false)
  })
})
