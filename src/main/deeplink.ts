// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
// decision-ide:// links, for Shortcuts and Siri (and any app that opens URLs).
// - decision-ide://run?skill=<name>  runs a skill.
// - decision-ide://ask?text=<words>  asks Claude.
// Any web page can open a link like this, so links never run anything unattended by themselves:
// only a skill you pinned to the top bar runs right away; everything else lands in the chat input for you to send.
export type DeepLink = { action: 'run'; skill: string } | { action: 'ask'; text: string }

export function parseDeepLink(url: string): DeepLink | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'decision-ide:') return null
  const what = u.hostname || u.pathname.replace(/^\/+/, '')
  if (what === 'run') {
    const skill = u.searchParams.get('skill') ?? ''
    return /^[\w:.-]{1,80}$/.test(skill) ? { action: 'run', skill } : null
  }
  if (what === 'ask') {
    const text = (u.searchParams.get('text') ?? '').trim()
    return text ? { action: 'ask', text: text.slice(0, 4000) } : null
  }
  return null
}
