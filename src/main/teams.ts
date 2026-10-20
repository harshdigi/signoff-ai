// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as b from '../shared/board'
import { pieceMessage, recordStarted, startPlan, type Piece } from '../shared/team'
import type { Store } from './store'
import { addWorktree } from './workspace'

// Starting a team (IDE/D22, IDE/D23): one child session per approved piece.
// - Implementers (every role except reviewer) get their own branch and worktree, cut from the lead's branch,
//   so parallel work never overwrites. Files changed shows each worktree against the lead's branch.
// - The reviewer works in the lead's folder and reads the implementers' worktrees.
// - Chats are reached through a small port, like the ticket pipeline, so this file has no terminal code.
export interface TeamChatPort {
  create(cwd: string, o: { parent: string; title: string; ticket: string | null; branch: string | null; role: string }): string
  send(session: string, text: string): void
}

const run = promisify(execFile)
const git = async (cwd: string, args: string[]): Promise<string> => (await run('git', args, { cwd })).stdout.trim()
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'piece'
export const ownsWorktree = (p: Piece): boolean => p.role !== 'reviewer'

export class Teams {
  // Splits being started now. A second start of the same split is refused (SIGNOFF-29/D6): the split is recorded as
  // started only after the git work, so without this a double click starts every session twice.
  private starting = new Set<string>()

  constructor(private db: Store, private chat: TeamChatPort) {}

  async start(decision: string, keep: number[]): Promise<string[]> {
    if (this.starting.has(decision)) throw new b.BoardError(`${decision} is already starting`)
    const plan = startPlan(this.db, decision, keep)
    this.starting.add(decision)
    try {
      return await this.launch(decision, plan)
    } finally {
      this.starting.delete(decision)
    }
  }

  private async launch(decision: string, { lead, pieces }: ReturnType<typeof startPlan>): Promise<string[]> {
    if (!lead.cwd) throw new b.BoardError(`session ${lead.id} has no folder to start its team in`)
    const root = await git(lead.cwd, ['rev-parse', '--show-toplevel']).catch(() => {
      throw new b.BoardError(`${lead.cwd} is not a git repository; implementers need their own worktrees`)
    })
    const leadBranch = lead.branch ?? (await git(lead.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))
    if (leadBranch === 'HEAD') throw new b.BoardError('the lead is on a detached HEAD; check out a branch first')
    // Worktrees first: if git refuses one, no session has been created yet.
    const used = new Set<string>()
    const places: { piece: Piece; cwd: string; branch: string; base: string | null }[] = []
    for (const piece of pieces) {
      if (!ownsWorktree(piece)) { places.push({ piece, cwd: lead.cwd, branch: leadBranch, base: null }); continue }
      let branch = `${leadBranch}-${slug(piece.title)}`
      for (let n = 2; used.has(branch); n++) branch = `${leadBranch}-${slug(piece.title)}-${n}`
      used.add(branch)
      places.push({ piece, cwd: await addWorktree(root, branch, leadBranch), branch, base: leadBranch })
    }
    const started = places.map((p) => {
      const session = this.chat.create(p.cwd, { parent: lead.id, title: p.piece.title, ticket: lead.ticket, branch: p.branch, role: p.piece.role })
      if (p.base) this.db.prepare('UPDATE sessions SET base_branch = ? WHERE id = ?').run(p.base, session)
      return { session, piece: p.piece }
    })
    // All children exist and the split is answered before any starts, so each startup brief lists the whole team.
    recordStarted(this.db, decision, started)
    for (const s of started) this.chat.send(s.session, pieceMessage(s.piece))
    return started.map((s) => s.session)
  }
}
