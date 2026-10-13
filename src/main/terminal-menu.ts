// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// A choice menu Claude Code shows in its terminal (permission prompts the hook handed back, folder trust, "Do you want
// to proceed?" and others), read from the screen so the chat can show it instead of "Claude is working".
// - A menu: a "❯" cursor line with sibling option lines at the same indent, either all numbered (1. 2. 3.) or followed
//   by Claude Code's "Enter to confirm / Esc to cancel" hint. The input box ("❯ " between ─── rules) is not one.
// - question: the line just above the options; detail: up to three lines above it (e.g. the command to run).
export type TerminalMenu = { question: string; detail: string[]; options: string[]; selected: number }

const BOX = /^[\s│┃|]+|[\s│┃|]+$/g
const clean = (l: string): string => l.replace(BOX, '')
const OPTION = /^(❯\s*)?(?:(\d+)\.\s+)?(\S.*)$/
const HINT = /Enter to (confirm|select)|Esc to (cancel|exit|go back)/i
const RULE = /^[─━╭╰┌└═-]{3,}/

export function terminalMenu(screen: string[]): TerminalMenu | null {
  const lines = screen.map(clean)
  const cursor = lines.findLastIndex((l) => /^❯\s*\S/.test(l))
  if (cursor < 0) return null
  // Option lines: the cursor line and its neighbours that are indented to the same text column.
  const col = (i: number): number => screen[i].length - screen[i].replace(/^[\s│┃|]*(❯\s*)?/, '').length
  const at = col(cursor)
  let first = cursor
  while (first > 0 && lines[first - 1] && col(first - 1) === at && !/^❯/.test(lines[first - 1])) first--
  let last = cursor
  while (last + 1 < lines.length && lines[last + 1] && col(last + 1) === at && !/^❯/.test(lines[last + 1])) last++
  if (last === first) return null
  const parsed = lines.slice(first, last + 1).map((l) => OPTION.exec(l)!)
  const numbered = parsed.every((m, i) => m[2] === String(i + 1))
  const hinted = lines.slice(last + 1, last + 4).some((l) => HINT.test(l))
  if (!numbered && !hinted) return null
  const above: string[] = []
  for (let i = first - 1; i >= 0 && above.length < 4; i--) {
    if (RULE.test(lines[i])) break
    if (lines[i]) above.unshift(lines[i])
  }
  if (!above.length) return null
  return { question: above[above.length - 1], detail: above.slice(0, -1), options: parsed.map((m) => m[3].trim()), selected: cursor - first }
}

// Keys that move the cursor from where it is to the chosen option, then confirm.
export function keysToChoose(menu: TerminalMenu, choice: number): ('Up' | 'Down' | 'Enter')[] {
  if (!Number.isInteger(choice) || choice < 0 || choice >= menu.options.length) throw new Error(`no option ${choice + 1} in this menu`)
  const d = choice - menu.selected
  return [...Array<'Up' | 'Down'>(Math.abs(d)).fill(d < 0 ? 'Up' : 'Down'), 'Enter']
}
