// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// Claude's answer to a request a panel sent to the chat (useAsk). Pure, so it is testable without the window.
export type Ev = { type?: string; text?: string; message?: { content?: { type: string; text?: string }[] } }

// Claude's text after our prompt, up to the end of that turn; null while the turn is still going.
export function answerAfter(events: Ev[], prompt: string): string | null {
  const head = prompt.trim().slice(0, 80)
  let at = -1
  events.forEach((e, i) => { if (e.type === 'prompt' && (e.text ?? '').trim().startsWith(head)) at = i })
  if (at < 0) return null
  const parts: string[] = []
  for (const e of events.slice(at + 1)) {
    if (e.type === 'turn_end') return parts.join('\n\n').trim() || '(Claude finished without a written answer; see the chat.)'
    if (e.type === 'prompt') break
    if (e.type === 'assistant') for (const b of e.message?.content ?? []) if (b.type === 'text' && b.text?.trim()) parts.push(b.text.trim())
  }
  return null
}

