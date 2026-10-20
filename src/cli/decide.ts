// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, relative, resolve } from 'path'
import { parseArgs } from 'util'
import { openStore, type Store } from '../main/store'
import * as b from '../shared/board'
import { runMcp } from './mcp'
import * as tk from '../shared/tickets'
import { search } from '../shared/memory'
import { syncBoard } from '../main/store/import-board'
import { getSettings } from '../main/settings'
import { acceptByClaude, autonomyBrief, delegate, getAutonomy, PLAN_ITEM } from '../shared/autonomy'
import { startMonitor } from '../shared/monitors'
import { repoOfFolder } from '../main/monitor-setup'
import { anchorsFor, docsBrief, findDocs, indexDocs, touchedDocs, verifyDocs } from '../main/flows'
import { protocolParts } from '../main/protocol'
import { finishPiece, passPiece, proposeSplit, proposeTeam, setupLines, teamBrief, leadWith } from '../shared/team'
import { addRun, customRuns, removeRun } from '../main/runs'
import { addCase, cases, planOf, setCase, type CaseStatus } from '../shared/testplan'
import { openComments, replyComment } from '../shared/comments'
import type { TaskGroup } from '../main/tasks'
import { runAsk } from './ask'
import { askToSettle, lastPromptAtFile, settle, staleDecisions } from '../shared/stale'
import { getApproval, leaveToTerminal, requestApproval } from '../shared/approvals'

// signoff (old name: decide, still works): how Claude sessions talk to Signoff AI.
// The store path comes from DECISION_IDE_DB, else the app's data folder (macOS path; other OSes in Phase 4).

const USAGE = `signoff <command> [options]   (session id defaults to $CLAUDE_CODE_SESSION_ID; decide is the same command)
  register  [--ticket K] [--title T] [--description D]   [--parent SESSION-ID: nest under that session; its first 8+ characters are enough]
            [--cwd DIR: move this session to that folder, e.g. a repo or worktree, so a team can start from it]
  autonomy                       what this session may settle itself, and what waits for the user
  plan      --ticket K --id Dn --file PLAN [--question Q]   Plan first: the whole plan as one approval card
  monitor   [--window MIN] [--every MIN]   start the monitor on this branch's PR (only when after.monitor is handed over)
  status    [--state starting|working|waiting|done] [--note N] [--description D]
  post      --ticket K --id Dn --question Q [--context C]... [--option "Label :: what happens"]... [--recommend "Label :: why"]
            [--evidence "file:line :: what it shows"]... [--if-wrong W] [--ref K/Dn]... [--draft T | --draft-file FILE]
            [--level ask|inform|auto] [--action consent | --action terminal --command C] [--force]
  wait      --ticket K --id Dn [--id ...] | --review R-n   [--timeout 3000] [--interval 2]
  inbox     print undelivered board messages and mark them delivered
  list      [--ticket K] [--open]
  answer    --ticket K --id Dn --text T
  ack       --ticket K --id Dn [--id ...]
  reply     --ticket K --id Dn --text T | --text-file FILE   (a file keeps line breaks: points, paragraphs)
  settle    --ticket K --id Dn --text T [--done]   the chat decided it (an option, or something else); --done: already implemented
  withdraw  --ticket K --id Dn --reason R | --review R-n --reason R   (a review you posted that no longer applies)
  propose   --ticket K --title T --patch FILE [--summary S | --summary-file FILE] [--file NAME]
  review    --id R-n
  review-reply --id R-n --change Cn --text T | --text-file FILE
  recall    <words> [--ticket K] [--limit N]   earlier decisions, reviews and chats about a topic
  split     --ticket K --id Dn --piece "Title :: what to do" [--piece ...] [--role R]   a team lead proposes child sessions
  done      --summary S   a team member finished its piece (tells the lead and the reviewers)
  team      list | use --workflow ID | propose --ticket K --id Dn --name N [--description D] --role "role :: count|N :: what it does"...
            [--good-for G]... [--not-for N]...   team setups: list them, lead one from this session, or propose a new one
            (the user approves it on the board; it is saved in Workflows and this session leads it)
  comment   reply --id N --text T | --text-file FILE | list   answer a review comment (#cN) so the reply shows by the code; list: unanswered ones
  test      add --title T [--steps S] [--expected E] | set --idx N --status pending|pass|fail|blocked [--evidence E] | list
            the test plan of this session's ticket (or this session): draft cases, then verify them with evidence
  run       add --label L --command C [--group launch|console|test|seed|other] [--folder F] | list [--folder F] | remove --label L [--folder F]
            run commands the app's Run panel shows for a repo (F: the repo, default the current folder)
  pass      --of SESSION [--summary S]   the reviewer passed an implementer's piece (tells the lead to merge it)
  subtask   add --ticket K --title T [--decision Dn]... [--jira KEY] | set --ticket K --idx N [--status S] [--jira KEY] | list --ticket K
  docs      for <file> | find <words> | touched | verify   flow docs (Settings): docs anchored on a file, docs by name or heading,
            docs anchored on this repo's changed files, anchors that no longer hold
  hook      session-start [--terminal] | permission | stop [--terminal]   (Claude Code hook input on stdin; --terminal: a session in your own terminal)
  ask       <question> [--skill S] [--folder F] [--model M]   a short spoken-style answer (for Siri / Shortcuts)
  import-prototype <board.json>   copy the prototype board's sessions, decisions and reviews in (switch-over)
  mcp       permission-prompt MCP server for chat sessions (needs $DECISION_IDE_SESSION)`

const dbPath = (): string =>
  process.env.DECISION_IDE_DB || join(homedir(), 'Library/Application Support/decision-ide/board.db')

const run = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

// The Claude process this command runs under: CLAUDE_PID, else walk up to the nearest "claude".
function claudePid(): string | null {
  if (process.env.CLAUDE_PID) return process.env.CLAUDE_PID
  let cur = String(process.ppid)
  for (let i = 0; i < 6; i++) {
    const row = run('ps', ['-o', 'ppid=,comm=', '-p', cur]).trim().split(/\s+(.*)/)
    if (row.length < 2 || !row[0]) return null
    if (basename(row[1] || '').startsWith('claude')) return cur
    cur = row[0]
  }
  return null
}

const ttyOf = (pid: string | null): string | null => {
  const t = pid ? run('ps', ['-o', 'tty=', '-p', pid]) : ''
  return t && t !== '??' && t !== '?' ? '/dev/' + t : null
}

class Usage extends Error {}

// How long a terminal permission prompt waits for an answer in the app before Claude Code shows its own (hook timeout is 600 s).
const PERMISSION_WAIT_MS = Number(process.env.DECISION_IDE_PERMISSION_WAIT_MS || 570_000)

// Issue keys like ABC-123 or abc-12, at the start of the branch or after a slash.
const ISSUE_KEY = /(?:^|\/)([a-z][a-z0-9]{1,9}-\d+)/i

// Registers session s for the current folder. Shared by `register` and the SessionStart hook.
// The session's folder comes from Claude Code (the SessionStart hook passes it as `where`). A later `signoff register`
// keeps the recorded folder: it may run from wherever a command cd'd to, and moving the session would hide it from the
// Sessions list of its folder.
function register(db: Store, s: string, o: { ticket?: string; title?: string; description?: string }, where?: string): Record<string, unknown> {
  const prev = db.prepare('SELECT state, cwd FROM sessions WHERE id = ?').get(s) as { state: string; cwd: string | null } | undefined
  const cwd = where || prev?.cwd || process.cwd()
  const branch = run('git', ['-C', cwd, 'branch', '--show-current'])
  const ticket = o.ticket?.toUpperCase() || ISSUE_KEY.exec(branch)?.[1].toUpperCase()
  // The Claude process here belongs to the env session: never attach its pid/tty to another session id.
  const env = process.env.CLAUDE_CODE_SESSION_ID
  const pid = !env || env === s ? claudePid() : null
  b.touchSession(db, s, {
    cwd, branch: branch || undefined, ticket, title: o.title, description: o.description,
    tty: ttyOf(pid), pid: pid ? Number(pid) : undefined, archived: false,
    state: !prev || ['starting', 'done'].includes(prev.state) ? 'working' : undefined
  })
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(s) as Record<string, unknown>
}

const decisionLines = (db: Store, ticket?: string, open?: boolean): string[] => {
  const where = [ticket ? 'ticket = @ticket' : '', open ? "status = 'open'" : ''].filter(Boolean).join(' AND ')
  const rows = db.prepare(`SELECT * FROM decisions ${where ? 'WHERE ' + where : ''} ORDER BY created_at, rowid`)
    .all({ ticket: ticket?.toUpperCase() }) as Record<string, string>[]
  return rows.map((d) => {
    const refs = JSON.parse(d.refs) as string[]
    return `${d.id} [${d.status}${d.level && d.level !== 'ask' ? ' · ' + d.level : ''}] ${d.question}` + (refs.length ? `  (refs ${refs.join(', ')})` : '') + (d.answer ? `\n    -> ${d.answer}` : '')
  })
}

// Claude Code hooks for sessions the app starts (resources/decision-protocol). Input is the hook JSON on stdin.
// - session-start: register, then hand Claude the ticket's decisions as context.
// - stop: deliver queued board messages by blocking the stop once.
// The rules the app would put in the system prompt (protocol.ts), read from its resources folder
// (DECISION_IDE_RESOURCES, set by the decide launcher).
function protocolText(db: Store): string[] {
  const res = process.env.DECISION_IDE_RESOURCES
  if (!res) throw new Usage('--terminal needs DECISION_IDE_RESOURCES (set by the decide launcher)')
  return protocolParts(res, getSettings(db)).map((p) => p.trim())
}

function hook(db: Store, event: string | undefined, terminal = false): number {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}') as {
    session_id?: string; cwd?: string; stop_hook_active?: boolean; transcript_path?: string
    tool_name?: string; tool_input?: Record<string, unknown>; tool_use_id?: string
  }
  if (!input.session_id) throw new Usage('hook input has no session_id')
  if (event === 'session-start') {
    if (input.cwd) process.chdir(input.cwd)
    // A folder moved with register --cwd survives restarts while it is inside the folder Claude runs in (SIGNOFF-29/D2).
    const here = process.cwd()
    const kept = (db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(input.session_id) as { cwd: string | null } | undefined)?.cwd
    const inside = !!kept && existsSync(kept) && realpathSync(kept).startsWith(here + '/')
    const ticket = register(db, input.session_id, {}, inside ? kept! : here).ticket as string | null
    // Where Claude Code saves this conversation: the app's chat panel shows the session from it.
    if (input.transcript_path) db.prepare('UPDATE sessions SET transcript = ? WHERE id = ?').run(input.transcript_path, input.session_id)
    // The shared tmux session it runs in (set by the app, or by the `claude` wrapper in your shell), so both can use it.
    if (process.env.DECISION_IDE_TMUX) db.prepare('UPDATE sessions SET tmux = ? WHERE id = ?').run(process.env.DECISION_IDE_TMUX, input.session_id)
    const lines = ['# Signoff AI session', `Registered on the board as session ${input.session_id}.`]
    if (ticket) {
      const ds = decisionLines(db, ticket).slice(-40)
      lines.push(`Ticket: ${ticket}. Decisions on the board for it (cite them by id; do not re-ask settled ones):`, ds.join('\n') || '(none yet)')
    } else lines.push('Ticket: none (the branch has no issue key). Set one before posting: signoff register --ticket <KEY>')
    lines.push(...teamBrief(db, input.session_id))
    lines.push('', autonomyBrief(getAutonomy(db, input.session_id, getSettings(db).autonomy)))
    // Flow docs (Settings): every session is told to look there first.
    const flow = getSettings(db).flowDocs
    if (flow) lines.push('', ...docsBrief(flow))
    // Sessions outside the app get no --append-system-prompt, so the rules come with the context instead.
    if (terminal) lines.unshift(...protocolText(db), '')
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }))
    return 0
  }
  // PermissionRequest (terminal chats): the prompt becomes a card in the app. Waits for the answer; if the user
  // chooses the terminal, or nobody answers in time, it prints nothing and Claude Code shows its own prompt.
  if (event === 'permission') {
    if (!input.tool_name) throw new Usage('permission hook input has no tool_name')
    let a = requestApproval(db, input.session_id, input.tool_name, input.tool_input ?? {}, input.tool_use_id)
    const deadline = Date.now() + PERMISSION_WAIT_MS
    while (a.status === 'pending' && Date.now() < deadline) {
      sleep(250)
      a = getApproval(db, a.id)
    }
    if (a.status === 'pending') a = leaveToTerminal(db, a.id)
    if (a.status === 'terminal') return 0
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: JSON.parse(a.result!) } }))
    return 0
  }
  if (event === 'stop') {
    // Claude Code runs Stop hooks again after a block; without this guard the session could never stop.
    if (input.stop_hook_active) return 0
    const msgs = b.popMessages(db, input.session_id, 'stop')
    if (msgs.length) {
      console.log(JSON.stringify({ decision: 'block', reason: 'Messages from the decision board (sent by the user):\n\n' + msgs.map((m) => m.text).join('\n') }))
      return 0
    }
    // Decisions the chat moved past (you kept talking instead of answering the card): ask once to settle or close them.
    const stale = getSettings(db).tidyDecisions ? staleDecisions(db, input.session_id, input.transcript_path ? lastPromptAtFile(input.transcript_path) : null) : []
    if (stale.length) console.log(JSON.stringify({ decision: 'block', reason: askToSettle(db, stale) }))
    return 0
  }
  throw new Usage('hook is session-start, permission or stop')
}

function main(argv: string[]): number {
  // Like the prototype, --session may come before the command: decide --session X post ...
  const args = [...argv]
  let globalSession: string | undefined
  while (args[0] === '--session') {
    globalSession = args[1]
    args.splice(0, 2)
  }
  const [cmd, ...rest] = args
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    return cmd ? 0 : 2
  }
  if (cmd === 'import-prototype') {
    if (!rest[0]) throw new Usage('import-prototype needs the path to board.json')
    const counts = syncBoard(openStore(dbPath()), rest[0])
    console.log(Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(', ') || 'nothing to copy')
    return 0
  }
  if (cmd === 'mcp') {
    const s = process.env.DECISION_IDE_SESSION
    if (!s) throw new Usage('mcp needs DECISION_IDE_SESSION')
    // Runs until Claude Code closes stdin.
    runMcp(openStore(dbPath()), s).catch((e) => {
      console.error(`signoff mcp: ${(e as Error).message}`)
      process.exit(1)
    })
    return 0
  }
  if (cmd === 'hook') {
    // Hooks always exit 1 on failure: exit 2 from a Stop hook would block the stop and could loop.
    try {
      // The global terminal hooks also fire in sessions the app started; the app's own plugin hooks handle those.
      if (rest.includes('--terminal') && process.env.DECISION_IDE_APP) return 0
      return hook(openStore(dbPath()), rest[0], rest.includes('--terminal'))
    } catch (e) {
      console.error(`signoff hook: ${(e as Error).message}`)
      return 1
    }
  }
  // subtask takes its action as the first word: signoff subtask add|set|list ...
  const sub = cmd === 'subtask' || cmd === 'run' || cmd === 'test' || cmd === 'comment' || cmd === 'team' ? rest.shift() : undefined
  const { values: o, positionals } = parseArgs({
    args: rest, allowPositionals: cmd === 'recall' || cmd === 'ask' || cmd === 'docs', strict: true,
    options: {
      session: { type: 'string' }, ticket: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, parent: { type: 'string' }, cwd: { type: 'string' },
      state: { type: 'string' }, note: { type: 'string' }, id: { type: 'string', multiple: true }, question: { type: 'string' },
      option: { type: 'string', multiple: true }, recommend: { type: 'string' }, evidence: { type: 'string', multiple: true },
      ref: { type: 'string', multiple: true }, action: { type: 'string' }, command: { type: 'string' }, force: { type: 'boolean' },
      review: { type: 'string' }, timeout: { type: 'string' }, interval: { type: 'string' }, open: { type: 'boolean' },
      text: { type: 'string' }, 'text-file': { type: 'string' }, done: { type: 'boolean' }, reason: { type: 'string' }, patch: { type: 'string' }, summary: { type: 'string' },
      'summary-file': { type: 'string' }, file: { type: 'string' }, change: { type: 'string' }, level: { type: 'string' }, item: { type: 'string' }, window: { type: 'string' }, every: { type: 'string' },
      decision: { type: 'string', multiple: true }, jira: { type: 'string' }, idx: { type: 'string' }, status: { type: 'string' }, limit: { type: 'string' },
      skill: { type: 'string' }, folder: { type: 'string' }, model: { type: 'string' }, piece: { type: 'string', multiple: true }, role: { type: 'string', multiple: true }, name: { type: 'string' }, workflow: { type: 'string' }, 'good-for': { type: 'string', multiple: true }, 'not-for': { type: 'string', multiple: true }, of: { type: 'string' }, label: { type: 'string' }, group: { type: 'string' }, steps: { type: 'string' }, expected: { type: 'string' },
      context: { type: 'string', multiple: true }, 'if-wrong': { type: 'string' }, draft: { type: 'string' }, 'draft-file': { type: 'string' }
    }
  })
  const db = openStore(dbPath())
  const sid = (): string => {
    const s = o.session || globalSession || process.env.CLAUDE_CODE_SESSION_ID
    if (!s) throw new Usage('no session id (pass --session or run inside Claude Code)')
    return s
  }
  const ids = (): string[] => {
    if (!o.id?.length) return []
    if (!o.ticket) throw new Usage('--id needs --ticket')
    return o.id.map((i) => b.decisionId(o.ticket!, i))
  }
  const req = (name: keyof typeof o): string => {
    const v = o[name]
    if (typeof v !== 'string' || !v) throw new Usage(`--${name} is required`)
    return v
  }
  // --text-file keeps an answer's line breaks (points, paragraphs); --text is one shell argument.
  const text = (): string => (o['text-file'] ? readFileSync(o['text-file'], 'utf8') : req('text'))

  switch (cmd) {
    case 'plan': {
      // Plan first: the whole plan as one approval card. Once approved, the session settles its handed-over items alone.
      const plan = readFileSync(req('file'), 'utf8')
      if (!plan.trim()) throw new Usage('the plan file is empty')
      const id = b.postDecision(db, {
        ticket: req('ticket'), number: (o.id || [])[0] || '', session: sid(), question: o.question || 'Approve the plan?',
        action: 'consent', draft: plan, item: PLAN_ITEM,
        context: ['Once approved, Claude implements inside this plan without asking. It stops for a surprise the plan does not cover, a failing test it cannot fix, or anything that always asks.']
      })
      console.log(id)
      return 0
    }
    case 'monitor': {
      // A session starts its own monitor once its PR is open, when after.monitor is handed to it (SIGNOFF-24).
      const d = delegate(db, sid(), 'after.monitor', getSettings(db).autonomy)
      if (!d || !('by' in d)) { console.log(`waits for the user: ${d && 'reason' in d ? d.reason : 'after.monitor'}; they start it from Ship`); return 1 }
      const cwd = (db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(sid()) as { cwd: string | null } | undefined)?.cwd
      if (!cwd) throw new b.BoardError('this session has no folder')
      const repo = repoOfFolder(cwd)
      const pr = JSON.parse(execFileSync('gh', ['pr', 'view', '--json', 'number'], { cwd, encoding: 'utf8' })) as { number: number }
      const ticket = (db.prepare('SELECT ticket FROM sessions WHERE id = ?').get(sid()) as { ticket: string | null }).ticket
      const m = startMonitor(db, { session: sid(), repo, pr: pr.number, ticket, windowMinutes: Number(o.window ?? 60), checkMinutes: Number(o.every ?? 30) })
      console.log(`${m.id}: watching ${repo}#${pr.number} (started by ${d.by})`)
      return 0
    }
    case 'autonomy':
      console.log(autonomyBrief(getAutonomy(db, sid(), getSettings(db).autonomy)))
      return 0
    case 'register':
      // --parent: nest this session under another one (its id, or the first characters of it).
      // --cwd: move the session to another folder (SIGNOFF-29/D1); its branch is read from there.
      if (o.cwd && !existsSync(resolve(o.cwd))) throw new Usage(`no folder ${o.cwd}`)
      register(db, sid(), o, o.cwd ? resolve(o.cwd) : undefined)
      if (o.parent) b.setParent(db, sid(), b.sessionByPrefix(db, o.parent))
      console.log(JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid())))
      return 0
    case 'status': {
      b.touchSession(db, sid(), { state: o.state as b.SessionState | undefined, note: o.note, description: o.description })
      console.log(JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid())))
      return 0
    }
    case 'post': {
      if (!o.id?.length) throw new Usage('--id is required')
      if (o.action && !['consent', 'terminal'].includes(o.action)) throw new Usage('--action is consent or terminal')
      // --item: which autonomy item this falls under. If the session hands it to Claude, it is settled at once.
      const d = o.action === 'terminal' ? null : delegate(db, sid(), o.item, getSettings(db).autonomy)
      const id = b.postDecision(db, {
        ticket: req('ticket'), number: (o.id || [])[0] || '', session: sid(), question: req('question'),
        options: o.option, recommend: o.recommend, evidence: o.evidence, refs: o.ref,
        action: (o.action as 'consent' | 'terminal') || null, command: o.command, force: o.force, level: o.level as b.Level | undefined,
        context: o.context, ifWrong: o['if-wrong'],
        draft: o['draft-file'] ? readFileSync(o['draft-file'], 'utf8') : o.draft,
        item: o.item ?? null, byClaude: d && 'by' in d ? d.by : null
      })
      console.log(id)
      if (d && 'by' in d) console.log(`settled by ${d.by}: go ahead, no need to wait`)
      else if (d) console.log(`waits for the user: ${d.reason}`)
      return 0
    }
    case 'split': {
      if (!o.id?.length) throw new Usage('--id is required')
      const pieces = (o.piece ?? []).map((p) => {
        const [title, ...task] = p.split('::')
        if (!task.length) throw new Usage(`--piece needs "Title :: what to do": ${p}`)
        return { title, task: task.join('::') }
      })
      console.log(proposeSplit(db, { session: sid(), ticket: req('ticket'), number: o.id[0], pieces, role: o.role?.[0] }))
      return 0
    }
    case 'team': {
      if (sub === 'list') { console.log(setupLines(db).join('\n')); return 0 }
      if (sub === 'use') {
        const brief = leadWith(db, sid(), req('workflow'))
        console.log(brief.length ? brief.join('\n') : 'This session works solo now.')
        return 0
      }
      if (sub === 'propose') {
        if (!o.id?.length) throw new Usage('--id is required')
        if (!o.role?.length) throw new Usage('give at least one --role "role :: count|N :: what it does"')
        const team = o.role.map((r) => {
          const [role, count, ...does] = r.split('::').map((x) => x.trim())
          if (!role || !count || !does.length) throw new Usage(`--role needs "role :: count|N :: what it does": ${r}`)
          if (count !== 'N' && !/^\d+$/.test(count)) throw new Usage(`--role count is a number or N: ${r}`)
          return { role, count: count === 'N' ? null : Number(count), does: does.join(' :: ') }
        })
        const name = req('name')
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 41)
        console.log(proposeTeam(db, { session: sid(), ticket: req('ticket'), number: o.id[0], setup: { id, name, description: o.description ?? '', team, goodFor: o['good-for'], notFor: o['not-for'] } }))
        return 0
      }
      throw new Usage('signoff team list | use --workflow ID | propose ...')
    }
    case 'pass':
      console.log(`told: ${passPiece(db, sid(), req('of'), o.summary ?? '')}`)
      return 0
    case 'comment': {
      if (sub === 'reply') {
        // --id repeats for decisions, so it arrives as a list here too; a comment takes one.
        if (!o.id?.length) throw new Usage('--id is required')
        const id = Number(o.id[0].replace(/^#?c/i, ''))
        if (!Number.isInteger(id)) throw new Usage('--id is the comment number, e.g. 12 or c12')
        const c = replyComment(db, id, text())
        console.log(`#c${c.id} answered`)
      } else if (sub === 'list') for (const c of openComments(db, sid())) console.log(`#c${c.id} ${c.path}:${c.start_line}-${c.end_line} ${c.text.split('\n')[0]}`)
      else throw new Usage('comment reply | list')
      return 0
    }
    case 'test': {
      const plan = planOf(db, sid())
      const line = (c: { idx: number; status: string; title: string; verified_by: string | null }): string => `#${c.idx} [${c.status}${c.verified_by ? ` by ${c.verified_by}` : ''}] ${c.title}`
      if (sub === 'add') console.log(line(addCase(db, plan, { title: req('title'), steps: o.steps, expected: o.expected })))
      else if (sub === 'set') {
        const idx = Number(req('idx'))
        if (!Number.isInteger(idx)) throw new Usage('--idx is a number')
        console.log(line(setCase(db, plan, idx, { status: req('status') as CaseStatus, by: 'claude', evidence: o.evidence?.join('\n') ?? null })))
      } else if (sub === 'list') for (const c of cases(db, plan)) console.log(line(c))
      else throw new Usage('test add | set | list')
      return 0
    }
    case 'run': {
      const root = resolve(o.folder ?? process.cwd())
      if (sub === 'add') addRun(db, root, { label: req('label'), command: req('command'), group: (o.group as TaskGroup | undefined) ?? 'other' })
      else if (sub === 'remove') removeRun(db, root, req('label'))
      else if (sub !== 'list') throw new Usage('run add | list | remove')
      for (const r of customRuns(db, root)) console.log(`${r.group}\t${r.label}\t${r.command}`)
      return 0
    }
    case 'done':
      console.log(`told: ${finishPiece(db, sid(), req('summary')).join(', ')}`)
      return 0
    case 'wait':
      return o.review ? waitReview(db, sid(), o.review, o) : waitDecisions(db, sid(), ids(), o)
    case 'inbox':
      for (const m of b.popMessages(db, sid(), 'inbox')) console.log(m.text)
      return 0
    case 'list':
      for (const line of decisionLines(db, o.ticket, o.open)) console.log(line)
      return 0
    case 'answer':
      for (const id of ids()) b.answer(db, id, req('text'), 'terminal')
      console.log('ok')
      return 0
    case 'ack':
      for (const id of ids()) b.ack(db, id, sid())
      console.log('ok')
      return 0
    case 'reply':
      for (const id of ids()) b.addToThread(db, id, sid(), text())
      console.log('ok')
      return 0
    case 'settle':
      for (const id of ids()) settle(db, id, sid(), text(), !!o.done)
      console.log('ok')
      return 0
    case 'withdraw': {
      // A review id passed as --id (R-n) is withdrawn as a review: the decision syntax is the easy one to reach for.
      const isReview = (i: string): boolean => /^R-\d+$/i.test(i)
      for (const r of [...(o.review ? [o.review] : []), ...(o.id ?? []).filter(isReview)]) b.withdrawReview(db, r.toUpperCase(), sid(), req('reason'))
      const decisions = (o.id ?? []).filter((i) => !isReview(i))
      if (decisions.length && !o.ticket) throw new Usage('--id needs --ticket')
      for (const i of decisions) b.withdraw(db, b.decisionId(o.ticket!, i), sid(), req('reason'))
      console.log('ok')
      return 0
    }
    case 'propose': {
      const summary = o['summary-file'] ? readFileSync(o['summary-file'], 'utf8') : o.summary || ''
      const r = b.addReview(db, { ticket: req('ticket'), session: sid(), title: req('title'), summary, patch: readFileSync(req('patch'), 'utf8'), defaultFile: o.file })
      console.log(r.id)
      for (const c of r.changes) console.log(`  ${c.id} ${c.file}` + (r.kept.includes(c.id) ? ' (accepted already: same diff as before)' : ''))
      if (r.replaced.length) console.log(`replaces ${r.replaced.join(', ')} (closed; wait on ${r.id} instead)`)
      // impl.reviews handed to Claude: accepted at once and recorded as such, so the session does not wait.
      const auto = delegate(db, sid(), 'impl.reviews', getSettings(db).autonomy)
      if (auto && 'by' in auto) { acceptByClaude(db, r.id, auto.by); console.log(`accepted by ${auto.by}: apply it now, no need to wait`) }
      return 0
    }
    case 'review': {
      const id = (o.id || [])[0]
      if (!id) throw new Usage('--id is required')
      printReview(db, id)
      return 0
    }
    case 'review-reply': {
      const id = (o.id || [])[0]
      if (!id) throw new Usage('--id is required')
      b.reviewReply(db, id, req('change'), sid(), text())
      console.log('ok')
      return 0
    }
    case 'ask': {
      const q = positionals.join(' ')
      if (!q.trim() && !o.skill) throw new Usage('ask needs a question or --skill')
      // Default folder: the one open in the app.
      const ws = db.prepare("SELECT value FROM settings WHERE key = 'workspace'").get() as { value: string } | undefined
      const r = runAsk(q, { skill: o.skill, model: o.model, db: dbPath(), folder: o.folder ?? (ws ? (JSON.parse(ws.value) as { current: string | null }).current : null) })
      console.log(r.out)
      return r.code === 0 ? 0 : 1
    }
    case 'recall': {
      const q = positionals.join(' ')
      if (!q.trim()) throw new Usage('recall needs words to search for')
      const hits = search(db, q, { ticket: o.ticket, limit: Number(o.limit ?? 10) })
      if (!hits.length) console.log('nothing found')
      for (const h of hits) console.log(`[${h.kind} ${h.kind === 'chat' ? h.session?.slice(0, 8) : h.ref}${h.ticket ? ' · ' + h.ticket : ''} · ${h.at.slice(0, 10)}] ${h.title}: ${h.snippet.replace(/\s+/g, ' ')}`)
      return 0
    }
    case 'docs': {
      const dir = getSettings(db).flowDocs
      if (!dir) throw new Usage('no flow docs folder is set (Signoff AI Settings → Flow docs)')
      const [sub, ...words] = positionals
      if (sub === 'for') {
        if (!words[0]) throw new Usage('signoff docs for <file>')
        const abs = resolve(words[0])
        const top = run('git', ['-C', dirname(abs), 'rev-parse', '--show-toplevel'])
        const file = top ? relative(top, existsSync(abs) ? realpathSync(abs) : abs) : words[0]  // git prints real paths
        const hits = anchorsFor(indexDocs(dir).anchors, file)
        if (!hits.length) { console.log(`No flow doc is anchored on ${file}. Try: signoff docs find <words>`); return 0 }
        for (const a of hits) console.log(`${a.doc}:${a.docLine}  [${a.heading || 'top'}]  -> ${a.file}${a.start ? `:${a.start}${a.end && a.end !== a.start ? `-${a.end}` : ''}` : ''}`)
        console.log(`Read: cat "${dir}/<doc>"`)
        return 0
      }
      if (sub === 'find') {
        const hits = findDocs(dir, words)
        if (!hits.length) { console.log('No flow doc matches. If none covers this, say so and continue as normal.'); return 0 }
        for (const d of hits) console.log(`${d.doc}${d.headings.length ? `  (${d.headings.slice(0, 6).join(' · ')})` : ''}`)
        console.log(`Read: cat "${dir}/<doc>"`)
        return 0
      }
      if (sub === 'touched') {
        // Changed on this branch (against its base) plus uncommitted and new files.
        const baseRef = ['origin/HEAD', 'origin/main', 'main', 'master'].find((r) => run('git', ['rev-parse', '--verify', '--quiet', r]))
        const files = new Set([
          ...(baseRef ? run('git', ['diff', '--name-only', `${baseRef}...HEAD`]).split('\n') : []),
          ...run('git', ['diff', '--name-only', 'HEAD']).split('\n'),
          ...run('git', ['ls-files', '--others', '--exclude-standard']).split('\n')
        ].filter(Boolean))
        const hits = touchedDocs(indexDocs(dir).anchors, [...files])
        if (!hits.length) { console.log('No flow doc is anchored on the files you changed.'); return 0 }
        for (const d of hits) console.log(`${d.doc}  <- ${d.files.join(', ')}`)
        return 0
      }
      if (sub === 'verify') {
        const v = verifyDocs(dir)
        for (const x of v.broken) console.log(`${x.doc}:${x.docLine}  ${x.anchor}  ${x.problem}`)
        console.log(`${v.checked} anchors checked, ${v.broken.length} broken${v.skipped ? `, ${v.skipped} not checked (outside docs-meta.json prefixes)` : ''}.`)
        return v.broken.length ? 1 : 0
      }
      throw new Usage('signoff docs for <file> | find <words> | touched | verify')
    }
    case 'subtask': {
      const line = (s: tk.Subtask): string => `${s.ticket} #${s.idx} [${s.status}] ${s.title}` + (s.jira_key ? ` (${s.jira_key})` : '') + (s.decisions.length ? `  implements ${s.decisions.join(', ')}` : '') + (s.branch ? `  on ${s.branch}` : '')
      if (sub === 'add') {
        // A plan can start in any session: the ticket is set up here (in this folder) when the app has not seen it yet.
        if (!db.prepare('SELECT 1 FROM tickets WHERE key = ?').get(req('ticket').toUpperCase())) tk.createTicket(db, { key: req('ticket'), folder: process.cwd(), strategy: getSettings(db).branching })
        console.log(line(tk.addSubtask(db, req('ticket'), { title: req('title'), decisions: o.decision, jira: o.jira })))
      }
      else if (sub === 'set') {
        const idx = Number(req('idx'))
        if (!Number.isInteger(idx)) throw new Usage('--idx is a number')
        console.log(line(tk.updateSubtask(db, req('ticket'), idx, { status: o.status as tk.SubtaskState | undefined, jira_key: o.jira })))
      } else if (sub === 'list') for (const s of tk.subtasks(db, req('ticket'))) console.log(line(s))
      else throw new Usage('subtask add | set | list')
      return 0
    }
    default:
      throw new Usage(`unknown command ${cmd}\n${USAGE}`)
  }
}

type Opts = { timeout?: string; interval?: string }
const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Exit 0 with JSON lines when every listed decision is settled or a board message arrives; exit 2 on timeout (re-arm).
function waitDecisions(db: Store, s: string, ids: string[], o: Opts): number {
  const status = (id: string): Record<string, string> | undefined => db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as Record<string, string> | undefined
  const missing = ids.filter((i) => !status(i))
  if (missing.length) throw new b.BoardError(`unknown decision(s) ${missing.join(', ')}`)
  b.touchSession(db, s, { state: 'waiting', note: ids.length ? `waiting on ${ids.join(', ')}` : 'waiting for a board message' })
  const deadline = Date.now() + Number(o.timeout || 3000) * 1000
  for (;;) {
    const ds = ids.map((i) => status(i)!)
    const settled = ids.length > 0 && ds.every((d) => d.status !== 'open')
    if (settled || b.pendingMessages(db, s).length) {
      const msgs = b.popMessages(db, s, 'wait')
      b.touchSession(db, s, { state: 'working', note: settled ? 'answers received' : 'board message received' })
      for (const m of msgs) console.log(JSON.stringify({ type: 'message', text: m.text, at: m.created_at }))
      if (settled) {
        for (const d of ds)
          console.log(JSON.stringify(d.status === 'withdrawn'
            ? { type: 'withdrawn', id: d.id, reason: d.withdrawn_reason }
            : { type: 'answer', id: d.id, answer: d.answer, answered_at: d.answered_at }))
      } else {
        const still = ds.filter((d) => d.status === 'open').map((d) => d.id)
        if (still.length) console.log(JSON.stringify({ type: 'still_open', ids: still }))
      }
      return 0
    }
    if (Date.now() > deadline) {
      console.log(JSON.stringify({ type: 'timeout', still_open: ds.filter((d) => d.status === 'open').map((d) => d.id) }))
      return 2
    }
    sleep(Number(o.interval || 2) * 1000)
  }
}

function waitReview(db: Store, s: string, rid: string, o: Opts): number {
  const review = (): Record<string, string> | undefined => db.prepare('SELECT * FROM reviews WHERE id = ?').get(rid) as Record<string, string> | undefined
  if (!review()) throw new b.BoardError(`unknown review ${rid}`)
  b.touchSession(db, s, { state: 'waiting', note: `waiting on review ${rid}` })
  const deadline = Date.now() + Number(o.timeout || 3000) * 1000
  for (;;) {
    const r = review()!
    if (r.status !== 'open' || b.pendingMessages(db, s).length) {
      const msgs = b.popMessages(db, s, 'wait')
      b.touchSession(db, s, { state: 'working', note: `review ${rid} ${r.status}` })
      for (const m of msgs) console.log(JSON.stringify({ type: 'message', text: m.text, at: m.created_at }))
      const changes = db.prepare('SELECT change_id AS id, file, verdict, comment FROM review_changes WHERE review_id = ? ORDER BY rowid').all(rid) as Record<string, string>[]
      console.log(JSON.stringify(r.status !== 'open'
        ? { type: 'review', id: rid, status: r.status, note: r.note, changes }
        : { type: 'still_open', review: rid, questions: changes.filter((c) => c.verdict === 'question').map((c) => ({ id: c.id, file: c.file, question: c.comment })) }))
      return 0
    }
    if (Date.now() > deadline) {
      console.log(JSON.stringify({ type: 'timeout', review: rid }))
      return 2
    }
    sleep(Number(o.interval || 2) * 1000)
  }
}

function printReview(db: Store, rid: string): void {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(rid) as Record<string, string> | undefined
  if (!r) throw new b.BoardError(`no review ${rid}`)
  console.log(`${r.id} [${r.status}] ${r.title}`)
  if (r.note) console.log(`  overall note: ${r.note}`)
  for (const c of db.prepare('SELECT * FROM review_changes WHERE review_id = ? ORDER BY rowid').all(rid) as Record<string, string>[])
    console.log(`  ${c.change_id} ${c.file}: ${c.verdict}` + (c.comment ? ` — ${c.comment}` : ''))
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (e) {
  const parseError = String((e as { code?: string }).code || '').startsWith('ERR_PARSE_ARGS')
  if (e instanceof b.BoardError || e instanceof Usage || parseError) {
    console.error(`signoff: ${(e as Error).message}`)
    process.exitCode = e instanceof Usage || parseError ? 2 : 1
  } else throw e
}
