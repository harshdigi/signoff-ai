// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { split2 } from './option'
import type { Decision } from './types'

// The questions waiting on the product team, as Markdown to paste into Slack or Jira. Grouped by ticket, oldest first.
// Built only from the decisions themselves; nothing is sent anywhere.
export function productMarkdown(list: Decision[]): string {
  const byTicket = new Map<string, Decision[]>()
  for (const d of [...list].sort((a, b) => (a.product_at ?? '').localeCompare(b.product_at ?? ''))) byTicket.set(d.ticket, [...(byTicket.get(d.ticket) ?? []), d])
  const out = ['# Open questions for product', '']
  for (const [ticket, ds] of byTicket) {
    out.push(`## ${ticket}`)
    for (const d of ds) {
      out.push(`- **${d.question}** (${d.id})`)
      if (d.product_note) out.push(`  - What we need: ${d.product_note}`)
      for (const c of d.context ?? []) out.push(`  - ${c}`)
      for (const o of d.options) {
        const [name, what] = split2(o)
        out.push(`  - Option ${name}${what ? `: ${what}` : ''}`)
      }
      if (d.recommend) {
        const [name, why] = split2(d.recommend)
        out.push(`  - Engineering recommends ${name}${why ? `: ${why}` : ''}`)
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}
