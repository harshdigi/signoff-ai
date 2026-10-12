// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as b from '../shared/board'
import * as tk from '../shared/tickets'
import type { Settings } from './settings'
import type { Store } from './store'
import { addWorktree, baseBranch } from './workspace'

// The ticket pipeline (IDE/D16 C): ticket -> planning chat -> decisions -> subtasks ->
// one branch + worktree + chat per subtask -> implement decision by decision -> PR.
// Chats are reached through a small port, so this file has no process or UI code.
export interface ChatPort {
  create(cwd: string, o: { ticket?: string | null; branch?: string | null; title?: string; parent?: string }): string
  send(session: string, text: string): void
}

const run = promisify(execFile)
const git = async (cwd: string, args: string[]): Promise<string> => (await run('git', args, { cwd })).stdout.trim()

export function planPrompt(key: string, description: string, hasSkill: boolean): string {
  return [
    `Plan ticket ${key}.`,
    description.trim() ? `The ticket, as the user pasted it:\n${description.trim()}` : `1. Read the ticket: use the Jira tool if one is connected; otherwise ask me to paste it.`,
    '2. Read the code it touches, and any flow docs for that area.',
    '3. Post every open question as a decision. The decision levels apply: do not ask what the code already settles.',
    `4. When the decisions you need are settled, split the work into small subtasks, each one PR, in order:\n   signoff subtask add --ticket ${key} --title "..." --decision D1 --decision D2   (the decisions it implements)`,
    `5. Then ask for consent to create the subtasks in Jira (signoff post ... --action consent). Once approved, create them with the Jira tool and record each key:\n   signoff subtask set --ticket ${key} --idx <n> --jira <KEY-123>`,
    ...(hasSkill ? ['If a start-ticket skill is available, follow its planning steps, but do not create branches: the app creates a branch and worktree per subtask.'] : []),
    'Do not write code in this chat.'
  ].join('\n')
}

export function implementPrompt(t: tk.Ticket, s: tk.Subtask, base: string, decisions: { id: string; question: string; answer: string | null }[]): string {
  return [
    `Implement subtask ${s.idx} of ${t.key}: ${s.title}${s.jira_key ? ` (${s.jira_key})` : ''}.`,
    `You are in a git worktree on branch ${s.branch}, based on ${base}.`,
    '',
    'Decisions this subtask implements:',
    ...(decisions.length ? decisions.map((d) => `- ${d.id}: ${d.question} -> ${d.answer ?? '(not answered yet: wait for it)'}`) : ['- none listed: check the ticket decisions on the board']),
    '',
    'Work one decision at a time. Propose each change as a review before editing, and run the related specs.',
    'Post anything new as a decision.',
    `When the subtask is done, say so and run: signoff subtask set --ticket ${t.key} --idx ${s.idx} --status review`
  ].join('\n')
}

export class Pipeline {
  constructor(private db: Store, private chat: ChatPort, private settings: () => Settings) {}

  start(folder: string, key: string, o: { title?: string; description?: string; hasStartSkill?: boolean }): { ticket: tk.Ticket; session: string } {
    const ticket = tk.createTicket(this.db, { key, title: o.title, folder, strategy: this.settings().branching })
    const session = this.chat.create(folder, { ticket: ticket.key, title: `${ticket.key} · plan` })
    tk.setPlanSession(this.db, ticket.key, session)
    this.chat.send(session, planPrompt(ticket.key, o.description ?? '', !!o.hasStartSkill))
    return { ticket, session }
  }

  // A branch and worktree per subtask. Stacked: on the previous subtask's branch; else on the base branch.
  async startSubtask(key: string, idx: number): Promise<tk.Subtask> {
    const t = tk.getTicket(this.db, key)
    let s = tk.getSubtask(this.db, key, idx)
    if (s.status !== 'planned') throw new b.BoardError(`subtask ${idx} is already ${s.status}`)
    const root = await git(t.folder, ['rev-parse', '--show-toplevel'])
    let base: string | null
    if (t.strategy === 'stacked' && idx > 1) {
      const prev = tk.getSubtask(this.db, key, idx - 1)
      if (!prev.branch) throw new b.BoardError(`stacked: start subtask ${idx - 1} first, this one branches from it`)
      base = prev.branch
    } else base = await baseBranch(root)
    if (!base) throw new b.BoardError('no base branch found (no origin/HEAD, main or master)')
    const branch = tk.branchName(this.settings().branchTemplate, t, s)
    const worktree = await addWorktree(root, branch, base)
    // Under the ticket's plan session in the Sessions list, like a team's members under their lead.
    const session = this.chat.create(worktree, { ticket: t.key, branch, title: `${t.key} #${idx} · ${s.title}`, parent: t.plan_session ?? undefined })
    if (t.strategy === 'stacked') this.db.prepare('UPDATE sessions SET base_branch = ? WHERE id = ?').run(base, session)
    s = tk.updateSubtask(this.db, key, idx, { branch, worktree, session_id: session, status: 'in_progress' })
    const decisions = s.decisions.map((id) => this.db.prepare('SELECT id, question, answer FROM decisions WHERE id = ?').get(id) as { id: string; question: string; answer: string | null } | undefined)
      .filter((d): d is { id: string; question: string; answer: string | null } => !!d)
    this.chat.send(session, implementPrompt(t, s, base, decisions))
    return s
  }

  openPr(key: string, idx: number, hasSkill: boolean): void {
    const s = tk.getSubtask(this.db, key, idx)
    if (!s.session_id) throw new b.BoardError(`subtask ${idx} has not started`)
    this.chat.send(s.session_id, [
      `Open a pull request for subtask ${idx} (${s.title}) from branch ${s.branch}.`,
      hasSkill ? 'Use the create-pr skill.' : 'Use gh pr create. Description: the problem first, what changed, the decisions it implements (with ids), and the tests you ran.',
      'Ask for consent first (signoff post --action consent), and push only after approval.'
    ].join('\n'))
  }
}
