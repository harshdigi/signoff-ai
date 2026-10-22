// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'
import { getSetup, type Monitor } from '../shared/monitors'
import type { Setup } from './monitor-setup'
import { headlessArgs } from './headless'

// Error checks (SIGNOFF-23 step 6, D3): during the stability window, at the interval you picked, a short headless Claude
// run reads the repo's error tool (Scout for you; any app the setup found) and says whether errors started after the
// deploy. Only that tool's read tools are allowed; nothing is edited or sent.
export type Verdict = { newErrors: boolean; summary: string; evidence: string[] }
type Chosen = { errors?: { app: string; services: string[] } } | null

// Claude Code names MCP tools mcp__<server>__<tool>; the setup may list the short name.
export const fullTool = (mcp: string, tool: string): string => (tool.startsWith('mcp__') ? tool : `mcp__${mcp.replace(/[^\w-]/g, '_')}__${tool}`)

export function errorTool(db: Store, repo: string): { app: string; mcp: string; tools: string[]; services: string[] } | null {
  const s = getSetup<Setup & { chosen: Chosen }>(db, repo)
  if (!s) return null
  const pick = s.chosen?.errors
  const found = pick ? s.found.errors.find((e) => e.app === pick.app) : s.found.errors[0]
  if (!found) return null
  return { app: found.app, mcp: found.mcp, tools: found.tools.map((t) => fullTool(found.mcp, t)), services: pick?.services.length ? pick.services : found.services }
}

export function errorPrompt(m: Monitor, t: { app: string; services: string[] }, nowIso: string): string {
  return [
    `Check production errors in ${t.app} for the services ${t.services.join(', ')}. READ-ONLY: do not change, acknowledge or send anything.`,
    `A change (${m.repo}#${m.pr}${m.ticket ? `, ${m.ticket}` : ''}) was deployed at ${m.deployed_at}. Now it is ${nowIso}.`,
    'Compare the time since the deploy with the same length of time just before it: new error types, error rate, failing',
    'endpoints or jobs. Count something only if it started or clearly rose after the deploy; ignore what was already there.',
    'Reply with ONLY this JSON between <verdict> and </verdict>:',
    '{ "newErrors": true|false, "summary": "one line", "evidence": ["what you saw, with counts and names"] }'
  ].join('\n')
}

export function parseVerdict(out: string): Verdict {
  const m = /<verdict>([\s\S]*?)<\/verdict>/.exec(out)
  if (!m) throw new Error(`the error check did not return a verdict: ${out.slice(0, 200)}`)
  const v = JSON.parse(m[1]) as Verdict
  if (typeof v.newErrors !== 'boolean' || typeof v.summary !== 'string' || !Array.isArray(v.evidence)) throw new Error('the error check verdict is incomplete')
  return v
}

export async function checkErrors(db: Store, m: Monitor, run: (args: string[]) => Promise<{ code: number; out: string }>, nowIso: string): Promise<Verdict> {
  const t = errorTool(db, m.repo)
  if (!t) throw new Error('no error tool is set up for this repo (Re-scan apps in Ship)')
  const r = await run(headlessArgs(errorPrompt(m, t, nowIso), { allow: t.tools, disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  if (r.code !== 0) throw new Error(`the error check failed: ${r.out.slice(0, 200)}`)
  return parseVerdict(r.out)
}
