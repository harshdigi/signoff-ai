// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'
import { addEvent, alreadyRaised, getSetup, raisedKey, type Monitor, type Recipient } from '../shared/monitors'
import type { Setup } from './monitor-setup'
import { headlessArgs } from './headless'

// The review request (SIGNOFF-23 step 5): when CI passes on a monitor whose box was ticked (D2: opt-in, sent without
// asking again), a short headless Claude run posts one fixed line to each recipient, with whatever messaging app the
// setup found for it (D6: Slack, Teams, Zoho Cliq, …).
// - The text is ours, never Claude's wording; Claude only fits the mentions to the app's format.
// - Only each app's send and search tools are allowed in that run (permission prompts are off, so nothing else that
//   needs approval runs).
// - Never raised twice (SIGNOFF-31/D3): a destination this app already sent to for the PR is skipped, and the run first
//   searches each channel for the PR link and does not post where it is found. An app with no search tool in the setup
//   is not searched; that is recorded on the timeline.
export type Pr = { title: string; url: string }
export type Sent = { app: string; where: string; ok: boolean; found?: string; error?: string }
type Send = Recipient & { sendTool: string; searchTool?: string | null }

export const reviewLine = (m: Monitor, pr: Pr): string => `PR up for review: ${m.ticket ? `${m.ticket} ` : ''}${pr.title} — ${pr.url}`

export function notifyPrompt(line: string, url: string, sends: Send[]): string {
  return [
    'Post a message with your messaging tools. Send exactly what is described here and nothing else; change nothing else.',
    ...sends.map((r, i) => `${i + 1}. ${r.searchTool ? `First, with ${r.searchTool}, search ${r.where} for a message that contains ${url}. If one exists, do not post there; report it as found. Otherwise, w` : 'W'}ith ${r.sendTool} (${r.app}), post to ${r.where}: "${line}"${r.tags.length ? `, mentioning ${r.tags.join(', ')} at the end in ${r.app}'s mention format` : ''}.`),
    'Do not reword, translate or add to the text. If a destination or mention cannot be resolved, do not post there; report it.',
    'Reply with ONLY a JSON list between <sent> and </sent>: [{ "app": "…", "where": "…", "ok": true|false, "found": "…when an earlier message was found: its time or link", "error": "…when not ok" }]'
  ].join('\n')
}

export function parseSent(out: string): Sent[] {
  const m = /<sent>([\s\S]*?)<\/sent>/.exec(out)
  if (!m) throw new Error(`the message run did not report what it sent: ${out.slice(0, 200)}`)
  const list = JSON.parse(m[1]) as Sent[]
  if (!Array.isArray(list)) throw new Error('the message run report is not a list')
  return list
}

// Which send tool each recipient's app uses, from the repo's setup. A recipient whose app the setup does not know is
// reported, not guessed.
export function plan(db: Store, m: Monitor): { sends: Send[]; unknown: Recipient[] } {
  return sendsFor(db, m.repo, JSON.parse(m.recipients ?? '[]') as Recipient[])
}

function sendsFor(db: Store, repo: string, recipients: Recipient[]): { sends: Send[]; unknown: Recipient[] } {
  const found = getSetup<Setup>(db, repo)?.found
  const sends: Send[] = []
  const unknown: Recipient[] = []
  for (const r of recipients) {
    const app = found?.messaging.find((a) => a.app === r.app)
    if (app) sends.push({ ...r, sendTool: app.sendTool, searchTool: app.searchTool ?? null }); else unknown.push(r)
  }
  return { sends, unknown }
}

// Check Slack (SIGNOFF-31/D7): a read-only run that searches each recipient's channel for the PR link now.
// - Only the apps' search tools are allowed; nothing is posted and nothing is stored.
// - The send still checks again when CI passes.
export type Asked = { app: string; where: string; found: boolean; when?: string; link?: string; error?: string }

export function checkPrompt(url: string, sends: Send[]): string {
  return [
    'READ-ONLY: search messages; do not post, react, reply or change anything.',
    ...sends.map((r, i) => `${i + 1}. With ${r.searchTool} (${r.app}), search ${r.where} for a message that contains ${url}.`),
    'Reply with ONLY a JSON list between <asked> and </asked>: [{ "app": "…", "where": "…", "found": true|false, "when": "…time of the message when found", "link": "…its link when the tool gives one", "error": "…when the search failed" }]'
  ].join('\n')
}

export function parseAsked(out: string): Asked[] {
  const m = /<asked>([\s\S]*?)<\/asked>/.exec(out)
  if (!m) throw new Error(`the check did not report what it found: ${out.slice(0, 200)}`)
  const list = JSON.parse(m[1]) as Asked[]
  if (!Array.isArray(list)) throw new Error('the check report is not a list')
  return list
}

export async function checkAsked(db: Store, repo: string, recipients: Recipient[], url: string, run: (args: string[]) => Promise<{ code: number; out: string }>): Promise<Asked[]> {
  const { sends, unknown } = sendsFor(db, repo, recipients)
  const cannot: Asked[] = [
    ...unknown.map((u) => ({ app: u.app, where: u.where, found: false, error: `${u.app} is not in this repo's setup (Re-scan apps)` })),
    ...sends.filter((s) => !s.searchTool).map((s) => ({ app: s.app, where: s.where, found: false, error: 'no search tool in this repo\'s setup (Re-scan apps)' }))
  ]
  const searchable = sends.filter((s) => s.searchTool)
  if (!searchable.length) return cannot
  const r = await run(headlessArgs(checkPrompt(url, searchable), { allow: [...new Set(searchable.map((s) => s.searchTool!))], disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  if (r.code !== 0) throw new Error(`the check failed: ${r.out.slice(0, 200)}`)
  return [...parseAsked(r.out), ...cannot]
}

// Sends the review request and records each result on the monitor's timeline.
export async function sendReviewRequest(db: Store, m: Monitor, deps: {
  pr: (repo: string, pr: number) => Promise<Pr>
  run: (args: string[]) => Promise<{ code: number; out: string }>
}): Promise<Sent[]> {
  const planned = plan(db, m)
  for (const u of planned.unknown) addEvent(db, m.id, 'notify-failed', `Review request not sent to ${u.where}: ${u.app} is not in this repo's setup (Re-scan apps in Ship)`)
  const raised = alreadyRaised(db, m.repo, m.pr)
  const sends = planned.sends.filter((s) => {
    const before = raised.find((e) => e.text.includes(raisedKey(s.where, s.app)))
    if (before) addEvent(db, m.id, 'notify-skipped', `Review request already raised in ${raisedKey(s.where, s.app)} at ${before.at}; not sent again`)
    return !before
  })
  for (const s of sends.filter((x) => !x.searchTool)) addEvent(db, m.id, 'notify-note', `${raisedKey(s.where, s.app)} was not searched for an earlier request: no search tool in this repo's setup (Re-scan apps in Ship)`)
  if (!sends.length) return []
  const pr = await deps.pr(m.repo, m.pr)
  const line = reviewLine(m, pr)
  const tools = [...new Set(sends.flatMap((s) => [s.sendTool, ...(s.searchTool ? [s.searchTool] : [])]))]
  const r = await deps.run(headlessArgs(notifyPrompt(line, pr.url, sends), { allow: tools, disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  let sent: Sent[]
  try {
    if (r.code !== 0) throw new Error(r.out.slice(0, 200))
    sent = parseSent(r.out)
  } catch (e) {
    addEvent(db, m.id, 'notify-failed', `Review request: could not confirm it was sent (${(e as Error).message.slice(0, 160)})`)
    return []
  }
  for (const s of sent) {
    if (s.found) addEvent(db, m.id, 'notify-found', `Review request already in ${raisedKey(s.where, s.app)}, not sent again: ${s.found}`)
    else addEvent(db, m.id, s.ok ? 'notified' : 'notify-failed', s.ok ? `Review request sent to ${raisedKey(s.where, s.app)}` : `Review request not sent to ${raisedKey(s.where, s.app)}: ${s.error ?? 'no reason given'}`)
  }
  return sent
}
