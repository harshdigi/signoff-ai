// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as b from '../../shared/board'
import * as tk from '../../shared/tickets'
import { readBoard } from '../board-state'
import { Pipeline, type ChatPort } from '../pipeline'
import { DEFAULTS, type Settings } from '../settings'
import { openStore, type Store } from '../store'

let db: Store
let root: string
let settings: Settings
let sent: { session: string; text: string }[]
let made: { cwd: string; o: Record<string, unknown> }[]
const port: ChatPort = {
  create: (cwd, o) => {
    const id = `chat-${made.length + 1}`
    made.push({ cwd, o })
    b.touchSession(db, id, { cwd, via: 'chat', ticket: o.ticket ?? undefined, branch: o.branch ?? undefined })
    return id
  },
  send: (session, text) => {
    sent.push({ session, text })
  }
}
const g = (cwd: string, ...a: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' }).trim()

beforeEach(() => {
  db = openStore(join(mkdtempSync(join(tmpdir(), 'pipe-db-')), 'board.db'))
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pipe-repo-')))
  g(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.rb'), 'x\n')
  g(root, 'add', '.')
  g(root, 'commit', '-qm', 'init')
  settings = { ...DEFAULTS }
  sent = []
  made = []
})

describe('tickets and subtasks', () => {
  it('validates keys, numbers subtasks, links decisions and builds branch names', () => {
    expect(() => tk.createTicket(db, { key: 'nope', folder: root, strategy: 'main' })).toThrow('not an issue key: nope')
    const t = tk.createTicket(db, { key: 'abc-7', folder: root, strategy: 'main' })
    expect(t.key).toBe('ABC-7')
    expect(() => tk.createTicket(db, { key: 'ABC-7', folder: root, strategy: 'main' })).toThrow('ABC-7 is already started')
    const s1 = tk.addSubtask(db, 'ABC-7', { title: 'Add the origin column!', decisions: ['d1', 'ABC-7/D2'] })
    const s2 = tk.addSubtask(db, 'ABC-7', { title: 'Filter invoices by customer', jira: 'abc-9015' })
    expect([s1.idx, s1.decisions, s2.idx, s2.jira_key]).toEqual([1, ['ABC-7/D1', 'ABC-7/D2'], 2, 'ABC-9015'])
    expect(tk.branchName('{KEY}-{slug}', t, s1)).toBe('ABC-7-add-the-origin-column')
    expect(tk.branchName('{KEY}-{slug}', t, s2)).toBe('ABC-9015-filter-invoices-by-customer')
    expect(tk.branchName('feature/{TICKET}-{n}', t, s2)).toBe('feature/ABC-7-2')
    expect(() => tk.updateSubtask(db, 'ABC-7', 1, { status: 'shipped' as never })).toThrow('status is one of planned, in_progress, review, done')
    expect(readBoard(db).tickets.map((x) => [x.key, x.subtasks.map((s) => s.idx)])).toEqual([['ABC-7', [1, 2]]])
  })
})

describe('Pipeline', () => {
  it('start opens a planning chat with the plan prompt', () => {
    const r = new Pipeline(db, port, () => settings).start(root, 'ABC-7', { description: 'Customers see only their invoices.' })
    expect(r.ticket.plan_session).toBeNull()
    expect(tk.getTicket(db, 'ABC-7').plan_session).toBe(r.session)
    expect(made[0]).toEqual({ cwd: root, o: { ticket: 'ABC-7', title: 'ABC-7 · plan' } })
    expect(sent[0].text).toContain('The ticket, as the user pasted it:\nCustomers see only their invoices.')
    expect(sent[0].text).toContain('signoff subtask add --ticket ABC-7 --title "..." --decision D1 --decision D2')
  })

  it('each subtask gets a branch from the base, a worktree and a chat with its decisions', async () => {
    const p = new Pipeline(db, port, () => settings)
    p.start(root, 'ABC-7', {})
    b.postDecision(db, { ticket: 'ABC-7', number: 'D1', session: 'chat-1', question: 'Column or metadata?' })
    b.answer(db, 'ABC-7/D1', 'A real column', 'board')
    tk.addSubtask(db, 'ABC-7', { title: 'Add origin column', decisions: ['D1'] })
    tk.addSubtask(db, 'ABC-7', { title: 'Filter invoices' })
    const s = await p.startSubtask('ABC-7', 1)
    expect([s.branch, s.status, s.session_id]).toEqual(['ABC-7-add-origin-column', 'in_progress', 'chat-2'])
    expect(s.worktree).toBe(join(root, '.claude/worktrees/ABC-7-add-origin-column'))
    expect(existsSync(join(s.worktree!, 'a.rb'))).toBe(true)
    expect(g(s.worktree!, 'branch', '--show-current')).toBe('ABC-7-add-origin-column')
    // Grouped under the ticket's plan session in the Sessions list.
    expect(made[1]).toEqual({ cwd: s.worktree, o: { ticket: 'ABC-7', branch: 'ABC-7-add-origin-column', title: 'ABC-7 #1 · Add origin column', parent: tk.getTicket(db, 'ABC-7').plan_session } })
    expect(sent[1].text).toContain('You are in a git worktree on branch ABC-7-add-origin-column, based on main.')
    expect(sent[1].text).toContain('- ABC-7/D1: Column or metadata? -> A real column')
    await expect(p.startSubtask('ABC-7', 1)).rejects.toThrow('subtask 1 is already in_progress')
    const s2 = await p.startSubtask('ABC-7', 2)
    expect(g(s2.worktree!, 'merge-base', '--is-ancestor', 'main', 'HEAD')).toBe('')
  })

  it('stacked: a subtask branches from the previous one and records it as its base', async () => {
    settings = { ...settings, branching: 'stacked' }
    const p = new Pipeline(db, port, () => settings)
    p.start(root, 'ABC-8', {})
    tk.addSubtask(db, 'ABC-8', { title: 'Part one' })
    tk.addSubtask(db, 'ABC-8', { title: 'Part two' })
    await expect(p.startSubtask('ABC-8', 2)).rejects.toThrow('stacked: start subtask 1 first, this one branches from it')
    const one = await p.startSubtask('ABC-8', 1)
    writeFileSync(join(one.worktree!, 'one.rb'), '1\n')
    g(one.worktree!, 'add', '.')
    g(one.worktree!, 'commit', '-qm', 'one')
    const two = await p.startSubtask('ABC-8', 2)
    expect(existsSync(join(two.worktree!, 'one.rb'))).toBe(true)
    expect(db.prepare('SELECT base_branch FROM sessions WHERE id = ?').get(two.session_id)).toEqual({ base_branch: 'ABC-8-part-one' })
    expect(sent.at(-1)!.text).toContain('based on ABC-8-part-one')
  })

  it('open PR asks the subtask chat, with consent first', async () => {
    const p = new Pipeline(db, port, () => settings)
    p.start(root, 'ABC-9', {})
    tk.addSubtask(db, 'ABC-9', { title: 'Only part' })
    expect(() => p.openPr('ABC-9', 1, false)).toThrow('subtask 1 has not started')
    const s = await p.startSubtask('ABC-9', 1)
    p.openPr('ABC-9', 1, true)
    expect(sent.at(-1)).toEqual({ session: s.session_id, text: 'Open a pull request for subtask 1 (Only part) from branch ABC-9-only-part.\nUse the create-pr skill.\nAsk for consent first (signoff post --action consent), and push only after approval.' })
  })
})
