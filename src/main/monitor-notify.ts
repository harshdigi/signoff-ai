// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Store } from './store'
import { addEvent, getSetup, type Monitor, type Recipient } from '../shared/monitors'
import type { Setup } from './monitor-setup'
import { headlessArgs } from './headless'

// The review request (SIGNOFF-23 step 5): when CI passes on a monitor whose box was ticked (D2: opt-in, sent without
// asking again), a short headless Claude run posts one fixed line to each recipient, with whatever messaging app the
// setup found for it (D6: Slack, Teams, Zoho Cliq, …).
// - The text is ours, never Claude's wording; Claude only fits the mentions to the app's format.
// - Only each app's send tool is allowed in that run (permission prompts are off, so nothing else that needs approval runs).
export type Pr = { title: string; url: string }
export type Sent = { app: string; where: string; ok: boolean; error?: string }

export const reviewLine = (m: Monitor, pr: Pr): string => `PR up for review: ${m.ticket ? `${m.ticket} ` : ''}${pr.title} — ${pr.url}`

export function notifyPrompt(line: string, sends: (Recipient & { sendTool: string })[]): string {
  return [
    'Post a message with your messaging tools. Send exactly what is described here and nothing else; change nothing else.',
    ...sends.map((r, i) => `${i + 1}. With ${r.sendTool} (${r.app}), post to ${r.where}: "${line}"${r.tags.length ? `, mentioning ${r.tags.join(', ')} at the end in ${r.app}'s mention format` : ''}.`),
    'Do not reword, translate or add to the text. If a destination or mention cannot be resolved, do not post there; report it.',
    'Reply with ONLY a JSON list between <sent> and </sent>: [{ "app": "…", "where": "…", "ok": true|false, "error": "…when not ok" }]'
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
export function plan(db: Store, m: Monitor): { sends: (Recipient & { sendTool: string })[]; unknown: Recipient[] } {
  const found = getSetup<Setup>(db, m.repo)?.found
  const recipients = JSON.parse(m.recipients ?? '[]') as Recipient[]
  const sends: (Recipient & { sendTool: string })[] = []
  const unknown: Recipient[] = []
  for (const r of recipients) {
    const app = found?.messaging.find((a) => a.app === r.app)
    if (app) sends.push({ ...r, sendTool: app.sendTool }); else unknown.push(r)
  }
  return { sends, unknown }
}

// Sends the review request and records each result on the monitor's timeline.
export async function sendReviewRequest(db: Store, m: Monitor, deps: {
  pr: (repo: string, pr: number) => Promise<Pr>
  run: (args: string[]) => Promise<{ code: number; out: string }>
}): Promise<Sent[]> {
  const { sends, unknown } = plan(db, m)
  for (const u of unknown) addEvent(db, m.id, 'notify-failed', `Review request not sent to ${u.where}: ${u.app} is not in this repo's setup (Check again in Ship)`)
  if (!sends.length) return []
  const line = reviewLine(m, await deps.pr(m.repo, m.pr))
  const r = await deps.run(headlessArgs(notifyPrompt(line, sends), { allow: [...new Set(sends.map((s) => s.sendTool))], disallow: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'] }))
  let sent: Sent[]
  try {
    if (r.code !== 0) throw new Error(r.out.slice(0, 200))
    sent = parseSent(r.out)
  } catch (e) {
    addEvent(db, m.id, 'notify-failed', `Review request: could not confirm it was sent (${(e as Error).message.slice(0, 160)})`)
    return []
  }
  for (const s of sent) addEvent(db, m.id, s.ok ? 'notified' : 'notify-failed', s.ok ? `Review request sent to ${s.where} (${s.app})` : `Review request not sent to ${s.where} (${s.app}): ${s.error ?? 'no reason given'}`)
  return sent
}
