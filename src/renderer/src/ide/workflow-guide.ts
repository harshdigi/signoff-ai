// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Role } from './types'

// Guidance for team setups (Workflows tab): which built-in fits a task, what a setup will do step by step,
// and what in a custom setup will not work the way it reads. Mirrors how shared/team.ts and main/teams.ts run a team:
// - the first role gets one session per piece the lead proposes;
// - every other role with a count joins once per count; one with no count only starts if the lead picks it;
// - a reads-only role works in the lead's folder with no worktree; only a role named exactly "reviewer" gets the
//   implementers' reports.

// Mirrors readsOnly in main/workflows.ts: setups saved before the flag treat "reviewer" as reads only.
export const readsOnly = (r: { role: string; readsOnly?: boolean }): boolean => r.readsOnly ?? r.role === 'reviewer'

export type Answers = { size: 'small' | 'feature' | 'large'; parts: 'one' | 'independent'; risk: 'low' | 'high' }
export type Pick = { id: 'solo' | 'implement-review' | 'parallel'; why: string }

export function recommend(a: Answers): Pick {
  if (a.parts === 'independent' && a.size !== 'small') return { id: 'parallel', why: 'It splits into parts that do not touch each other, so they can be built at the same time; one reviewer checks them all.' }
  if (a.risk === 'high') return { id: 'implement-review', why: 'Mistakes are costly, so a second session reads every change before you do.' }
  if (a.size === 'large') return { id: 'implement-review', why: 'It is big but hangs together, so one builder with a reviewer beats splitting it.' }
  return { id: 'solo', why: 'Small and low-risk: one session is the fastest and cheapest.' }
}

const plural = (n: number | null, role: string): string => (n === 1 ? `1 ${role}` : `${n ?? 'N'} ${role}s`)

// How many sessions run, the lead included.
export function sessionsLine(team: Role[]): string {
  if (!team.length) return '1 session'
  const [first, ...rest] = team
  const parts = [`1 lead`, first.count === null ? `1 ${first.role} per piece` : plural(first.count, first.role), ...rest.filter((r) => r.count !== null).map((r) => plural(r.count, r.role))]
  return parts.join(' + ')
}

// What happens, step by step, for this team.
export function flowSteps(team: Role[]): string[] {
  if (!team.length) return ['One session does the whole task. No split, no extra sessions.']
  const [first, ...rest] = team
  const reviewer = team.some((r) => r.role === 'reviewer')
  const fixed = rest.filter((r) => r.count !== null && r.role !== 'reviewer')
  return [
    'You start the lead session and give it the task.',
    `Once the task is clear, the lead proposes a split: one ${first.role} per piece${first.count !== null ? ` (this setup expects ${first.count})` : ''}. You approve it and can drop pieces.`,
    ...fixed.map((r) => `${plural(r.count, r.role)} also join${r.count === 1 ? 's' : ''}: ${r.does || 'no description yet'}`),
    readsOnly(first)
      ? `Each ${first.role} reads only: it works in the lead's folder, with no branch or worktree, and suggests changes as diffs.`
      : `Each ${first.role} works on its own branch and worktree, cut from the lead's branch, so no one overwrites anyone.`,
    reviewer
      ? `The reviewer reads each finished piece and posts findings. A good piece is passed, which tells the lead to merge it.`
      : `There is no reviewer, so finished pieces go straight to the lead.`,
    ...(team.some((r) => !readsOnly(r)) ? ['The lead merges each branch into its own after asking you (merging makes a commit), then removes the worktree.'] : [])
  ]
}

// Things in a setup that will not work the way they read, or will cost more than expected.
export function warnings(team: Role[], cap: number): string[] {
  if (!team.length) return []
  const out: string[] = []
  const names = team.map((r) => r.role.trim().toLowerCase())
  if (new Set(names).size < names.length) out.push('Two roles have the same name: give each a different one.')
  if (!names.includes('reviewer')) out.push('No reviewer: nobody reads the diffs before you do.')
  for (const r of team) {
    const n = r.role.trim().toLowerCase()
    if (n !== 'reviewer' && /review/.test(n)) out.push(`Only a role named exactly "reviewer" gets the implementers' reports. "${r.role}" will not get them${readsOnly(r) ? '' : ', and it edits code in its own worktree unless you mark it reads only'}.`)
  }
  const reviewers = team.find((r) => r.role === 'reviewer')
  if (reviewers && reviewers.count !== null && reviewers.count > 1) out.push(`${reviewers.count} reviewers each review every piece: more cost, rarely more value.`)
  if (team[0]?.role === 'reviewer') out.push('The reviewer is the first role, so the lead would give each piece to a reviewer, which never edits code. Put the builders first.')
  for (const r of team.slice(1)) if (r.count === null) out.push(`"${r.role}" has no count and is not the first role, so it only starts if the lead picks it for its pieces.`)
  const children = (team[0].count ?? 1) + team.slice(1).reduce((s, r) => s + (r.count ?? 0), 0)
  if (children > cap) out.push(`This starts at least ${children} sessions under the lead, but Settings allows ${cap}. The start will be refused: lower the counts or raise the cap.`)
  return out
}
