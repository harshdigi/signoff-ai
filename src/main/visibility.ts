// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// Whether the window is on screen, as its page sees it (document visibility). SIGNOFF-38-PERF/D5:
// - hidden, minimised, fully covered or screen locked: away; background checks skip their turn;
// - back on screen: each check runs once at once, so nothing shown is stale;
// - on screen until the page says otherwise, so the checks run as before if it never reports.
let shown = true
const back = new Set<() => void>()

export const onScreen = (): boolean => shown

export function setOnScreen(v: boolean): void {
  if (v === shown) return
  shown = v
  if (v) for (const l of back) l()
}

// l runs each time the window comes back on screen.
export function onBack(l: () => void): () => void {
  back.add(l)
  return () => back.delete(l)
}
