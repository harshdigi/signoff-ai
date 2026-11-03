// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { headlessArgs } from './headless'

// Describe (SIGNOFF-34-WATCH/D5): Claude turns what you wrote about a change into the change-watch form's fields. You
// check them and start the watch yourself; nothing starts here. The run gets no tools.
export type Described = { subject: string; focus: string | null; since: string | null; windowMinutes: number | null }
export const WINDOW_CHOICES = [60, 240, 1440]
const NO_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task']

export function describePrompt(text: string, nowIso: string): string {
  return [
    'Someone made a change in production outside a pull request and wants its errors watched. Their words:',
    `"""${text}"""`,
    `Now it is ${nowIso}. Do not use any tools. Fill these fields from their words only; do not invent anything:`,
    '- subject: what changed, one short line;',
    '- focus: what to look at first in the error tool (a merchant id, endpoint, job), or null;',
    '- since: when the change was made, as an ISO time with offset, or null when they did not say;',
    `- windowMinutes: how long to watch, one of ${WINDOW_CHOICES.join(', ')}, or null when they did not say.`,
    'Reply with ONLY this JSON between <watch> and </watch>:',
    '{ "subject": "...", "focus": null, "since": null, "windowMinutes": null }'
  ].join('\n')
}

// A field Claude got wrong is dropped (null keeps what the form has), never guessed: an unparseable or future time,
// or a window that is not one of the choices.
export function parseDescribed(out: string, nowMs: number): Described {
  const m = /<watch>([\s\S]*?)<\/watch>/.exec(out)
  if (!m) throw new Error(`Claude did not fill the form: ${out.slice(0, 200)}`)
  const v = JSON.parse(m[1]) as Partial<Record<keyof Described, unknown>>
  if (typeof v.subject !== 'string' || !v.subject.trim()) throw new Error('Claude could not tell what changed; say it in a few words')
  const since = typeof v.since === 'string' && !Number.isNaN(Date.parse(v.since)) && Date.parse(v.since) <= nowMs + 60_000 ? new Date(Date.parse(v.since)).toISOString() : null
  return {
    subject: v.subject.trim(),
    focus: typeof v.focus === 'string' && v.focus.trim() ? v.focus.trim() : null,
    since,
    windowMinutes: typeof v.windowMinutes === 'number' && WINDOW_CHOICES.includes(v.windowMinutes) ? v.windowMinutes : null
  }
}

export async function describeChange(text: string, run: (args: string[]) => Promise<{ code: number; out: string }>, now = new Date()): Promise<Described> {
  if (!text.trim()) throw new Error('say what you changed')
  const r = await run(headlessArgs(describePrompt(text.trim(), now.toISOString()), { disallow: NO_TOOLS }))
  if (r.code !== 0) throw new Error(`Claude could not fill the form: ${r.out.slice(0, 200)}`)
  return parseDescribed(r.out, now.getTime())
}
