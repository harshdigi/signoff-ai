// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { answer, BoardError, postDecision, queueMessage, touchSession } from './board'
import type { Store } from '../main/store'
import { getSettings } from '../main/settings'
import { checkWorkflow, getWorkflow, listWorkflows, saveWorkflow, teamLine, type WorkflowInput } from '../main/workflows'

// Teams (IDE/D22): a session started with a team setup splits its task into child sessions.
// - The lead proposes the split as a decision (kind 'split'); you approve it, optionally dropping pieces.
// - The app then starts one session per piece, up to the cap in Settings (maxChildren).
// - Children report back with `signoff done`, which messages the lead and the reviewers.

export type Piece = { title: string; task: string; role: string }
type Row = { id: string; title: string | null; ticket: string | null; branch: string | null; base_branch: string | null; cwd: string | null; workflow: string | null; role: string | null; parent_id: string | null; state: string; archived: number }

const need = (cond: unknown, msg: string): void => {
  if (!cond) throw new BoardError(msg)
}
const session = (db: Store, id: string): Row => {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined
  need(s, `no session ${id}`)
  return s!
}
const children = (db: Store, parent: string): Row[] =>
  db.prepare("SELECT * FROM sessions WHERE parent_id = ? AND archived = 0 AND state != 'done' AND role IS NOT NULL").all(parent) as Row[]
const name = (s: Row): string => s.title || s.id.slice(0, 8)

// The lead's proposal. Pieces get `role` (default: the setup's first role). Roles with a fixed count that are not
// the pieces' role (e.g. 1 reviewer) are added once each.
export function proposeSplit(db: Store, p: { session: string; ticket: string; number: string; pieces: { title: string; task: string }[]; role?: string }): string {
  const lead = session(db, p.session)
  need(lead.workflow, 'this session has no team setup; start one from Workflows to split work')
  need(p.pieces.length, 'give at least one --piece "Title :: what to do"')
  const w = getWorkflow(db, lead.workflow!)
  const role = p.role ?? w.team[0]?.role
  need(role && w.team.some((r) => r.role === role), `${role} is not a role in ${w.name} (${w.team.map((r) => r.role).join(', ')})`)
  const fixed = w.team.filter((r) => r.role !== role && r.count !== null).flatMap((r) => Array.from({ length: r.count! }, () => ({ title: r.role, task: r.does, role: r.role })))
  const pieces: Piece[] = [...p.pieces.map((x) => ({ title: x.title.trim(), task: x.task.trim(), role: role! })), ...fixed]
  need(pieces.every((x) => x.title && x.task), 'each piece needs a title and a task: "Title :: what to do"')
  const id = postDecision(db, {
    ticket: p.ticket, number: p.number, session: p.session,
    question: `Start ${pieces.length} sessions for this task (${w.name}: ${teamLine(w)})?`,
    options: ['Start them', 'Not now'], recommend: 'Start them'
  })
  db.prepare("UPDATE decisions SET kind = 'split', item = ? WHERE id = ?").run(JSON.stringify({ pieces }), id)
  return id
}

// What the app starts when you approve: the kept pieces, if they fit under the cap. Nothing is written.
export function startPlan(db: Store, decision: string, keep: number[]): { lead: Row; pieces: Piece[] } {
  const d = db.prepare('SELECT session_id, kind, item, status FROM decisions WHERE id = ?').get(decision) as { session_id: string; kind: string | null; item: string | null; status: string } | undefined
  need(d && d.kind === 'split', `${decision} is not a split`)
  need(d!.status === 'open', `${decision} is already ${d!.status}`)
  const all = (JSON.parse(d!.item!) as { pieces: Piece[] }).pieces
  const pieces = keep.map((i) => all[i]).filter(Boolean)
  need(pieces.length, 'keep at least one piece, or answer "Not now"')
  const lead = session(db, d!.session_id)
  const cap = getSettings(db).maxChildren
  const running = children(db, lead.id).length
  need(running + pieces.length <= cap, `that would run ${running + pieces.length} child sessions; the cap is ${cap} (Settings). Drop some pieces or raise the cap.`)
  return { lead, pieces }
}

// After the app started them: answer the split, and tell the lead who is doing what.
export function recordStarted(db: Store, decision: string, started: { session: string; piece: Piece }[]): void {
  const lines = started.map((s) => `- ${s.piece.role} "${s.piece.title}": session ${s.session}`)
  answer(db, decision, `Started ${started.length}:\n${lines.join('\n')}`, 'user (app)')
}

// The first message a child gets.
export const pieceMessage = (p: Piece): string => `Your piece: ${p.title}\n\n${p.task}`

// Context for the startup hook: how a lead splits work, or what a child's role is and how it reports.
export function teamBrief(db: Store, id: string): string[] {
  const s = session(db, id)
  if (s.role && s.parent_id) {
    const lead = session(db, s.parent_id)
    const team = children(db, lead.id).filter((c) => c.id !== s.id)
    const lines = [
      `## Your role: ${s.role} in a team`,
      `Lead session: ${name(lead)} (${lead.id}). Your piece is your first message. Others in the team:`,
      ...(team.length ? team.map((c) => `- ${c.role} "${name(c)}" (${c.id})`) : ['- none yet'])
    ]
    if (s.role === 'reviewer') {
      lines.push(
        'Implementers each work in their own worktree; each `signoff done` report reaches you as a board message with the branch and folder.',
        `Review a piece with: git -C <folder> diff ${lead.branch ?? '<lead branch>'}...HEAD (committed) and git -C <folder> diff (not yet committed). Never edit code yourself.`,
        'When a piece is good: signoff pass --of <its session id> --summary "<why>". That tells the lead to merge it. Otherwise post your findings as decisions or a review, and message nothing else.'
      )
    } else {
      if (s.base_branch) lines.push(`You work in your own worktree, ${s.cwd}, on branch ${s.branch}, cut from ${s.base_branch}. Other team members cannot see your changes until they are merged.`)
      lines.push('When your piece is finished and checked, commit it on your branch (ask first, as for any commit), then run: signoff done --summary "<what you did>". That tells the lead and the reviewer.')
    }
    return lines
  }
  if (s.workflow && s.workflow !== 'solo') {
    const w = getWorkflow(db, s.workflow)
    return [
      `## Your team: ${w.name} (${teamLine(w)})`,
      ...w.team.map((r) => `- ${r.role}${r.count === null ? ' (you propose how many)' : ` x${r.count}`}: ${r.does}`),
      'You lead. Once the task is clear, propose the split: signoff split --ticket <KEY> --id D<n> --piece "Title :: what to do" (one --piece per piece of work).',
      `The user approves it and the app starts one session per piece (at most ${getSettings(db).maxChildren} at once). Do not start sessions yourself. Their reports reach you as board messages.`,
      'Implementers work in their own worktrees and branches, cut from yours. When the reviewer passes a piece, merge its branch into yours: merging makes a commit, so ask first (signoff post --action consent). After the merge, remove its worktree: git worktree remove <folder>.'
    ]
  }
  return []
}

// A child finished its piece: mark it done, tell the lead and the reviewers.
export function finishPiece(db: Store, id: string, summary: string): string[] {
  const s = session(db, id)
  need(s.role && s.parent_id, 'signoff done is for sessions in a team (started from a split)')
  need(summary.trim(), 'say what you did: signoff done --summary "..."')
  const text = `${s.role} "${name(s)}" (${s.id}) finished${s.branch ? ` on branch ${s.branch}` : ''}${s.cwd ? ` in ${s.cwd}` : ''}: ${summary.trim()}`
  const to = [s.parent_id!, ...children(db, s.parent_id!).filter((c) => c.role === 'reviewer' && c.id !== s.id).map((c) => c.id)]
  db.transaction(() => {
    touchSession(db, id, { state: 'done', note: summary.trim().slice(0, 200) })
    for (const t of to) queueMessage(db, t, text, `session ${s.id}`)
  })()
  return to
}

// The reviewer passed a piece: tell the lead it can merge that branch.
export function passPiece(db: Store, reviewer: string, of: string, summary: string): string {
  const r = session(db, reviewer)
  need(r.role === 'reviewer' && r.parent_id, 'signoff pass is for the reviewer in a team')
  const p = session(db, of)
  need(p.parent_id === r.parent_id && p.role !== 'reviewer', `${of} is not an implementer in this team`)
  const lead = session(db, r.parent_id!)
  queueMessage(db, lead.id, `reviewer passed ${p.role} "${name(p)}" (${p.id}): ${summary.trim() || 'no notes'}. Merge branch ${p.branch} into ${lead.branch ?? 'your branch'} when ready (ask first: merging makes a commit), then remove its worktree ${p.cwd}.`, `session ${r.id}`)
  return lead.id
}

// ---- team setups from a session (signoff team) ----------------------------------------------------------------
// A session can make itself the lead of a team without the Workflows screen:
// - use: an existing setup (the user still approves the split that follows, so this needs no approval itself);
// - propose: a new setup, as a decision the user approves on the board; approving saves it and makes this session its lead.

export const setupLines = (db: Store): string[] => listWorkflows(db).map((w) => `${w.id}  ${w.name}: ${teamLine(w)}${w.builtIn ? ' (built in)' : ''}`)

export function leadWith(db: Store, id: string, workflow: string): string[] {
  session(db, id)
  need(listWorkflows(db).some((w) => w.id === workflow), `no team setup ${workflow}; signoff team list shows them`)
  db.prepare('UPDATE sessions SET workflow = ? WHERE id = ?').run(workflow === 'solo' ? null : workflow, id)
  return teamBrief(db, id)
}

export function proposeTeam(db: Store, p: { session: string; ticket: string; number: string; setup: WorkflowInput }): string {
  session(db, p.session)
  try {
    checkWorkflow(p.setup)
  } catch (e) {
    throw new BoardError((e as Error).message)
  }
  need(!listWorkflows(db).some((w) => w.id === p.setup.id), `a team setup ${p.setup.id} already exists; use it (signoff team use --workflow ${p.setup.id}) or pick another --name`)
  const w = { ...p.setup, goodFor: p.setup.goodFor ?? [], notFor: p.setup.notFor ?? [] }
  const id = postDecision(db, {
    ticket: p.ticket, number: p.number, session: p.session,
    question: `Create the team setup "${w.name}" (${teamLine({ ...w, builtIn: false })}) and lead it from this session?`,
    context: [w.description, ...w.team.map((r) => `${r.count ?? 'N'} x ${r.role}: ${r.does}`)].filter((x) => x.trim()),
    options: ['Create and use :: saves the setup in Workflows and makes this session its lead; the split still waits for you', 'Not now'],
    recommend: 'Create and use'
  })
  db.prepare("UPDATE decisions SET kind = 'team', item = ? WHERE id = ?").run(JSON.stringify(w), id)
  return id
}

// The user approved a proposed setup: save it, make the proposing session its lead, and tell that session.
export function adoptTeam(db: Store, decision: string): string {
  const d = db.prepare('SELECT session_id, kind, item, status FROM decisions WHERE id = ?').get(decision) as { session_id: string; kind: string | null; item: string | null; status: string } | undefined
  need(d && d.kind === 'team', `${decision} is not a team setup proposal`)
  need(d!.status === 'open', `${decision} is already ${d!.status}`)
  const saved = saveWorkflow(db, JSON.parse(d!.item!) as WorkflowInput)
  db.transaction(() => {
    answer(db, decision, `Create and use: saved "${saved.name}" in Workflows; this session leads it`, 'user (app)')
    const brief = leadWith(db, d!.session_id, saved.id)
    queueMessage(db, d!.session_id, [`The user created the team setup "${saved.name}" and made you its lead.`, ...brief].join('\n'), 'board')
  })()
  return saved.id
}
