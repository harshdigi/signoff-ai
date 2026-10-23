// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'
import { addEvent, getSetup, raisedKey, type Monitor, type Recipient } from '../shared/monitors'
import { recordRequest, requestsOf } from '../shared/review-requests'
import type { Setup } from './monitor-setup'
import { headlessArgs } from './headless'

// The review request (SIGNOFF-23 step 5): when CI passes on a monitor whose box was ticked (D2: opt-in, sent without
// asking again), a short headless Claude run posts one fixed line to each recipient, with whatever messaging app the
// setup found for it (D6: Slack, Teams, Zoho Cliq, …).
// - The text is ours, never Claude's wording; Claude only fits the mentions to the app's format.
// - Only each app's send and search tools are allowed in that run (permission prompts are off, so nothing else that
//   needs approval runs).
// - Never raised twice (SIGNOFF-31/D3): a destination with a recorded request for the PR is skipped, and the run first
//   searches for the PR link (the chosen channel first, then the rest) and does not post when it is found. An app
//   with no search tool in the setup is not searched; that is recorded on the timeline.
// - Sent and found requests are recorded per PR (SIGNOFF-31/D14), so Ship shows them and the thread can be checked.
export type Pr = { title: string; url: string }
export type Sent = { app: string; where: string; ok: boolean; found?: string; in?: string; message?: string; error?: string }
type Send = Recipient & { sendTool: string; searchTool?: string | null }
const search = (tool: string, where: string, url: string): string => `with ${tool}, search for a message that contains ${url}: first in ${where}, then in the other channels you can search`

export const reviewLine = (m: Monitor, pr: Pr): string => `PR up for review: ${m.ticket ? `${m.ticket} ` : ''}${pr.title} — ${pr.url}`

export function notifyPrompt(line: string, url: string, sends: Send[]): string {
  return [
    'Post a message with your messaging tools. Send exactly what is described here and nothing else; change nothing else.',
    ...sends.map((r, i) => `${i + 1}. ${r.searchTool ? `First, ${search(r.searchTool, r.where, url)}. If one exists, do not post; report it as found, with where it is. Otherwise, w` : 'W'}ith ${r.sendTool} (${r.app}), post to ${r.where}: "${line}"${r.tags.length ? `, mentioning ${r.tags.join(', ')} at the end in ${r.app}'s mention format` : ''}.`),
    'Do not reword, translate or add to the text. If a destination or mention cannot be resolved, do not post there; report it.',
    'Reply with ONLY a JSON list between <sent> and </sent>: [{ "app": "…", "where": "…", "ok": true|false, "message": "…the link or time of the message you posted", "found": "…when an earlier message was found: its time or link", "in": "…the channel it was found in", "error": "…when not ok" }]'
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

// Check Slack (SIGNOFF-31/D7): a read-only run that searches for the PR link now, the chosen channel first, then the rest.
// - Only the apps' search tools are allowed; nothing is posted.
// - A found message is recorded for the PR (D14), so the send skips it and its thread is checked for an approval.
export type Asked = { app: string; where: string; found: boolean; in?: string; when?: string; link?: string; error?: string }

export function checkPrompt(url: string, sends: Send[]): string {
  return [
    'READ-ONLY: search messages; do not post, react, reply or change anything.',
    ...sends.map((r, i) => `${i + 1}. (${r.app}) ${search(r.searchTool!, r.where, url)}.`),
    'Reply with ONLY a JSON list between <asked> and </asked>: [{ "app": "…", "where": "…the channel you were given", "found": true|false, "in": "…the channel it was found in", "when": "…time of the message when found", "link": "…its link when the tool gives one", "error": "…when the search failed" }]'
  ].join('\n')
}

export function parseAsked(out: string): Asked[] {
  const m = /<asked>([\s\S]*?)<\/asked>/.exec(out)
  if (!m) throw new Error(`the check did not report what it found: ${out.slice(0, 200)}`)
  const list = JSON.parse(m[1]) as Asked[]
  if (!Array.isArray(list)) throw new Error('the check report is not a list')
  return list
}

export async function checkAsked(db: Store, repo: string, recipients: Recipient[], pr: { number: number; url: string }, run: (args: string[]) => Promise<{ code: number; out: string }>): Promise<Asked[]> {
  const { sends, unknown } = sendsFor(db, repo, recipients)
  const cannot: Asked[] = [
    ...unknown.map((u) => ({ app: u.app, where: u.where, found: false, error: `${u.app} is not in this repo's setup (Re-scan apps)` })),
    ...sends.filter((s) => !s.searchTool).map((s) => ({ app: s.app, where: s.where, found: false, error: 'no search tool in this repo\'s setup (Re-scan apps)' }))
  ]
  const searchable = sends.filter((s) => s.searchTool)
  if (!searchable.length) return cannot
  const r = await run(headlessArgs(checkPrompt(pr.url, searchable), { allow: [...new Set(searchable.map((s) => s.searchTool!))], disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  if (r.code !== 0) throw new Error(`the check failed: ${r.out.slice(0, 200)}`)
  const asked = parseAsked(r.out)
  for (const a of asked.filter((x) => x.found)) recordRequest(db, { repo, pr: pr.number, app: a.app, place: a.where, state: 'found', message: where(a.in, a.where, [a.when, a.link]) })
  return [...asked, ...cannot]
}

// "in #other · 10:40 · <link>": where it was found when that is not the chosen channel, then its time and link.
const where = (found: string | undefined, chosen: string, rest: (string | undefined)[]): string =>
  [found && found.trim() !== chosen.trim() ? `in ${found}` : null, ...rest].filter(Boolean).join(' · ')

// Approval in the thread (SIGNOFF-31/D13): while the PR waits for its merge, the monitor reads the thread of each sent or
// found request (read-only, every 15 min) and records a reply that approves it. GitHub approvals are read by the watcher.
export type Approval = { app: string; place: string; approved: boolean; by?: string; when?: string; error?: string }

export function threadPrompt(url: string, reads: { app: string; place: string; message: string | null; threadTool: string; searchTool: string | null }[]): string {
  return [
    'READ-ONLY: read messages; do not post, react, reply or change anything.',
    ...reads.map((r, i) => `${i + 1}. (${r.app}) The message with ${url} in ${r.place}${r.message ? ` (${r.message})` : ''}: ${r.searchTool ? `find it with ${r.searchTool} if needed, then ` : ''}read its thread replies with ${r.threadTool}.`),
    'For each, does a reply approve the pull request (for example "approved", "LGTM", "ship it", a ✅)? A question or a request for changes is not an approval.',
    'Reply with ONLY a JSON list between <approvals> and </approvals>: [{ "app": "…", "place": "…", "approved": true|false, "by": "…who approved", "when": "…time of that reply", "error": "…when the thread could not be read" }]'
  ].join('\n')
}

export function parseApprovals(out: string): Approval[] {
  const m = /<approvals>([\s\S]*?)<\/approvals>/.exec(out)
  if (!m) throw new Error(`the thread check did not report: ${out.slice(0, 200)}`)
  const list = JSON.parse(m[1]) as Approval[]
  if (!Array.isArray(list)) throw new Error('the thread check report is not a list')
  return list
}

export async function checkApprovals(db: Store, m: Monitor, run: (args: string[]) => Promise<{ code: number; out: string }>, url: string): Promise<Approval[]> {
  const pr = m.pr
  if (pr === null) return [] // a change watch has no pull request
  const apps = getSetup<Setup>(db, m.repo)?.found.messaging ?? []
  const open = requestsOf(db, m.repo, pr).filter((r) => r.app !== 'GitHub' && r.state !== 'approved')
  const reads = open.flatMap((r) => {
    const a = apps.find((x) => x.app === r.app)
    return a?.threadTool ? [{ app: r.app, place: r.place, message: r.message, threadTool: a.threadTool, searchTool: a.searchTool ?? null }] : []
  })
  // Said once per monitor, not every 15 minutes.
  for (const r of open.filter((x) => !reads.some((y) => y.app === x.app && y.place === x.place))) {
    const text = `${raisedKey(r.place, r.app)}: its thread is not checked for approval: no thread tool in this repo's setup (Re-scan in the Monitor tab)`
    if (!db.prepare('SELECT 1 FROM monitor_events WHERE monitor_id = ? AND text = ?').get(m.id, text)) addEvent(db, m.id, 'notify-note', text)
  }
  if (!reads.length) return []
  const tools = [...new Set(reads.flatMap((r) => [r.threadTool, ...(r.searchTool ? [r.searchTool] : [])]))]
  const r = await run(headlessArgs(threadPrompt(url, reads), { allow: tools, disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  if (r.code !== 0) throw new Error(`the thread check failed: ${r.out.slice(0, 200)}`)
  const approvals = parseApprovals(r.out)
  for (const a of approvals.filter((x) => x.approved)) {
    recordRequest(db, { repo: m.repo, pr, app: a.app, place: a.place, state: 'approved', by: a.by ?? null })
    addEvent(db, m.id, 'approved', `Approved in ${raisedKey(a.place, a.app)}${a.by ? ` by ${a.by}` : ''}${a.when ? ` · ${a.when}` : ''}`)
  }
  return approvals
}

// Sends the review request and records each result on the monitor's timeline.
export async function sendReviewRequest(db: Store, m: Monitor, deps: {
  pr: (repo: string, pr: number) => Promise<Pr>
  run: (args: string[]) => Promise<{ code: number; out: string }>
}): Promise<Sent[]> {
  const n = m.pr
  if (n === null) return [] // a change watch has no pull request
  const planned = plan(db, m)
  for (const u of planned.unknown) addEvent(db, m.id, 'notify-failed', `Review request not sent to ${u.where}: ${u.app} is not in this repo's setup (Re-scan in the Monitor tab)`)
  const raised = requestsOf(db, m.repo, n)
  const sends = planned.sends.filter((s) => {
    const before = raised.find((r) => r.app === s.app && r.place === s.where.trim())
    if (before) addEvent(db, m.id, 'notify-skipped', `Review request already raised in ${raisedKey(s.where, s.app)} at ${before.at}; not sent again`)
    return !before
  })
  for (const s of sends.filter((x) => !x.searchTool)) addEvent(db, m.id, 'notify-note', `${raisedKey(s.where, s.app)} was not searched for an earlier request: no search tool in this repo's setup (Re-scan in the Monitor tab)`)
  if (!sends.length) return []
  const pr = await deps.pr(m.repo, n)
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
    if (s.found) {
      recordRequest(db, { repo: m.repo, pr: n, app: s.app, place: s.where, state: 'found', message: where(s.in, s.where, [s.found]) })
      addEvent(db, m.id, 'notify-found', `Review request already in ${raisedKey(s.in ?? s.where, s.app)}, not sent again: ${s.found}`)
    } else if (s.ok) {
      recordRequest(db, { repo: m.repo, pr: n, app: s.app, place: s.where, state: 'sent', message: s.message ?? null })
      addEvent(db, m.id, 'notified', `Review request sent to ${raisedKey(s.where, s.app)}`)
    } else addEvent(db, m.id, 'notify-failed', `Review request not sent to ${raisedKey(s.where, s.app)}: ${s.error ?? 'no reason given'}`)
  }
  return sent
}
