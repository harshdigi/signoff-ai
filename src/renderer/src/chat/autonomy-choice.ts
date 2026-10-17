// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// Autonomy as the window sees it (the checklist comes from the main process: shared/autonomy.ts).
export type Item = { id: string; label: string }
export type Autonomy = { mode: string; items: string[]; plan: boolean }
export type Catalog = { phases: { id: string; label: string; items: Item[] }[]; locked: Item[]; modes: Record<string, { label: string; items: string[]; plan: boolean }> }
export type Choice = { mode: string } | { items: string[]; plan: boolean }

export const modeLabel = (c: Catalog, a: Autonomy): string => (a.mode === 'custom' ? 'Custom' : c.modes[a.mode]?.label ?? a.mode)

// What a choice comes to, for showing it before it is saved (the main process settles it again on save).
export function resolve(c: Catalog, choice: Choice): Autonomy {
  if ('mode' in choice) { const m = c.modes[choice.mode]; return { mode: choice.mode, items: [...m.items], plan: m.plan } }
  const key = (items: string[]): string => [...items].sort().join(',')
  const match = Object.entries(c.modes).find(([, m]) => m.plan === choice.plan && key(m.items) === key(choice.items))
  return { mode: match ? match[0] : 'custom', items: choice.items, plan: choice.plan }
}
