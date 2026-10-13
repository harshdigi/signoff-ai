// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, expect, it } from 'vitest'
import { keysToChoose, terminalMenu } from '../terminal-menu'

const RULE = '─'.repeat(60)

describe("Claude Code's terminal menus", () => {
  it('reads a numbered permission prompt, with the command above the question', () => {
    const screen = [
      '⏺ Bash(rm -rf tmp/cache)',
      RULE,
      ' Bash command',
      '',
      '   rm -rf tmp/cache',
      '   Clear the cache',
      '',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      "   2. Yes, and don't ask again for rm commands in this folder",
      '   3. No, and tell Claude what to do differently (esc)',
      ''
    ]
    expect(terminalMenu(screen)).toEqual({
      question: 'Do you want to proceed?',
      detail: ['Bash command', 'rm -rf tmp/cache', 'Clear the cache'],
      options: ['Yes', "Yes, and don't ask again for rm commands in this folder", 'No, and tell Claude what to do differently (esc)'],
      selected: 0
    })
  })

  it('reads an unnumbered menu with its "Enter to confirm" hint, inside a box', () => {
    const screen = [
      '╭' + RULE + '╮',
      '│ Quick safety check: Is this a project you created or one you trust? │',
      '│                                                                      │',
      '│ ❯ No, exit                                                           │',
      '│   Yes, I trust this folder                                           │',
      '│                                                                      │',
      '│ Enter to confirm · Esc to cancel                                     │',
      '╰' + RULE + '╯'
    ]
    expect(terminalMenu(screen)).toEqual({
      question: 'Quick safety check: Is this a project you created or one you trust?', detail: [],
      options: ['No, exit', 'Yes, I trust this folder'], selected: 0
    })
  })

  it('the input box is not a menu, even with several typed lines', () => {
    const footer = '  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt'
    expect(terminalMenu(['Done.', RULE, '❯ ', RULE, footer])).toBeNull()
    expect(terminalMenu(['Done.', RULE, '❯ fix the login bug', '  and add a test', RULE, footer])).toBeNull()
  })

  it('moves from the highlighted option to the chosen one, then confirms', () => {
    const menu = { question: 'Q?', detail: [], options: ['a', 'b', 'c'], selected: 1 }
    expect([keysToChoose(menu, 0), keysToChoose(menu, 1), keysToChoose(menu, 2)]).toEqual([['Up', 'Enter'], ['Enter'], ['Down', 'Enter']])
    expect(() => keysToChoose(menu, 3)).toThrow('no option 4 in this menu')
  })
})
