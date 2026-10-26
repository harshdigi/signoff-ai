// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { openStore, type Store } from '../../main/store'
import { saveSettings } from '../../main/settings'
import { pendingMessages, touchSession } from '../board'
import { adoptTeam, finishPiece, passPiece, proposeSplit, proposeTeam, setupLines, startPlan, teamBrief, leadWith } from '../team'
import { getWorkflow, saveWorkflow } from '../../main/workflows'

const setup = (workflow: string | null): Store => {
  const db = openStore(join(mkdtempSync(join(tmpdir(), 'team-')), 'b.db'))
  touchSession(db, 'lead', { cwd: '/repo', title: 'Payments', via: 'chat', branch: 'KA-1-pay' })
  db.prepare('UPDATE sessions SET workflow = ? WHERE id = ?').run(workflow, 'lead')
  return db
}
const child = (db: Store, id: string, role: string, title: string): void => {
  touchSession(db, id, { cwd: '/repo', title, via: 'chat', branch: `KA-1-${id}` })
  db.prepare('UPDATE sessions SET parent_id = ?, role = ? WHERE id = ?').run('lead', role, id)
}

describe('teams', () => {
  it('a lead proposes pieces; fixed roles (the reviewer) are added once', () => {
    const db = setup('parallel')
    const id = proposeSplit(db, { session: 'lead', ticket: 'KA-1', number: 'D3', pieces: [{ title: 'API ', task: ' add the endpoint ' }, { title: 'UI', task: 'add the form' }] })
    const d = db.prepare('SELECT question, kind, item, status FROM decisions WHERE id = ?').get(id) as Record<string, string>
    expect(d).toEqual({
      question: 'Start 3 sessions for this task (Parallel build: N implementers + 1 reviewer)?', kind: 'split', status: 'open',
      item: JSON.stringify({ pieces: [
        { title: 'API', task: 'add the endpoint', role: 'implementer' }, { title: 'UI', task: 'add the form', role: 'implementer' },
        { title: 'reviewer', task: 'Reads each diff from the implementers and posts findings as a review. Never edits code.', role: 'reviewer' }
      ] })
    })
  })

  it('refuses a split without a team setup, or with a role the setup does not have', () => {
    expect(() => proposeSplit(setup(null), { session: 'lead', ticket: 'KA-1', number: 'D1', pieces: [{ title: 'a', task: 'b' }] })).toThrow('this session has no team setup; start one from Workflows to split work')
    expect(() => proposeSplit(setup('parallel'), { session: 'lead', ticket: 'KA-1', number: 'D1', pieces: [{ title: 'a', task: 'b' }], role: 'tester' })).toThrow('tester is not a role in Parallel build (implementer, reviewer)')
  })

  it('starts only the kept pieces, and never more than the cap', () => {
    const db = setup('parallel')
    const id = proposeSplit(db, { session: 'lead', ticket: 'KA-1', number: 'D3', pieces: [{ title: 'A', task: 'a' }, { title: 'B', task: 'b' }, { title: 'C', task: 'c' }] })
    expect(startPlan(db, id, [0, 3]).pieces.map((p) => p.title)).toEqual(['A', 'reviewer'])
    expect(() => startPlan(db, id, [0, 1, 2, 3])).toThrow('that would run 4 child sessions; the cap is 3 (Settings). Drop some pieces or raise the cap.')
    saveSettings(db, { maxChildren: 4 })
    expect(startPlan(db, id, [0, 1, 2, 3]).pieces).toHaveLength(4)
  })

  it('done marks the piece finished and tells the lead and the reviewer', () => {
    const db = setup('implement-review')
    child(db, 'imp', 'implementer', 'API')
    child(db, 'rev', 'reviewer', 'reviewer')
    expect(finishPiece(db, 'imp', 'endpoint added, specs pass')).toEqual(['lead', 'rev'])
    const text = 'implementer "API" (imp) finished on branch KA-1-imp in /repo: endpoint added, specs pass'
    expect(pendingMessages(db, 'lead').map((m) => m.text)).toEqual([text])
    expect(pendingMessages(db, 'rev').map((m) => m.text)).toEqual([text])
    expect(db.prepare("SELECT state FROM sessions WHERE id = 'imp'").get()).toEqual({ state: 'done' })
    expect(() => finishPiece(db, 'lead', 'x')).toThrow('signoff done is for sessions in a team (started from a split)')
  })

  it('the startup brief tells a lead how to split and a child its role and team', () => {
    const db = setup('implement-review')
    expect(teamBrief(db, 'lead')[0]).toBe('## Your team: Implement + review (1 implementer + 1 reviewer)')
    expect(teamBrief(db, 'lead').at(-2)).toBe('The user approves it and the app starts one session per piece (at most 3 at once). Do not start sessions yourself. Their reports reach you as board messages.')
    expect(teamBrief(db, 'lead').at(-1)).toContain('merging makes a commit, so ask first')
    child(db, 'imp', 'implementer', 'API')
    child(db, 'rev', 'reviewer', 'reviewer')
    expect(teamBrief(db, 'imp').slice(0, 3)).toEqual(['## Your role: implementer in a team', 'Lead session: Payments (lead). Your piece is your first message. Others in the team:', '- reviewer "reviewer" (rev)'])
    expect(teamBrief(db, 'rev')).toContain('Review a piece with: git -C <folder> diff KA-1-pay...HEAD (committed) and git -C <folder> diff (not yet committed). Never edit code yourself.')
    db.prepare("UPDATE sessions SET base_branch = 'KA-1-pay', cwd = '/repo/.claude/worktrees/KA-1-imp' WHERE id = 'imp'").run()
    expect(teamBrief(db, 'imp')).toContain('You work in your own worktree, /repo/.claude/worktrees/KA-1-imp, on branch KA-1-imp, cut from KA-1-pay. Other team members cannot see your changes until they are merged.')
  })

  it('a reads-only member is told to work in the lead\'s folder without editing; the lead sees which roles read only', () => {
    const db = setup('oncall')
    saveWorkflow(db, { id: 'oncall', name: 'Oncall', description: '', team: [{ role: 'investigator', count: null, does: 'Reads prod and docs', readsOnly: true }] })
    expect(teamBrief(db, 'lead')[1]).toBe('- investigator (you propose how many) (reads only): Reads prod and docs')
    child(db, 'inv', 'investigator', 'CAMS 4xx')
    expect(teamBrief(db, 'inv').slice(3)).toEqual([
      'Your role reads only (SIGNOFF-40-TEAMS/D1): you work in the lead\'s folder, /repo, with no branch of your own. Do not edit files there.',
      'To suggest a code change, write it as a diff in a temp file and post it with signoff propose.',
      'When your piece is finished, run: signoff done --summary "<what you found>". That tells the lead and the reviewer.'
    ])
  })

  it('the reviewer passing a piece tells the lead to merge that branch', () => {
    const db = setup('implement-review')
    child(db, 'imp', 'implementer', 'API')
    child(db, 'rev', 'reviewer', 'reviewer')
    expect(passPiece(db, 'rev', 'imp', 'looks right')).toBe('lead')
    expect(pendingMessages(db, 'lead').map((m) => m.text)).toEqual(['reviewer passed implementer "API" (imp): looks right. Merge branch KA-1-imp into KA-1-pay when ready (ask first: merging makes a commit), then remove its worktree /repo.'])
    expect(() => passPiece(db, 'imp', 'rev', 'x')).toThrow('signoff pass is for the reviewer in a team')
    expect(() => passPiece(db, 'rev', 'rev', 'x')).toThrow('rev is not an implementer in this team')
  })

  it('a session leads a team from the chat: use an existing setup, or propose one the user approves', () => {
    const db = setup(null)
    expect(setupLines(db)).toEqual(['solo  Solo: one session (built in)', 'implement-review  Implement + review: 1 implementer + 1 reviewer (built in)', 'parallel  Parallel build: N implementers + 1 reviewer (built in)'])
    expect(leadWith(db, 'lead', 'parallel')[0]).toBe('## Your team: Parallel build (N implementers + 1 reviewer)')
    expect(() => leadWith(db, 'lead', 'nope')).toThrow('no team setup nope; signoff team list shows them')
    expect(leadWith(db, 'lead', 'solo')).toEqual([])

    const setupIn = { id: 'per-ticket', name: 'Per ticket', description: 'one implementer per ticket, merged one by one', team: [{ role: 'implementer', count: null, does: 'Builds one ticket' }, { role: 'reviewer', count: 1, does: 'Senior engineer; reviews every piece' }], goodFor: ['Sibling tickets'] }
    const id = proposeTeam(db, { session: 'lead', ticket: 'KA-1', number: 'D9', setup: setupIn })
    expect(db.prepare('SELECT question, kind, status FROM decisions WHERE id = ?').get(id)).toEqual({ question: 'Create the team setup "Per ticket" (N implementers + 1 reviewer) and lead it from this session?', kind: 'team', status: 'open' })
    expect(() => proposeTeam(db, { session: 'lead', ticket: 'KA-1', number: 'D10', setup: { ...setupIn, id: 'Bad Id' } })).toThrow('a workflow id is 2-41 lowercase letters, digits or dashes')

    expect(adoptTeam(db, id)).toBe('per-ticket')
    expect(getWorkflow(db, 'per-ticket')).toMatchObject({ name: 'Per ticket', goodFor: ['Sibling tickets'], notFor: [], builtIn: false })
    expect(db.prepare('SELECT workflow FROM sessions WHERE id = ?').get('lead')).toEqual({ workflow: 'per-ticket' })
    expect(db.prepare('SELECT status, answer FROM decisions WHERE id = ?').get(id)).toEqual({ status: 'answered', answer: 'Create and use: saved "Per ticket" in Workflows; this session leads it' })
    expect(pendingMessages(db, 'lead').map((m) => m.text.split('\n')[0])).toEqual(['The user created the team setup "Per ticket" and made you its lead.'])
    expect(() => adoptTeam(db, id)).toThrow(`${id} is already answered`)
    expect(() => proposeTeam(db, { session: 'lead', ticket: 'KA-1', number: 'D11', setup: setupIn })).toThrow('a team setup per-ticket already exists; use it (signoff team use --workflow per-ticket) or pick another --name')
  })
})

