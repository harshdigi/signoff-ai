// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore } from '../../main/store'
import { queueMessage } from '../../shared/board'
import { saveSettings } from '../../main/settings'

// Runs the bundled CLI (npm run build:cli first; `npm test` does it) against a throwaway store.
const CLI = join(__dirname, '../../../out/cli/decide.cjs')
let dir: string
const decide = (args: string[], env: Record<string, string> = {}, input?: string): { code: number; out: string; err: string } => {
  const r = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8', cwd: dir, input,
    env: { PATH: process.env.PATH!, DECISION_IDE_DB: join(dir, 'board.db'), CLAUDE_CODE_SESSION_ID: 'test-runner', ...env }
  })
  return { code: r.status ?? -1, out: r.stdout.trim(), err: r.stderr.trim() }
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'decide-cli-'))
})
const S = ['--session', 's1']

describe('decide CLI', () => {
  it('docs: needs a flow docs folder, then finds docs by file and by words', () => {
    expect(decide(['docs', 'find', 'order']).err).toContain('no flow docs folder is set')
    const docs = join(dir, 'docs')
    mkdirSync(join(docs, 'orders'), { recursive: true })
    writeFileSync(join(docs, 'orders', 'CLAUDE.md'), '# Orders\n## Order quote\n- `app/models/order.rb:3`\n')
    const db = openStore(join(dir, 'board.db'))
    saveSettings(db, { flowDocs: docs })
    db.close()
    expect(decide(['docs', 'find', 'quote']).out).toBe(`orders/CLAUDE.md  (Order quote)\nRead: cat "${docs}/<doc>"`)
    expect(decide(['docs', 'for', 'app/models/order.rb']).out).toBe(`orders/CLAUDE.md:3  [Order quote]  -> app/models/order.rb:3\nRead: cat "${docs}/<doc>"`)
    expect(decide(['docs', 'for', 'app/models/none.rb']).out).toBe('No flow doc is anchored on app/models/none.rb. Try: signoff docs find <words>')
  })

  it('team propose parses roles into a setup proposal; bad roles are refused', () => {
    decide(['register', '--ticket', 'KA-1', ...S])
    const r = decide(['team', 'propose', '--ticket', 'KA-1', '--id', 'D9', '--name', 'Per ticket', '--role', 'implementer :: N :: Builds one ticket', '--role', 'reviewer :: 1 :: Senior engineer', ...S])
    expect(r).toMatchObject({ code: 0, out: 'KA-1/D9' })
    const db = openStore(join(dir, 'board.db'))
    expect(JSON.parse((db.prepare('SELECT item FROM decisions WHERE id = ?').get('KA-1/D9') as { item: string }).item)).toEqual({
      id: 'per-ticket', name: 'Per ticket', description: '', goodFor: [], notFor: [],
      team: [{ role: 'implementer', count: null, does: 'Builds one ticket' }, { role: 'reviewer', count: 1, does: 'Senior engineer' }]
    })
    db.close()
    expect(decide(['team', 'propose', '--ticket', 'KA-1', '--id', 'D10', '--name', 'X', '--role', 'implementer :: many :: x', ...S]).err).toBe('signoff: --role count is a number or N: implementer :: many :: x')
  })

  it('post, list, answer, ack keep the prototype output', () => {
    expect(decide([...S, 'post', '--ticket', 'abc-1', '--id', 'd1', '--question', 'Q?', '--ref', 'abc-1/d0'])).toMatchObject({ code: 0, out: 'ABC-1/D1' })
    expect(decide(['list', '--ticket', 'ABC-1']).out).toBe('ABC-1/D1 [open] Q?  (refs ABC-1/D0)')
    expect(decide(['answer', '--ticket', 'ABC-1', '--id', 'D1', '--text', 'yes']).code).toBe(0)
    expect(decide(['list']).out).toBe('ABC-1/D1 [answered] Q?  (refs ABC-1/D0)\n    -> yes')
    expect(decide([...S, 'ack', '--ticket', 'ABC-1', '--id', 'D1']).out).toBe('ok')
  })

  it('post --level inform settles it at once and list marks it', () => {
    expect(decide([...S, 'post', '--ticket', 'K-2', '--id', 'D1', '--question', 'Which error?', '--level', 'inform', '--recommend', 'Reuse InvalidEmail', '--evidence', 'app/errors.rb:12']).out).toBe('K-2/D1')
    expect(decide(['list', '--ticket', 'K-2']).out).toBe('K-2/D1 [answered · inform] Which error?\n    -> Reuse InvalidEmail')
    expect(decide([...S, 'post', '--ticket', 'K-2', '--id', 'D2', '--question', 'Q', '--level', 'maybe'])).toMatchObject({ code: 1, err: 'signoff: --level is ask, inform or auto' })
  })

  it('subtask add / set / list record the plan', () => {
    const db = openStore(join(dir, 'board.db'))
    db.prepare("INSERT INTO tickets (key, folder, strategy, created_at, updated_at) VALUES ('ABC-7', '/w', 'main', 't', 't')").run()
    db.close()
    expect(decide(['subtask', 'add', '--ticket', 'ABC-7', '--title', 'Add column', '--decision', 'D1']).out).toBe('ABC-7 #1 [planned] Add column  implements ABC-7/D1')
    expect(decide(['subtask', 'set', '--ticket', 'ABC-7', '--idx', '1', '--jira', 'abc-9013']).out).toBe('ABC-7 #1 [planned] Add column (ABC-9013)  implements ABC-7/D1')
    expect(decide(['subtask', 'list', '--ticket', 'ABC-7']).out).toBe('ABC-7 #1 [planned] Add column (ABC-9013)  implements ABC-7/D1')
    // A ticket the app has not seen is set up on the first step (any session can keep a plan).
    expect(decide(['subtask', 'add', '--ticket', 'ABC-99', '--title', 'x'])).toMatchObject({ code: 0, out: 'ABC-99 #1 [planned] x' })
    expect(decide(['subtask', 'nope', '--ticket', 'ABC-7']).code).toBe(2)
  })

  it('recall finds earlier decisions by topic', () => {
    decide([...S, 'post', '--ticket', 'ABC-4', '--id', 'D1', '--question', 'Store the customer VAT or the business id?'])
    decide(['answer', '--ticket', 'ABC-4', '--id', 'D1', '--text', 'The VAT, backfilled'])
    const out = decide(['recall', 'customer', 'vat']).out
    expect(out).toMatch(/^\[decision ABC-4\/D1 · ABC-4 · \d{4}-\d{2}-\d{2}\] Store the customer VAT or the business id\?: The \[VAT\], backfilled/)
    expect(decide(['recall', 'nothing-like-this']).out).toBe('nothing found')
    expect(decide(['recall']).code).toBe(2)
  })

  it('errors use the prototype wording and exit codes', () => {
    expect(decide([...S, 'post', '--ticket', 'ABC-1', '--id', 'D2', '--question', 'Push', '--action', 'terminal'])).toMatchObject({ code: 1, err: 'signoff: --action terminal needs --command' })
    expect(decide(['post', '--ticket', 'ABC-1', '--question', 'Q'])).toMatchObject({ code: 2, err: 'signoff: --id is required' })
    expect(decide(['nope']).code).toBe(2)
  })

  it('wait times out with exit 2 and wakes on an answer', () => {
    decide([...S, 'post', '--ticket', 'ABC-1', '--id', 'D1', '--question', 'Q?'])
    const t = decide([...S, 'wait', '--ticket', 'ABC-1', '--id', 'D1', '--timeout', '1', '--interval', '0.2'])
    expect(t.code).toBe(2)
    expect(JSON.parse(t.out)).toEqual({ type: 'timeout', still_open: ['ABC-1/D1'] })
    decide(['answer', '--ticket', 'ABC-1', '--id', 'D1', '--text', 'go'])
    const w = decide([...S, 'wait', '--ticket', 'ABC-1', '--id', 'D1', '--timeout', '2', '--interval', '0.2'])
    expect(w.code).toBe(0)
    expect(JSON.parse(w.out)).toMatchObject({ type: 'answer', id: 'ABC-1/D1', answer: 'go' })
  })

  it('propose prints the review and its files; review shows verdicts', () => {
    writeFileSync(join(dir, 'p.diff'), '# a.rb  (new)\n+x\n\n# b.rb  (new)\n+y\n')
    expect(decide([...S, 'propose', '--ticket', 'ABC-1', '--title', 'PR 1', '--patch', 'p.diff']).out).toBe('R-1\n  C1 a.rb\n  C2 b.rb')
    expect(decide(['review', '--id', 'R-1']).out).toBe('R-1 [open] PR 1\n  C1 a.rb: pending\n  C2 b.rb: pending')
  })

  it('withdraw takes a review id in the decision syntax too', () => {
    writeFileSync(join(dir, 'p.diff'), '# a.rb  (new)\n+x\n')
    decide([...S, 'propose', '--ticket', 'ABC-1', '--title', 'PR 1', '--patch', 'p.diff'])
    expect(decide([...S, 'withdraw', '--ticket', 'ABC-1', '--id', 'R-1', '--reason', 'replaced by R-2']).out).toBe('ok')
    expect(decide(['review', '--id', 'R-1']).out).toBe('R-1 [dismissed] PR 1\n  overall note: Withdrawn by its session: replaced by R-2\n  C1 a.rb: pending')
  })

  it('register keeps the folder the session was recorded in, wherever the command runs', () => {
    decide([...S, 'register'])
    const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'))
    const r = spawnSync('node', [CLI, ...S, 'register', '--ticket', 'ABC-9'], {
      encoding: 'utf8', cwd: elsewhere,
      env: { PATH: process.env.PATH!, DECISION_IDE_DB: join(dir, 'board.db'), CLAUDE_CODE_SESSION_ID: 'test-runner' }
    })
    const out = JSON.parse(r.stdout)
    expect([realpathSync(out.cwd), out.ticket]).toEqual([realpathSync(dir), 'ABC-9'])
  })

  it('register --parent nests this session under another one, by the start of its id', () => {
    decide(['--session', 'lead-session-1', 'register'])
    const out = JSON.parse(decide([...S, 'register', '--parent', 'lead-sess']).out)
    expect(out.parent_id).toBe('lead-session-1')
  })

  it('register for another session never takes this process tty or pid', () => {
    const out = JSON.parse(decide(['--session', 'someone-else', 'register']).out)
    expect([out.tty, out.pid]).toEqual([null, null])
  })

  it('hook session-start registers the session and hands over the ticket decisions', () => {
    spawnSync('git', ['init', '-q', '-b', 'feat/abc-12-login'], { cwd: dir })
    decide([...S, 'post', '--ticket', 'ABC-12', '--id', 'D1', '--question', 'Q?'])
    const r = decide(['hook', 'session-start'], {}, JSON.stringify({ session_id: 's2', cwd: dir, source: 'startup' }))
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
      '# Signoff AI session\nRegistered on the board as session s2.\n' +
      'Ticket: ABC-12. Decisions on the board for it (cite them by id; do not re-ask settled ones):\nABC-12/D1 [open] Q?' } })
  })

  it('hook session-start without an issue key asks Claude to set one', () => {
    const r = decide(['hook', 'session-start'], {}, JSON.stringify({ session_id: 's3', cwd: dir }))
    expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toBe('# Signoff AI session\nRegistered on the board as session s3.\n' +
      'Ticket: none (the branch has no issue key). Set one before posting: signoff register --ticket <KEY>')
  })

  it('hook stop delivers queued messages once and never blocks twice', () => {
    const stop = (active = false): { code: number; out: string } => decide(['hook', 'stop'], {}, JSON.stringify({ session_id: 's1', stop_hook_active: active }))
    expect(stop()).toMatchObject({ code: 0, out: '' })
    decide([...S, 'register'])
    const db = openStore(join(dir, 'board.db'))
    queueMessage(db, 's1', 'look at D1', 'board')
    db.close()
    expect(stop(true)).toMatchObject({ code: 0, out: '' })
    expect(JSON.parse(stop().out)).toEqual({ decision: 'block', reason: 'Messages from the decision board (sent by the user):\n\nlook at D1' })
    expect(stop()).toMatchObject({ code: 0, out: '' })
  })

  it('hook session-start --terminal hands over the protocol and profile for sessions outside the app', () => {
    const res = join(__dirname, '../../../resources')
    const r = decide(['hook', 'session-start', '--terminal'], { DECISION_IDE_RESOURCES: res }, JSON.stringify({ session_id: 's9', cwd: dir }))
    const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext as string
    expect(ctx.startsWith('# Decision protocol')).toBe(true)
    expect(ctx).toContain('## The user: developer')
    expect(ctx).toContain('# Signoff AI session\nRegistered on the board as session s9.')
    expect(decide(['hook', 'session-start', '--terminal'], { DECISION_IDE_APP: '1', DECISION_IDE_RESOURCES: res }, JSON.stringify({ session_id: 's8', cwd: dir }))).toMatchObject({ code: 0, out: '' })
    expect(decide(['hook', 'session-start', '--terminal'], {}, JSON.stringify({ session_id: 's9', cwd: dir }))).toMatchObject({ code: 1, err: 'signoff hook: --terminal needs DECISION_IDE_RESOURCES (set by the decide launcher)' })
  })

  it('hook permission: an answer in the app becomes the decision; no answer in time leaves it to the terminal', () => {
    decide([...S, 'register'])
    const db = openStore(join(dir, 'board.db'))
    // A standing "allow for this chat" answers at once (no waiting in this test).
    db.prepare("INSERT INTO approvals (id, session_id, tool_name, input, status, scope, result, created_at) VALUES ('P-1', 's1', 'Bash', ?, 'allowed', 'chat', 'x', 't')").run(JSON.stringify({ command: 'npm test' }))
    db.close()
    const input = (cmd: string): string => JSON.stringify({ session_id: 's1', tool_name: 'Bash', tool_input: { command: cmd }, tool_use_id: 'tu' })
    expect(JSON.parse(decide(['hook', 'permission'], {}, input('npm test')).out)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { command: 'npm test' } } } })
    const r = decide(['hook', 'permission'], { DECISION_IDE_PERMISSION_WAIT_MS: '300' }, input('rm -rf build'))
    expect(r).toMatchObject({ code: 0, out: '' })
    const after = openStore(join(dir, 'board.db'))
    expect(after.prepare("SELECT status FROM approvals WHERE input LIKE '%rm -rf build%'").get()).toEqual({ status: 'terminal' })
    after.close()
  })

  it('post keeps the context points and the cost of a wrong choice; subtask add sets up an unseen ticket', () => {
    decide([...S, 'register', '--ticket', 'ABC-9'])
    expect(decide([...S, 'post', '--ticket', 'ABC-9', '--id', 'D1', '--question', 'Show sessions to partners?', '--context', 'Status is new', '--context', 'Partners lack ids',
      '--option', 'List :: one more endpoint', '--option', 'No list :: smaller', '--recommend', 'List :: needed for polling', '--if-wrong', 'Easy to add later'])).toMatchObject({ code: 0, out: 'ABC-9/D1' })
    expect(decide([...S, 'subtask', 'add', '--ticket', 'ABC-9', '--title', 'Session status'])).toMatchObject({ code: 0, out: 'ABC-9 #1 [planned] Session status' })
    const db = openStore(join(dir, 'board.db'))
    expect(db.prepare("SELECT context, if_wrong FROM decisions WHERE id = 'ABC-9/D1'").get()).toEqual({ context: JSON.stringify(['Status is new', 'Partners lack ids']), if_wrong: 'Easy to add later' })
    expect(db.prepare("SELECT key, folder FROM tickets WHERE key = 'ABC-9'").get()).toEqual({ key: 'ABC-9', folder: realpathSync(dir) })
    db.close()
  })

  it('comment reply records the answer against #cN so it shows by the code', () => {
    const db = openStore(join(dir, 'board.db'))
    const id = Number(db.prepare("INSERT INTO comments (session_id, root, path, start_line, end_line, code, text, status, created_at, updated_at) VALUES ('s1', '/r', 'a.rb', 1, 1, 'x', 'why?', 'sent', 't', 't')").run().lastInsertRowid)
    db.close()
    expect(decide([...S, 'comment', 'list'])).toMatchObject({ code: 0, out: `#c${id} a.rb:1-1 why?` })
    expect(decide([...S, 'comment', 'reply', '--id', `c${id}`, '--text', 'Because of the page size.'])).toMatchObject({ code: 0, out: `#c${id} answered` })
    const after = openStore(join(dir, 'board.db'))
    expect(after.prepare('SELECT status, reply FROM comments WHERE id = ?').get(id)).toEqual({ status: 'answered', reply: 'Because of the page size.' })
    after.close()
  })

  it('reply keeps the line breaks of --text-file; --text still works', () => {
    decide([...S, 'register', '--ticket', 'ABC-7'])
    expect(decide([...S, 'post', '--ticket', 'ABC-7', '--id', 'D1', '--question', 'Which limit?']).code).toBe(0)
    writeFileSync(join(dir, 'answer.md'), '- Today: only the US and EU stores use it.\n- The UK store joins with ABC-1.\n')
    expect(decide([...S, 'reply', '--ticket', 'ABC-7', '--id', 'D1', '--text-file', join(dir, 'answer.md')])).toMatchObject({ code: 0, out: 'ok' })
    expect(decide([...S, 'reply', '--ticket', 'ABC-7', '--id', 'D1', '--text', 'One line.'])).toMatchObject({ code: 0, out: 'ok' })
    expect(decide([...S, 'reply', '--ticket', 'ABC-7', '--id', 'D1']).err).toContain('--text is required')
    const db = openStore(join(dir, 'board.db'))
    expect(db.prepare("SELECT who, text FROM decision_thread WHERE decision_id = 'ABC-7/D1' ORDER BY id").all()).toEqual([
      { who: 's1', text: '- Today: only the US and EU stores use it.\n- The UK store joins with ABC-1.' },
      { who: 's1', text: 'One line.' }
    ])
    db.close()
  })

  it('Stop hook asks once about decisions the chat moved past; settle closes them', () => {
    decide([...S, 'register', '--ticket', 'ABC-8'])
    decide([...S, 'post', '--ticket', 'ABC-8', '--id', 'D1', '--question', 'Which limit?'])
    const db = openStore(join(dir, 'board.db'))
    db.prepare("UPDATE decisions SET created_at = '2026-10-14T09:00:00Z' WHERE id = 'ABC-8/D1'").run()
    db.close()
    const t = join(dir, 'chat.jsonl')
    writeFileSync(t, JSON.stringify({ type: 'user', timestamp: '2026-10-14T10:00:00Z', message: { content: 'just use 5k, skip the card' } }) + '\n')
    const stop = (): string => decide(['hook', 'stop'], {}, JSON.stringify({ session_id: 's1', transcript_path: t })).out
    expect(JSON.parse(stop()).reason).toContain('- ABC-8/D1: Which limit?')
    expect(stop()).toBe('') // asked once
    // Off in Settings: no ask, even for a new stale decision.
    decide([...S, 'post', '--ticket', 'ABC-8', '--id', 'D2', '--question', 'Which currency?'])
    const db2 = openStore(join(dir, 'board.db'))
    db2.prepare("UPDATE decisions SET created_at = '2026-10-14T09:00:00Z' WHERE id = 'ABC-8/D2'").run()
    saveSettings(db2, { tidyDecisions: false })
    db2.close()
    expect(stop()).toBe('')
    expect(decide([...S, 'settle', '--ticket', 'ABC-8', '--id', 'D1', '--text', '5k per day', '--done'])).toMatchObject({ code: 0, out: 'ok' })
    expect(decide([...S, 'list', '--ticket', 'ABC-8']).out).toContain('ABC-8/D1 [applied]')
  })

  it('split reads "Title :: task" pieces; done reports to the lead', () => {
    decide([...S, 'register', '--ticket', 'KA-1'])
    const db = openStore(join(dir, 'board.db'))
    db.prepare("UPDATE sessions SET workflow = 'implement-review' WHERE id = 's1'").run()
    db.close()
    expect(decide([...S, 'split', '--ticket', 'KA-1', '--id', 'D2', '--piece', 'API :: add GET /x :: with paging'])).toMatchObject({ code: 0, out: 'KA-1/D2' })
    expect(decide([...S, 'split', '--ticket', 'KA-1', '--id', 'D3', '--piece', 'no task here'])).toMatchObject({ code: 2, err: 'signoff: --piece needs "Title :: what to do": no task here' })
    const after = openStore(join(dir, 'board.db'))
    expect(JSON.parse((after.prepare("SELECT item FROM decisions WHERE id = 'KA-1/D2'").get() as { item: string }).item).pieces[0]).toEqual({ title: 'API', task: 'add GET /x :: with paging', role: 'implementer' })
    after.close()
  })

  it('hook session-start records where Claude Code saves the conversation and the shared tmux session it runs in', () => {
    decide(['hook', 'session-start'], { DECISION_IDE_TMUX: 'claude-1' }, JSON.stringify({ session_id: 's7', cwd: dir, transcript_path: '/x/s7.jsonl' }))
    const db = openStore(join(dir, 'board.db'))
    expect(db.prepare("SELECT transcript, tmux FROM sessions WHERE id = 's7'").get()).toEqual({ transcript: '/x/s7.jsonl', tmux: 'claude-1' })
    db.close()
  })

  it('hook failures exit 1, never 2', () => {
    expect(decide(['hook', 'stop'], {}, '{}')).toMatchObject({ code: 1, err: 'signoff hook: hook input has no session_id' })
  })

  it('the plugin wrapper runs this CLI with the app-provided node', () => {
    const wrapper = join(__dirname, '../../../resources/decision-protocol/bin/decide')
    const env = { PATH: process.env.PATH!, DECISION_IDE_DB: join(dir, 'board.db'), CLAUDE_CODE_SESSION_ID: 'test-runner' }
    const ok = spawnSync(wrapper, ['list'], { encoding: 'utf8', cwd: dir, env: { ...env, DECISION_IDE_CLI: CLI, DECISION_IDE_NODE: process.execPath } })
    expect(ok.status).toBe(0)
    const bare = spawnSync(wrapper, ['list'], { encoding: 'utf8', cwd: dir, env })
    expect(bare.status).not.toBe(0)
    expect(bare.stderr).toContain('DECISION_IDE_CLI is not set')
  })
})
