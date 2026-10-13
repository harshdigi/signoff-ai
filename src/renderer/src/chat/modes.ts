// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// Claude Code's permission modes as the app names them (chat footer, Settings). Same values as main/security-rules.ts.
export const MODES = [['default', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto']] as const
export type Mode = (typeof MODES)[number][0]
